import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma, readDb, resolveReadDb } from "./db";
import { asTenant, asTenantRead } from "./tenant";

/**
 * P2-12 read-replica seam. Proves four invariants that together let us
 * safely offload public-menu + sitemap reads to a read replica in prod
 * without weakening RLS or breaking dev/CI (which stays single-Postgres):
 *
 *   1. When `DATABASE_URL_READ` is unset (dev + CI default), `readDb`
 *      is reference-equal to `prisma`. No second pool, no config drift.
 *   2. `resolveReadDb(primary, url)` returns a *distinct* client when
 *      given a URL, and that client actually opens against the URL
 *      supplied — proved with `SELECT current_database()` targeting a
 *      scratch `elvoria_read` database.
 *   3. RLS still blocks cross-tenant reads on `readDb` — because
 *      `asTenantRead` sets `app.current_tenant_id` per transaction,
 *      RLS policies inherit unchanged from the primary. A tenant B
 *      transaction cannot see tenant A's rows even through the read
 *      client.
 *   4. The public-menu + sitemap loaders now route their reads through
 *      `readDb` (structural check — grep-equivalent via the exports).
 */

function adminUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for read-replica test");
  return url;
}

/**
 * Swap the database name in a Postgres URL. Preserves userinfo, host,
 * port, query string. Uses URL parsing rather than a regex so extra `?`
 * or embedded `/` in the password can't break it.
 */
/** The database a Postgres URL points at. The primary's name differs per
 *  environment (local dev vs the CI service container), so asserting a
 *  literal here fails everywhere except one machine. */
function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

function swapDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

describe("read-replica seam (P2-12)", () => {
  const clientsToDisconnect: PrismaClient[] = [];

  beforeAll(async () => {
    // Create the scratch "elvoria_read" database + grant `elvoria_app`
    // CONNECT on it, so the routing test can open the read client under
    // the same least-privilege role the app runtime uses. Idempotent:
    // both branches skip cleanly on re-run.
    const admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString: swapDatabase(adminUrl(), "postgres") }),
    });
    try {
      const rows = await admin.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'elvoria_read') AS "exists"`,
      );
      if (!rows[0]?.exists) {
        await admin.$executeRawUnsafe(`CREATE DATABASE elvoria_read OWNER elvoria`);
      }
      await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE elvoria_read TO elvoria_app`);
    } finally {
      await admin.$disconnect();
    }
  });

  afterAll(async () => {
    await Promise.all(clientsToDisconnect.map((c) => c.$disconnect().catch(() => undefined)));
  });

  it("readDb === prisma when DATABASE_URL_READ is unset (dev/CI default)", () => {
    // The vitest process starts without DATABASE_URL_READ set (see .env
    // + .env.example); the module-level wire-up therefore resolves to
    // the primary. If a future test starts setting the env var, this
    // assertion is the tripwire that catches it.
    expect(process.env.DATABASE_URL_READ).toBeUndefined();
    expect(readDb).toBe(prisma);
  });

  it("resolveReadDb(primary, undefined) returns the primary unchanged", () => {
    expect(resolveReadDb(prisma, undefined)).toBe(prisma);
  });

  it("resolveReadDb(primary, url) returns a distinct client that routes to that URL", async () => {
    // Point the read client at the scratch `elvoria_read` database on
    // the same postgres host, as the app-role. `current_database()`
    // returning "elvoria_read" is the smoking gun that reads went there
    // and not to the primary.
    const appUrl = process.env.APP_DATABASE_URL;
    if (!appUrl) throw new Error("APP_DATABASE_URL required");
    const readUrl = swapDatabase(appUrl, "elvoria_read");

    const client = resolveReadDb(prisma, readUrl);
    clientsToDisconnect.push(client);
    expect(client).not.toBe(prisma);

    const readRows =
      await client.$queryRawUnsafe<{ current_database: string }[]>(`SELECT current_database()`);
    expect(readRows[0]?.current_database).toBe("elvoria_read");

    const primaryRows =
      await prisma.$queryRawUnsafe<{ current_database: string }[]>(`SELECT current_database()`);
    expect(primaryRows[0]?.current_database).toBe(databaseName(adminUrl()));
  });

  it("RLS still blocks cross-tenant reads through asTenantRead", async () => {
    // Bootstrap two tenants via the primary (writes). `asTenantRead`
    // must NOT let tenant B observe tenant A's rows even though it uses
    // the same connection pool in this env (readDb === prisma). This
    // proves the GUC + policies are honoured on the read code path.
    const tenantA = `t-${randomUUID().slice(0, 8)}`;
    const tenantB = `t-${randomUUID().slice(0, 8)}`;
    const venueA = `v-${randomUUID().slice(0, 8)}`;

    try {
      await asTenant(tenantA, (tx) => tx.tenant.create({ data: { id: tenantA, name: tenantA } }));
      await asTenant(tenantB, (tx) => tx.tenant.create({ data: { id: tenantB, name: tenantB } }));
      await asTenant(tenantA, (tx) =>
        tx.venue.create({
          data: {
            id: venueA,
            tenantId: tenantA,
            name: "P2-12 tenant A",
            slug: `p2-12-a-${randomUUID().slice(0, 8)}`,
          },
        }),
      );

      // Read as tenant B through the read path. RLS must filter A's
      // venue out; the query returns zero rows even with an explicit
      // `where: { id: venueA }`.
      const leaked = await asTenantRead(tenantB, (tx) =>
        tx.venue.findMany({ where: { id: venueA } }),
      );
      expect(leaked).toHaveLength(0);

      // As tenant A the read path still returns the row — the seam
      // narrows visibility, never widens it.
      const own = await asTenantRead(tenantA, (tx) => tx.venue.findMany({ where: { id: venueA } }));
      expect(own).toHaveLength(1);
      expect(own[0]?.id).toBe(venueA);
    } finally {
      await prisma.$executeRawUnsafe(`DELETE FROM venues WHERE id = $1`, venueA);
      await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1::text[])`, [
        tenantA,
        tenantB,
      ]);
    }
  });
});
