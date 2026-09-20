import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../src/lib/db";
import { asTenant } from "../src/lib/tenant";
import { normalizeImage } from "../src/lib/image-normalize";
import { writeUpload } from "../src/lib/image-storage";
import { purgeMenuForTenant } from "../src/lib/cdn-purge";

/**
 * Fill in the dish photos the printed menu never had, from a list of
 * image links the owner pasted into a JSON file.
 *
 *   pnpm exec tsx --env-file=.env scripts/import-dish-photos.ts \
 *     scripts/data/rangla-missing-photos.json [--dry-run] [--overwrite]
 *
 * The file is `{ venueSlug, items: [{ id, category, name, description,
 * imageUrl }] }`. A row whose `imageUrl` is empty is left alone — that is
 * the owner's way of saying "no picture for this one yet", so the file can
 * be filled in over several sittings and re-run after each.
 *
 * Flags
 *   --dry-run    download, validate and normalise every image, print what
 *                WOULD be stored, then write nothing and skip the purge.
 *   --overwrite  replace a photo a dish already has. Without it, a dish
 *                that already carries one is reported and left alone, so
 *                a re-run can never clobber a picture the owner uploaded
 *                from the dashboard or the app in the meantime.
 *
 * ── WHAT IT DOES, STEP BY STEP ───────────────────────────────────────────
 *
 * DOWNLOAD. `fetch` with a 20 s timeout, redirects followed, a 15 MB
 * ceiling enforced against the declared `Content-Length` *and* against the
 * bytes actually arriving (a lying header cannot make us buffer a DVD),
 * and an allow-list of `image/jpeg`, `image/png`, `image/webp`. Anything
 * else — an HTML "not found" page served with 200, a GIF, a PDF, a
 * `file://` path — is refused with a per-row message and the run carries
 * on with the next dish.
 *
 * STORE. Exactly the ingest the dashboard's dish-photo field uses
 * (`saveUploadedImage` in src/lib/media-service.ts) and the restaurant
 * app's POST /api/v1/staff/items/{id}/photo:
 *
 *   normalizeImage → the real format is detected from the BYTES (the
 *                    Content-Type above is only a cheap first gate), EXIF
 *                    and GPS are stripped, longest edge capped at 2048px,
 *                    re-encoded in the same container
 *   writeUpload    → `{tenantId}/uploads/{uuid}` under public/uploads
 *   media.create   → the `Media` row the `/img/{key}?w=…` proxy resizes
 *                    from, so `item.photoKey` resolves and every surface
 *                    (public menu, dashboard, app, PDF) picks it up
 *
 * MATCHING mirrors `scripts/import-menu-translations.ts`, for the same
 * reason: the ids in the JSON come from the PUBLISHED menu, a publish
 * deep-copies the whole tree into fresh rows, and a dev database seeded
 * separately shares no ids at all. So each row is resolved twice — once
 * against the current published version, once against the live draft —
 * by id first, then by EXACT name inside the category of the same name.
 * Names are scoped to their category on purpose: "Chicken Korma" and
 * "Sabzi Curry" each appear under more than one heading.
 *
 * DRAFT *AND* PUBLISHED, both halves, every time. Published-only would be
 * undone by the owner's next publish (it copies the draft tree over the
 * top); draft-only would not show a guest anything until they publish.
 *
 * CDN. `/`, `/{locale}` and `/api/v1/menu` are edge-cached, so a new photo
 * is invisible until the edge copy is dropped. `purgeMenuForTenant` (the
 * same helper the dashboard's publish action calls) runs once at the end.
 * With CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN unset it logs the skip
 * and the 5-minute s-maxage bounds the staleness instead.
 *
 * Idempotent: a second run finds every dish already photographed and
 * reports 0 set, N skipped. Exit code is 1 if any row FAILED (bad link,
 * undecodable bytes); a row that was merely skipped is not an error.
 *
 * ── RUNNING IT ON THE PRODUCTION VPS ─────────────────────────────────────
 *
 * There is no Node on the app VPS — the app ships as a container — so the
 * script runs in a throwaway `node:22` container against the repo checkout,
 * with the same env assembly `deploy/docker-compose.prod.yml` gives the app
 * (that file builds DATABASE_URL from prod.env's DB_* parts; REDIS_URL and
 * NODE_ENV live only in the compose `environment:` block, so they have to be
 * restated here or `src/lib/env.ts` refuses to load):
 *
 *   docker run --rm --network host \
 *     -v "$PWD":/app -w /app \
 *     -v rangla-prod_uploads:/app/public/uploads \
 *     --env-file prod.env node:22 sh -c '
 *       set -e
 *       export DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public"
 *       export APP_DATABASE_URL="$DATABASE_URL"
 *       export REDIS_URL=redis://127.0.0.1:6379
 *       corepack enable && pnpm install --frozen-lockfile &&
 *       pnpm exec prisma generate &&
 *       pnpm exec tsx scripts/import-dish-photos.ts scripts/data/rangla-missing-photos.json'
 *
 * THE VOLUME MOUNT IS NOT OPTIONAL. Uploaded photos live in the named
 * Docker volume `rangla-prod_uploads`, mounted into the app at
 * /app/public/uploads — NOT in the git checkout. Without that third `-v`
 * the images land in the checkout's public/uploads, the Media rows point
 * at keys no running container can read, and every one of these dishes
 * serves a broken image. Nothing else in the repo is written to, so the
 * `-v "$PWD":/app` bind is otherwise read-mostly (pnpm's node_modules and
 * the generated Prisma client are the exceptions).
 *
 * `--network host` is what lets the container reach the remote Postgres on
 * the private IP in prod.env. Redis is never touched by this script; the
 * URL only has to parse.
 */

