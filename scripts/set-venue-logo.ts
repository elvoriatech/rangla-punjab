/**
 * Sets a venue's logo from a file on disk — the CLI twin of Dashboard →
 * Settings → Logo.
 *
 *   pnpm exec tsx --env-file=.env scripts/set-venue-logo.ts <venue-slug> <image path>
 *
 * The public menu, the guest web-app manifest, the venue's transactional
 * emails and the Expo app's in-app logo all read `venues.branding.logoKey`,
 * which points at an uploaded blob rather than a file in the repo. So
 * dropping a new logo into `public/brand` changes nothing on those surfaces:
 * the image has to go through the same ingest the dashboard form uses.
 *
 * That ingest is exactly what `saveLogoAction`
 * (src/app/dashboard/(console)/settings/actions.ts) does, and this script
 * repeats it step for step:
 *
 *   normalizeImage  → real format detected from the bytes, EXIF/GPS stripped,
 *                     longest edge capped at 2048px
 *   writeUpload     → stored under `{tenantId}/uploads/{uuid}`
 *   media.create    → the Media row the /img proxy resizes from
 *   branding.logoKey→ pointed at the new key
 *   purgeUrls       → the same CDN purge `finish()` runs, so a cached menu
 *                     page does not keep serving the old mark
 *
 * The one deliberate difference is the trust boundary. The dashboard action
 * runs as a signed-in owner and goes through `asUser`, so RLS scopes every
 * write to that owner's tenant. There is no session here — this is an
 * operator tool run against one named venue — so it uses the migration
 * connection (`DATABASE_URL`) and scopes by the slug it was given, the same
 * way `scripts/brand-mobile.ts` reads the venue row.
 */

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { buildMenuPurgeUrls, purgeUrls } from "../src/lib/cdn-purge";
import { normalizeImage } from "../src/lib/image-normalize";
import { writeUpload } from "../src/lib/image-storage";

/** Matches the dashboard form's intake ceiling (src/lib/media-service.ts). */
const MAX_BYTES = 10 * 1024 * 1024;

function usage(): string {
  return [
    "pnpm exec tsx --env-file=.env scripts/set-venue-logo.ts <venue-slug> <image path>",
    "",
    "  e.g. pnpm exec tsx --env-file=.env scripts/set-venue-logo.ts \\",
    "         rangla-punjab public/brand/rangla-logo.png",
    "",
    "Equivalent to uploading the file in Dashboard → Settings → Logo.",
  ].join("\n");
}

async function main(): Promise<void> {
  const [slug, file] = process.argv.slice(2);
  if (!slug || !file) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — run with `tsx --env-file=.env`");
  }

  const source = path.resolve(file);
  const raw = await readFile(source);
  if (raw.length === 0) throw new Error(`${file} is empty`);
  if (raw.length > MAX_BYTES) {
    throw new Error(`${file} is ${(raw.length / 1e6).toFixed(1)} MB — the limit is 10 MB`);
  }

  // Same normalisation the dashboard runs: the stored bytes are what
  // `normalizeImage` re-encodes, not what the caller handed us.
  const normalized = await normalizeImage(raw);
  if (!normalized.ok) throw new Error(`${file} is not a usable image (${normalized.error})`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const venue = await prisma.venue.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, name: true, tenantId: true, branding: true, enabledLocales: true },
    });
    if (!venue) throw new Error(`no venue with slug "${slug}" in this database`);

    const storageKey = `${venue.tenantId}/uploads/${randomUUID()}`;
    await writeUpload(storageKey, normalized.bytes);

    await prisma.media.create({
      data: {
        tenantId: venue.tenantId,
        storageKey,
        width: normalized.width,
        height: normalized.height,
        bytes: normalized.bytes.length,
        altText: `${venue.name} logo`,
      },
    });

    const branding = {
      ...((venue.branding ?? {}) as Record<string, unknown>),
      logoKey: storageKey,
    };
    await prisma.venue.update({ where: { id: venue.id }, data: { branding } });

    const purge = await purgeUrls(buildMenuPurgeUrls(venue.enabledLocales));

    process.stdout.write(
      [
        `logo set for ${venue.name} (${slug})`,
        `  source     ${path.relative(process.cwd(), source)}`,
        `  stored     ${storageKey}`,
        `  size       ${normalized.width}×${normalized.height}, ${normalized.bytes.length} bytes`,
        `  cdn purge  ${purge}`,
        "",
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\nset-venue-logo failed — ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
