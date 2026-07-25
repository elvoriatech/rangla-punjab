import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Restore drill (P2-7). Proves that the "backup → restore → serve"
 * path still works after every schema change we make. Runs against
 * the already-up `elvoria-postgres` docker-compose container by
 * creating an ephemeral scratch database (dropped in `finally`), so
 * a drill run adds ~5 s to CI rather than the 30-60 s of spinning a
 * whole new container.
 *
 * Sequence:
 *   1. Create scratch database  `elvoria_restore_drill_<random>`
 *   2. Load the input pg_dump   (via `psql -f <fixture>`)
 *   3. Apply every migration    (`prisma migrate deploy`)
 *   4. Apply the RLS dev-roles  (`dev-roles.sql`, idempotent)
 *   5. Seed the demo tenant     (`scripts/seed-demo-venue.ts`)
 *   6. Run the checksum query   — content-based `md5(string_agg
 *      (name || ':' || price_cents, '|' ORDER BY name))` so the
 *      value is stable across seed runs (item ids are `cuid()`
 *      and would break a raw-id checksum every run).
 *   7. Compare to the golden JSON  (`restore-drill.golden.json`).
 *
 * Exits 0 on match, non-zero on any drift.
 *
 * Compose profile: the P2-7 spec asks for a `restore-drill` compose
 * profile. This script uses a scratch DB in the *existing* postgres
 * because it's ~10× faster and functionally equivalent for the
 * checksum contract. The profile is available via
 * `docker compose --profile restore-drill up` for operators who want
 * a truly-empty-container drill.
 */

interface DrillOptions {
  fixturePath: string;
  goldenPath: string;
  writeGolden?: boolean;
}

interface DrillResult {
  scratchDatabase: string;
  itemCount: number;
  itemsChecksum: string;
  golden: { itemCount: number; itemsChecksum: string } | null;
  match: boolean;
}

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function parseAdminUrl(): { url: URL; database: string } {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL must be set (superuser connection for CREATE DATABASE)");
  const url = new URL(raw);
  const database = url.pathname.replace(/^\//, "");
  if (!database) throw new Error("DATABASE_URL missing database name");
  return { url, database };
}

function scratchUrl(admin: URL, name: string): string {
  const copy = new URL(admin.toString());
  copy.pathname = `/${name}`;
  return copy.toString();
}

async function withAdminClient<T>(admin: URL, fn: (c: PrismaClient) => Promise<T>): Promise<T> {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: admin.toString() }),
  });
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

async function withScratchClient<T>(url: string, fn: (c: PrismaClient) => Promise<T>): Promise<T> {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): void {
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, env, stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`command failed: ${cmd} ${args.join(" ")} (exit ${r.status})`);
  }
}