const DEFAULT_BUNDLE = path.join(import.meta.dirname, "data", "rangla-missing-photos.json");

// ------------------------------------------------------------------ input

export interface PhotoRow {
  id: string;
  category: string;
  name: string;
  description?: string;
  imageUrl: string;
}
interface Bundle {
  venueSlug: string;
  note?: string;
  items: PhotoRow[];
}

// ------------------------------------------------------- download + checks

/**
 * What a menu photo may be. Deliberately the same three the dashboard
 * accepts (`ALLOWED_IMAGE_TYPES` in src/lib/media-service.ts) — anything
 * `normalizeImage` would refuse a few lines later is better refused here,
 * with a message naming the URL.
 */
export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/**
 * 15 MB. Higher than the dashboard's 10 MB intake because a link from a
 * photographer or a stock library is often an un-resized original, and
 * `normalizeImage` caps what actually reaches disk at 2048px anyway.
 */
export const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
const MAX_LABEL = "15 MB";
export const DOWNLOAD_TIMEOUT_MS = 20_000;

export type ImageFetch = (url: string, init: RequestInit) => Promise<Response>;

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/** Parseable, and http(s) — never `file:`, `data:` or `ftp:`. */
export function checkUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: `not a URL: ${JSON.stringify(trimmed)}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `unsupported scheme ${parsed.protocol}// — use http:// or https://`,
    };
  }
  return { ok: true, url: parsed.toString() };
}

export type ContentTypeCheck =
  { ok: true; contentType: AllowedContentType } | { ok: false; reason: string };

/**
 * The header minus its parameters (`image/jpeg; charset=binary`), folded
 * to lower case. A missing header is a refusal, not a guess: the usual
 * cause is a share link that serves an HTML viewer page rather than the
 * file, and silently feeding that to sharp only moves the error.
 */
export function checkContentType(raw: string | null | undefined): ContentTypeCheck {
  const value = (raw ?? "").split(";")[0]!.trim().toLowerCase();
  if (value === "") return { ok: false, reason: "no Content-Type on the response" };
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(value)) {
    return {
      ok: false,
      reason:
        `Content-Type ${value} — need ${ALLOWED_CONTENT_TYPES.join(", ")}. A share/preview ` +
        `link usually serves HTML; use the direct image URL.`,
    };
  }
  return { ok: true, contentType: value as AllowedContentType };
}

export type DownloadResult =
  { ok: true; bytes: Buffer; contentType: AllowedContentType } | { ok: false; reason: string };

/** KB under a megabyte, MB above — a 40 KB dish thumbnail reading "0.0 MB" is noise. */
function size(bytes: number): string {
  return bytes < 1e6 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

/**
 * Fetch one image with every guard on: scheme, timeout, redirects,
 * declared type, declared size and — because a `Content-Length` is a
 * claim, not a fact — the real byte count as it streams in.
 */
export async function downloadImage(
  rawUrl: string,
  fetchImpl: ImageFetch = fetch,
): Promise<DownloadResult> {
  const checked = checkUrl(rawUrl);
  if (!checked.ok) return checked;

  let res: Response;
  try {
    res = await fetchImpl(checked.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { accept: ALLOWED_CONTENT_TYPES.join(", ") },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      reason: timedOut ? `no response within 20 s` : `request failed — ${message}`,
    };
  }

  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

  const type = checkContentType(res.headers.get("content-type"));
  if (!type.ok) return type;

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    return { ok: false, reason: `${size(declared)} declared — the limit is ${MAX_LABEL}` };
  }

  let bytes: Buffer;
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `download interrupted after ${size(total)} — ${message}` };
      }
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          reason: `over ${MAX_LABEL} — stopped mid-download (Content-Length lied or was absent)`,
        };
      }
      chunks.push(Buffer.from(chunk.value));
    }
    bytes = Buffer.concat(chunks);
  } else {
    // No stream (a mock, or a body-less response) — fall back to the
    // buffered read and check the size after the fact.
    bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) {
      return { ok: false, reason: `${size(bytes.length)} — the limit is ${MAX_LABEL}` };
    }
  }

  if (bytes.length === 0) return { ok: false, reason: "empty response body" };
  return { ok: true, bytes, contentType: type.contentType };
}

// ------------------------------------------------------------- matching

export type MatchKind = "id" | "name";

export interface TargetItem {
  id: string;
  name: string;
  photoMediaId: string | null;
}
export interface TargetCategory {
  id: string;
  name: string;
  items: TargetItem[];
}
export interface TargetVersion {
  id: string;
  label: "published" | "draft";
  categories: TargetCategory[];
}
export interface Match {
  itemId: string;
  how: MatchKind;
  hasPhoto: boolean;
}

/**
 * Resolve every bundle row against ONE menu version, returning an array
 * parallel to `rows` (null where nothing matched).
 *
 * Two passes, not one: every id match is claimed first, so a row matched
 * by name can never steal the dish that a later row owns outright. Within
 * a pass, a target row is claimed at most once — two bundle rows naming
 * the same dish get one match and one honest "no dish matched".
 */
export function matchVersion(rows: PhotoRow[], version: TargetVersion): (Match | null)[] {
  const byId = new Map<string, TargetItem>();
  for (const category of version.categories) {
    for (const item of category.items) byId.set(item.id, item);
  }
  const categoryByName = new Map<string, TargetCategory>();
  for (const category of version.categories) {
    if (!categoryByName.has(category.name)) categoryByName.set(category.name, category);
  }

  const out: (Match | null)[] = rows.map(() => null);
  const used = new Set<string>();

  rows.forEach((row, i) => {
    const hit = byId.get(row.id);
    if (!hit || used.has(hit.id)) return;
    used.add(hit.id);
    out[i] = { itemId: hit.id, how: "id", hasPhoto: hit.photoMediaId !== null };
  });

  rows.forEach((row, i) => {
    if (out[i]) return;
    const category = categoryByName.get(row.category);
    if (!category) return;
    const hit = category.items.find((item) => item.name === row.name && !used.has(item.id));
    if (!hit) return;
    used.add(hit.id);
    out[i] = { itemId: hit.id, how: "name", hasPhoto: hit.photoMediaId !== null };
  });

  return out;
}

// ------------------------------------------------------------- database

/**
 * Resolve the venue's tenant. The app role sees nothing until the RLS GUC
 * is set and the GUC needs the tenant id — a chicken-and-egg the app
 * solves through the session. Here we try the app connection first (works
 * when it is RLS-exempt, e.g. a local dev role) and fall back to the
 * operator/migration connection, exactly as `import-menu-translations.ts`
 * and `apply-menu-update.ts` do.
 */
async function resolveVenue(slug: string): Promise<{ id: string; tenantId: string; name: string }> {
  type Row = { id: string; tenantId: string; name: string };
  const sql = `
    SELECT id, tenant_id AS "tenantId", name
    FROM venues WHERE slug = $1 AND "deletedAt" IS NULL LIMIT 1`;

  const direct = await prisma.$queryRawUnsafe<Row[]>(sql, slug);
  if (direct[0]) return direct[0];

  const operatorUrl = process.env.DATABASE_URL;
  if (!operatorUrl) {
    throw new Error(
      `venue "${slug}" not visible on APP_DATABASE_URL (RLS) and DATABASE_URL is not set`,
    );
  }
  const operator = new PrismaClient({ adapter: new PrismaPg({ connectionString: operatorUrl }) });
  try {
    const rows = await operator.$queryRawUnsafe<Row[]>(sql, slug);
    if (!rows[0]) throw new Error(`no venue with slug "${slug}"`);
    return rows[0];
  } finally {
    await operator.$disconnect();
  }
}