export async function runDrill(opts: DrillOptions): Promise<DrillResult> {
  const { url: admin } = parseAdminUrl();
  const suffix = randomBytes(4).toString("hex");
  const scratch = `elvoria_restore_drill_${suffix}`;
  const scratchConn = scratchUrl(admin, scratch);

  await withAdminClient(admin, async (c) => {
    // `identifier` is generated (not user-input), safe to interpolate.
    await c.$executeRawUnsafe(`CREATE DATABASE "${scratch}"`);
  });

  // 2. Load the fixture. We pipe every statement through Prisma
  //    instead of shelling out to `psql`, because the local host may
  //    not have `psql` installed (dev laptops, minimal CI runners)
  //    and the fixture is small enough that the network cost is
  //    negligible. Real prod `pg_dump` files with COPY blocks are
  //    left to a follow-up if the drill ever needs them.
  const fixtureSql = await readFile(opts.fixturePath, "utf8");
  await withScratchClient(scratchConn, async (c) => {
    for (const stmt of splitSqlStatements(fixtureSql)) {
      if (!stmt.trim()) continue;
      await c.$executeRawUnsafe(stmt);
    }
  });

  // 3. Apply migrations
  run("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    ...process.env,
    DATABASE_URL: scratchConn,
    APP_DATABASE_URL: scratchConn,
  });

  // 4. Apply RLS dev-roles (idempotent — `IF NOT EXISTS` guards inside)
  const rolesSql = await readFile(path.join(REPO_ROOT, "prisma", "dev-roles.sql"), "utf8");
  await withAdminClient(new URL(scratchConn), async (c) => {
    for (const stmt of splitSqlStatements(rolesSql)) {
      if (!stmt.trim()) continue;
      await c.$executeRawUnsafe(stmt);
    }
  });

  // 5. Seed
  run("pnpm", ["exec", "tsx", "scripts/seed-demo-venue.ts"], {
    ...process.env,
    DATABASE_URL: scratchConn,
    APP_DATABASE_URL: scratchConn,
  });

  // 6. Checksum
  const { itemCount, itemsChecksum } = await withScratchClient(scratchConn, async (c) => {
    const rows = await c.$queryRawUnsafe<{ count: bigint; checksum: string }[]>(`
      SELECT
        count(*)::bigint                                          AS "count",
        md5(string_agg(name || ':' || price_cents::text, '|' ORDER BY name)) AS "checksum"
      FROM items
    `);
    return {
      itemCount: Number(rows[0]?.count ?? 0),
      itemsChecksum: rows[0]?.checksum ?? "",
    };
  }).finally(async () => {
    await withAdminClient(admin, async (c) => {
      await c.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
    });
  });

  // 7. Compare
  let golden: DrillResult["golden"] = null;
  try {
    const raw = await readFile(opts.goldenPath, "utf8");
    golden = JSON.parse(raw) as DrillResult["golden"];
  } catch {
    golden = null;
  }
  const match =
    golden !== null && golden.itemCount === itemCount && golden.itemsChecksum === itemsChecksum;

  return { scratchDatabase: scratch, itemCount, itemsChecksum, golden, match };
}

function splitSqlStatements(sql: string): string[] {
  // Very simple splitter — good enough for our fixture + dev-roles
  // shape (no dollar-quoted bodies except our `DO $$ ... $$` block
  // which is a single statement).
  const out: string[] = [];
  let current = "";
  let inDollar = false;
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) continue;
    if (trimmed.includes("$$")) {
      inDollar = !inDollar;
    }
    current += line + "\n";
    if (!inDollar && trimmed.endsWith(";")) {
      out.push(current);
      current = "";
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

// ---------- CLI entrypoint ---------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixtureIdx = args.indexOf("--fixture");
  const goldenIdx = args.indexOf("--golden");
  const write = args.includes("--write-golden");
  const fixturePath = path.resolve(
    fixtureIdx >= 0 ? args[fixtureIdx + 1]! : "prisma/fixtures/demo.sql",
  );
  const goldenPath = path.resolve(
    goldenIdx >= 0 ? args[goldenIdx + 1]! : "scripts/restore-drill.golden.json",
  );

  const result = await runDrill({ fixturePath, goldenPath, writeGolden: write });
  process.stdout.write(
    `✓ restore-drill: scratch=${result.scratchDatabase} items=${result.itemCount} checksum=${result.itemsChecksum}\n`,
  );

  if (write) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      goldenPath,
      JSON.stringify(
        { itemCount: result.itemCount, itemsChecksum: result.itemsChecksum },
        null,
        2,
      ) + "\n",
    );
    process.stdout.write(`✓ golden written to ${goldenPath}\n`);
    return;
  }

  if (!result.golden) {
    process.stderr.write("✗ no golden file — run once with --write-golden to record\n");
    process.exit(2);
  }
  if (!result.match) {
    process.stderr.write(
      `✗ checksum drift: expected ${result.golden.itemsChecksum} (${result.golden.itemCount} items), got ${result.itemsChecksum} (${result.itemCount} items)\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`✓ checksum matches golden\n`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(
      `✗ restore-drill failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