/** The two versions worth writing to: the CURRENT published one + the live draft. */
async function loadTargets(
  tx: Prisma.TransactionClient,
  venueId: string,
): Promise<TargetVersion[]> {
  const menus = await tx.menu.findMany({
    where: { venueId, deletedAt: null },
    select: { id: true, publishedVersion: true },
  });
  if (menus.length === 0) return [];

  const publishedIds = new Set(
    menus.flatMap((menu) => (menu.publishedVersion ? [menu.publishedVersion] : [])),
  );
  const versions = await tx.menuVersion.findMany({
    where: { menuId: { in: menus.map((menu) => menu.id) } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      menuId: true,
      categories: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          name: true,
          items: {
            where: { deletedAt: null },
            orderBy: { orderIndex: "asc" },
            select: { id: true, name: true, photoMediaId: true },
          },
        },
      },
    },
  });

  const targets: TargetVersion[] = [];
  const draftSeen = new Set<string>();
  for (const version of versions) {
    if (publishedIds.has(version.id)) {
      targets.push({ id: version.id, label: "published", categories: version.categories });
    } else if (version.status === "draft" && !draftSeen.has(version.menuId)) {
      draftSeen.add(version.menuId);
      targets.push({ id: version.id, label: "draft", categories: version.categories });
    }
  }
  return targets;
}

// ------------------------------------------------------------------ main

interface Prepared {
  row: PhotoRow;
  hits: { label: string; itemId: string; how: MatchKind }[];
  storageKey: string;
  width: number;
  height: number;
  bytes: Buffer;
}

function usage(): string {
  return [
    "pnpm exec tsx --env-file=.env scripts/import-dish-photos.ts \\",
    "  scripts/data/rangla-missing-photos.json [--dry-run] [--overwrite]",
    "",
    "  --dry-run    download + validate, write nothing, no CDN purge",
    "  --overwrite  replace photos dishes already have (default: leave them)",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const known = new Set(["--dry-run", "--overwrite"]);
  const unknown = args.filter((a) => a.startsWith("--") && !known.has(a));
  if (unknown.length > 0) {
    console.error(`unknown flag(s): ${unknown.join(", ")}\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }
  const dryRun = args.includes("--dry-run");
  const overwrite = args.includes("--overwrite");
  const bundlePath = args.find((a) => !a.startsWith("--")) ?? DEFAULT_BUNDLE;

  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as Bundle;
  if (!bundle.venueSlug || !Array.isArray(bundle.items)) {
    throw new Error(`${bundlePath} is not a photo bundle ({ venueSlug, items: [...] })`);
  }

  const rows = bundle.items.filter((item) => (item.imageUrl ?? "").trim() !== "");
  const prefix = dryRun ? "[dry-run] " : "";
  console.log(
    `${prefix}${path.basename(bundlePath)}: venue "${bundle.venueSlug}", ` +
      `${rows.length} of ${bundle.items.length} row(s) carry an imageUrl` +
      `${overwrite ? " · --overwrite: existing photos WILL be replaced" : ""}`,
  );
  if (rows.length === 0) {
    console.log("nothing to do — every imageUrl is still empty");
    await prisma.$disconnect();
    return;
  }

  const venue = await resolveVenue(bundle.venueSlug);
  console.log(`venue ${venue.id} · tenant ${venue.tenantId} · ${venue.name}\n`);

  // 1. Read the menu tree and pair every row with its draft + published twin.
  const targets = await asTenant(venue.tenantId, (tx) => loadTargets(tx, venue.id));
  if (targets.length === 0) throw new Error("venue has no menu versions to write to");
  console.log(
    `targets: ${targets.map((t) => `${t.label} ${t.id}`).join(" · ")}\n` + `${"".padEnd(72, "-")}`,
  );
  const matched = targets.map((version) => ({ version, hits: matchVersion(rows, version) }));

  // 2. Decide, then download. Both happen OUTSIDE any transaction: a 20 s
  //    fetch per dish must never hold a database transaction open.
  const prepared: Prepared[] = [];
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const label = `${row.name} [${row.category}]`;
    const hits = matched.flatMap(({ version, hits: perRow }) => {
      const hit = perRow[i];
      return hit ? [{ label: version.label, ...hit }] : [];
    });

    if (hits.length === 0) {
      skipped += 1;
      console.log(`skip ${label}\n     no dish matched — neither id ${row.id} nor that exact name`);
      continue;
    }

    const where = hits.map((h) => `${h.label} by ${h.how}`).join(" · ");
    const photographed = hits.filter((h) => h.hasPhoto);
    if (photographed.length > 0 && !overwrite) {
      skipped += 1;
      const which =
        photographed.length === hits.length
          ? "already has a photo"
          : `${photographed.map((h) => h.label).join(" + ")} already has a photo, ` +
            `${hits
              .filter((h) => !h.hasPhoto)
              .map((h) => h.label)
              .join(" + ")} does not`;
      console.log(`skip ${label}\n     matched ${where} · ${which} — pass --overwrite to replace`);
      continue;
    }

    const got = await downloadImage(row.imageUrl);
    if (!got.ok) {
      failed += 1;
      console.log(`FAIL ${label}\n     matched ${where} · ${got.reason}\n     ${row.imageUrl}`);
      continue;
    }
    const normalized = await normalizeImage(got.bytes);
    if (!normalized.ok) {
      failed += 1;
      console.log(
        `FAIL ${label}\n     matched ${where} · ${got.contentType} bytes sharp cannot decode ` +
          `(${normalized.error})\n     ${row.imageUrl}`,
      );
      continue;
    }

    const storageKey = `${venue.tenantId}/uploads/${randomUUID()}`;
    prepared.push({
      row,
      hits: hits.map(({ label: l, itemId, how }) => ({ label: l, itemId, how })),
      storageKey,
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.bytes,
    });
    console.log(
      `ok   ${label}\n     matched ${where}\n` +
        `     downloaded ${got.contentType} ${size(got.bytes.length)} → ` +
        `${normalized.format} ${normalized.width}×${normalized.height}, ` +
        `${size(normalized.bytes.length)}\n` +
        `     ${dryRun ? "would store" : "storing"} ${storageKey}`,
    );
  }

  // 3. Write. Files first (plain disk writes), then one transaction for the
  //    Media rows and the item pointers — an interrupted run leaves at worst
  //    an unreferenced file, never a Media row pointing at nothing.
  if (!dryRun && prepared.length > 0) {
    for (const entry of prepared) await writeUpload(entry.storageKey, entry.bytes);

    await asTenant(venue.tenantId, async (tx) => {
      for (const entry of prepared) {
        const media = await tx.media.create({
          data: {
            tenantId: venue.tenantId,
            storageKey: entry.storageKey,
            width: entry.width,
            height: entry.height,
            bytes: entry.bytes.length,
            altText: entry.row.name.slice(0, 300) || null,
          },
          select: { id: true },
        });
        await tx.item.updateMany({
          where: { id: { in: entry.hits.map((h) => h.itemId) } },
          data: { photoMediaId: media.id },
        });
      }
    });
  }

  console.log(
    `${"".padEnd(72, "-")}\n${prefix}${prepared.length} dish(es) ` +
      `${dryRun ? "would be photographed" : "photographed"} ` +
      `(${prepared.reduce((n, e) => n + e.hits.length, 0)} draft+published row(s) updated) · ` +
      `${skipped} skipped · ${failed} failed`,
  );

  if (dryRun) {
    console.log("[dry-run] nothing written, CDN not purged");
  } else if (prepared.length === 0) {
    console.log("no change — CDN not purged");
  } else {
    const outcome = await purgeMenuForTenant(venue.tenantId);
    console.log(
      outcome === "purged"
        ? "CDN purged (menu pages + /api/v1/menu, all locales)"
        : outcome === "skipped_unconfigured"
          ? "CDN purge skipped — CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN unset; the 5-minute " +
            "s-maxage bounds the staleness instead"
          : "CDN purge FAILED — purge /, /{locale} and /api/v1/menu by hand in Cloudflare",
    );
  }

  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
