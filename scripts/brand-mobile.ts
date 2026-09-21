/**
 * Re-brands the Expo app for a venue: `pnpm brand:mobile --venue <slug>`.
 *
 * The native app ships one binary per restaurant, so everything that makes it
 * "theirs" — launcher name, deep-link scheme, store ids, icon, splash,
 * palette — has to come from that venue's row rather than from hand-edited
 * files. This script is the whole seam:
 *
 *   venues.branding  ──►  src/lib/mobile-brand.ts (pure derivation)
 *                          ├─► mobile/brand.generated.json  → app.config.js
 *                          ├─► mobile/src/brand.generated.ts → theme.ts
 *                          └─► mobile/assets/generated/*.png (sharp)
 *
 * Nothing here is Rangla-specific: point it at any venue slug and the app
 * rebuilds around that venue's menu theme and logo. Re-running is idempotent
 * — same row in, byte-identical files out.
 *
 * Usage
 *   pnpm brand:mobile                          # the only venue, or $BRAND_MOBILE_VENUE
 *   pnpm brand:mobile --venue rangla-punjab
 *   pnpm brand:mobile --venue demo --dry-run   # print the plan, write nothing
 *   pnpm brand:mobile --no-db --name "Cafe X" --slug cafe-x --theme ivory-day --logo ./logo.png
 *
 * Options
 *   --venue <slug>          venue to brand for (default: $BRAND_MOBILE_VENUE, or the only venue)
 *   --theme <id>            override the venue's menu theme
 *   --name <text>           override the app display name
 *   --slug <slug>           override the slug that seeds scheme + store ids
 *   --logo <path>           use a local image instead of the venue's uploaded logo
 *   --icon <path>           finished launcher icon (square, full-bleed) — replaces the
 *                           logo-on-red icon only; splash/favicon/in-app logo unchanged.
 *                           Default: public/brand/<slug>-mobile-app-icon.{png,jpg,jpeg} if present
 *   --hero <path>           use a local image for the hero artwork
 *   --api-url <url>         record the production API base in extra.brand.apiUrl
 *   --bundle-prefix <id>    reverse-DNS prefix for store ids (default com.elvoria)
 *   --version <x.y.z>       app version written to the Expo config
 *   --mobile-dir <path>     Expo project root (default <repo>/mobile)
 *   --no-db                 skip the database entirely (needs --name/--slug/--theme)
 *   --dry-run               print the palette + file plan, write nothing
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";

import { contrastRatio, hexToRgb } from "../src/lib/contrast";
import { readUpload } from "../src/lib/image-storage";
import { resolveMenuBackdrop } from "../src/lib/menu-themes";
import {
  buildBrandManifest,
  deriveMobileBrand,
  GENERATED_ASSET_DIR,
  renderBrandModule,
  type MobileBrand,
} from "../src/lib/mobile-brand";

const ICON_PX = 1024;
const FAVICON_PX = 64;
const LOGO_PX = 512;
/** Fraction of the canvas the mark occupies, per Android/iOS icon guidance. */
const ICON_INSET = 0.74;
const ADAPTIVE_INSET = 0.62; // Android crops to the inner ~66% circle.
/**
 * A finished, full-bleed launcher icon inset into Android's adaptive
 * foreground. Android draws a 108dp layer but guarantees only the inner 72dp
 * (0.667 of the canvas, radius 1/3) survives every OEM mask.
 *
 * The old 0.66 came from reading that number as "scale the square to 0.66" —
 * but a *square* of side 0.66 has corners 0.467 from the centre, half again
 * as far out as the safe circle's 1/3. Nothing showed it until the icon grew
 * a wordmark: "RESTAURANT" runs the full width along the bottom, so its R and
 * T sat exactly where a circular mask cuts, and both lost their outer half.
 *
 * What actually has to fit is the artwork's *ink*, not its bounding square.
 * The Rangla master's furthest ink pixel (the R's bottom-left serif) sits
 * 0.573 of the canvas from the centre, so the largest inset that keeps it
 * inside is (1/3) / 0.573 = 0.581. 0.57 takes that with a hair to spare.
 *
 * Swapping in a master whose ink reaches further needs this re-measured —
 * `scripts/brand-mobile.test.ts` fails if the shipped foreground breaks the
 * safe circle, so it will say so.
 */
const FINISHED_ICON_INSET = 0.57;
const SPLASH_INSET = 0.7;
/** Hero is a full-bleed background on a phone in portrait, so it goes wide. */
const HERO_W = 1440;
const HERO_H = 900;

interface Options {
  venue?: string;
  theme?: string;
  name?: string;
  slug?: string;
  logo?: string;
  /** A finished launcher icon: used as-is for the app icon, nothing else. */
  icon?: string;
  hero?: string;
  apiUrl?: string;
  bundlePrefix?: string;
  version?: string;
  mobileDir: string;
  useDb: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    mobileDir: path.join(process.cwd(), "mobile"),
    useDb: true,
    dryRun: false,
  };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v == null || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--venue":
        opts.venue = value(i, arg);
        i++;
        break;
      case "--theme":
        opts.theme = value(i, arg);
        i++;
        break;
      case "--name":
        opts.name = value(i, arg);
        i++;
        break;
      case "--slug":
        opts.slug = value(i, arg);
        i++;
        break;
      case "--icon":
        opts.icon = value(i, arg);
        i += 1;
        break;
      case "--logo":
        opts.logo = value(i, arg);
        i++;
        break;
      case "--hero":
        opts.hero = value(i, arg);
        i++;
        break;
      case "--api-url":
        opts.apiUrl = value(i, arg);
        i++;
        break;
      case "--bundle-prefix":
        opts.bundlePrefix = value(i, arg);
        i++;
        break;
      case "--version":
        opts.version = value(i, arg);
        i++;
        break;
      case "--mobile-dir":
        opts.mobileDir = path.resolve(value(i, arg));
        i++;
        break;
      case "--no-db":
        opts.useDb = false;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

function usage(): string {
  return [
    "pnpm brand:mobile [--venue <slug>] [options]",
    "",
    "  --venue <slug>        venue to brand for (default: $BRAND_MOBILE_VENUE, or the only venue)",
    "  --theme <id>          override the venue's menu theme",
    "  --name <text>         override the app display name",
    "  --slug <slug>         override the slug seeding scheme + store ids",
    "  --logo <path>         use a local image instead of the venue's uploaded logo",
    "  --icon <path>         finished launcher icon (square); default public/brand/<slug>-mobile-app-icon.*",
    "  --hero <path>         use a local image for the hero artwork",
    "  --api-url <url>       record the production API base in extra.brand.apiUrl",
    "  --bundle-prefix <id>  reverse-DNS prefix for store ids (default com.elvoria)",
    "  --version <x.y.z>     app version written to the Expo config",
    "  --mobile-dir <path>   Expo project root (default <repo>/mobile)",
    "  --no-db               skip the database (needs --name/--slug/--theme)",
    "  --dry-run             print the palette + file plan, write nothing",
  ].join("\n");
}

// ------------------------------------------------------------------ the venue

interface VenueRow {
  name: string;
  slug: string;
  theme: string | null;
  logoKey: string | null;
  bannerKey: string | null;
  backdrop: string | null;
  /** `branding.halalFilter === "on"` — the app's halal mark hangs off this. */
  halal: boolean;
}

/**
 * Reads through the migration connection, not the app role: this is a build
 * tool run by an operator against one named venue, not tenant-scoped request
 * traffic, so there is no session tenant for RLS to key on.
 */
async function loadVenue(slug: string | undefined): Promise<VenueRow> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (run via `pnpm brand:mobile`, or pass --no-db)");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const venues = await prisma.venue.findMany({
      where: { deletedAt: null, ...(slug ? { slug } : {}) },
      select: { name: true, slug: true, branding: true },
      orderBy: { createdAt: "asc" },
      take: 25,
    });
    if (venues.length === 0) {
      throw new Error(slug ? `no venue with slug "${slug}"` : "no venues in this database");
    }
    if (venues.length > 1) {
      const list = venues.map((v) => `  --venue ${v.slug}   (${v.name})`).join("\n");
      throw new Error(`${venues.length} venues found — pick one:\n${list}`);
    }
    const venue = venues[0]!;
    const branding = (venue.branding ?? {}) as Record<string, unknown>;
    return {
      name: venue.name,
      slug: venue.slug,
      theme: typeof branding.theme === "string" ? branding.theme : null,
      logoKey: typeof branding.logoKey === "string" ? branding.logoKey : null,
      bannerKey: typeof branding.bannerKey === "string" ? branding.bannerKey : null,
      backdrop: typeof branding.backdrop === "string" ? branding.backdrop : null,
      halal: branding.halalFilter === "on",
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ------------------------------------------------------------------- the mark

interface Mark {
  bytes: Buffer;
  source: string;
  hasAlpha: boolean;
}

/**
 * The mark every asset is built from: the venue's uploaded logo when it has
 * one, a local file when `--logo` points at one, otherwise an initials
 * monogram so a venue that never uploaded a logo still gets a coherent icon
 * set instead of a broken build.
 */
async function loadMark(opts: Options, venue: VenueRow, brand: MobileBrand): Promise<Mark> {
  if (opts.logo) {
    const bytes = await readFile(path.resolve(opts.logo));
    return { ...(await describe(bytes)), source: opts.logo };
  }
  if (venue.logoKey) {
    const bytes = await readUpload(venue.logoKey);
    if (bytes) return { ...(await describe(bytes)), source: `upload:${venue.logoKey}` };
    process.stderr.write(
      `! branding.logoKey "${venue.logoKey}" is not on disk — falling back to a monogram\n`,
    );
  }
  const bytes = await monogram(brand);
  return { ...(await describe(bytes)), source: "monogram (no logo uploaded)" };
}

/**
 * The finished launcher icon, if one exists: `--icon <path>`, else the
 * convention `public/brand/<slug>-mobile-app-icon.{png,jpg,jpeg}` next to the
 * web app's other brand files — so `pnpm brand:mobile --venue <slug>` keeps
 * using it on every rebrand without anyone remembering a flag.
 */
async function loadFinishedIcon(
  opts: Options,
  brand: MobileBrand,
): Promise<{ bytes: Buffer; source: string } | null> {
  const candidates = opts.icon
    ? [path.resolve(opts.icon)]
    : ["png", "jpg", "jpeg"].map((ext) =>
        path.join(process.cwd(), "public", "brand", `${brand.venue.slug}-mobile-app-icon.${ext}`),
      );
  for (const file of candidates) {
    try {
      const bytes = await readFile(file);
      const meta = await sharp(bytes).metadata();
      if (!meta.width || !meta.height || Math.abs(meta.width - meta.height) > 2) {
        throw new Error(`${file}: launcher icon must be square (got ${meta.width}×${meta.height})`);
      }
      if (meta.width < 1024) {
        console.warn(
          `! ${path.relative(process.cwd(), file)} is ${meta.width}px — 1024px+ recommended`,
        );
      }
      return { bytes, source: path.relative(process.cwd(), file) };
    } catch (err) {
      if (opts.icon) throw err; // an explicit flag must not fall back silently
    }
  }
  return null;
}

async function describe(bytes: Buffer): Promise<Omit<Mark, "source">> {
  const meta = await sharp(bytes).metadata();
  if (!meta.format) throw new Error("logo is not a decodable image");
  return { bytes, hasAlpha: Boolean(meta.hasAlpha) };
}

/**
 * Initials on a cream disc with an accent ring — legible both on the brand
 * ground (as the app icon) and on the app's page ground (as the header mark),
 * which a single flat-color monogram cannot manage.
 */
async function monogram(brand: MobileBrand): Promise<Buffer> {
  const initials =
    brand.venue.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join("") || "M";
  const size = ICON_PX;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 8}" fill="${brand.colors.cream}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 40}" fill="none"
          stroke="${brand.colors.goldSoft}" stroke-width="16"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle" fill="${brand.colors.ink}"
        font-family="Georgia, 'Times New Roman', serif" font-weight="700"
        font-size="${initials.length > 1 ? 380 : 520}">${initials}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ------------------------------------------------------------------- the hero

/**
 * Artwork behind the welcome, home and account headers. The venue's chosen
 * menu backdrop comes first: those files are drawn as full-page grounds, so
 * they survive being cropped to a phone and carry no baked-in text. An
 * uploaded banner is the fallback — it is composed for a wide web header, and
 * cropping one to portrait usually slices its wordmark in half. Last resort is
 * a gradient painted from the palette; never another restaurant's photograph.
 */
async function loadHero(
  opts: Options,
  venue: VenueRow,
  brand: MobileBrand,
): Promise<{ bytes: Buffer; source: string }> {
  if (opts.hero) {
    return { bytes: await readFile(path.resolve(opts.hero)), source: opts.hero };
  }
  const backdrop = resolveMenuBackdrop(venue.backdrop);
  if (backdrop.image) {
    const file = path.join(process.cwd(), "public", backdrop.image.replace(/^\//, ""));
    try {
      return { bytes: await readFile(file), source: `backdrop:${backdrop.id}` };
    } catch {
      process.stderr.write(`! backdrop image ${backdrop.image} is missing\n`);
    }
  }
  if (venue.bannerKey) {
    const bytes = await readUpload(venue.bannerKey);
    if (bytes) return { bytes, source: `upload:${venue.bannerKey}` };
    process.stderr.write(`! branding.bannerKey "${venue.bannerKey}" is not on disk\n`);
  }
  return { bytes: await heroGradient(brand), source: "palette gradient (no banner or backdrop)" };
}

/** Brand-coloured stand-in: a diagonal wash with a few soft accent arcs. */
async function heroGradient(brand: MobileBrand): Promise<Buffer> {
  const { red, redDark, goldSoft } = brand.colors;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${HERO_W}" height="${HERO_H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${red}"/><stop offset="1" stop-color="${redDark}"/>
  </linearGradient></defs>
  <rect width="${HERO_W}" height="${HERO_H}" fill="url(#g)"/>
  <g fill="none" stroke="${goldSoft}" stroke-opacity="0.22" stroke-width="3">
    <circle cx="${HERO_W * 0.18}" cy="${HERO_H * 0.24}" r="${HERO_H * 0.3}"/>
    <circle cx="${HERO_W * 0.78}" cy="${HERO_H * 0.72}" r="${HERO_H * 0.44}"/>
    <circle cx="${HERO_W * 0.52}" cy="${HERO_H * 0.1}" r="${HERO_H * 0.18}"/>
  </g>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * The artwork's average colour, lifted 18% toward white so the solved scrim
 * still covers the image's brighter passages rather than only its mean.
 */
async function heroGround(bytes: Buffer): Promise<string> {
  const { channels } = await sharp(bytes).stats();
  const [r, g, b] = channels.map((channel) => channel.mean);
  const lift = (value = 0) => Math.round(value + (255 - value) * 0.18);
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${hex(lift(r))}${hex(lift(g))}${hex(lift(b))}`;
}

// ------------------------------------------------------------------- rasters

function rgba(hex: string, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return { r, g, b, alpha };
}

/** The mark, contained inside a transparent square of `size`. */
async function contain(mark: Buffer, size: number, inset: number): Promise<Buffer> {
  const inner = Math.round(size * inset);
  const scaled = await sharp(mark)
    .resize(inner, inner, { fit: "inside", background: rgba("#000000", 0) })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: rgba("#000000", 0) },
  })
    .composite([{ input: scaled, gravity: "center" }])
    .png()
    .toBuffer();
}

/** The mark on a solid ground — app icon and favicon. */
async function onGround(mark: Buffer, size: number, inset: number, hex: string): Promise<Buffer> {
  const layer = await contain(mark, size, inset);
  return sharp({ create: { width: size, height: size, channels: 4, background: rgba(hex) } })
    .composite([{ input: layer }])
    .png()
    .toBuffer();
}

async function solid(size: number, hex: string): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: rgba(hex) } })
    .png()
    .toBuffer();
}

/**
 * Android's themed-icon layer: the mark's own alpha, painted white. Only
 * meaningful for a logo with transparency — an opaque rectangle would tint as
 * a grey box, so those venues get no monochrome layer at all.
 */
async function monochromeLayer(mark: Buffer, size: number): Promise<Buffer> {
  const layer = await contain(mark, size, ADAPTIVE_INSET);
  const alpha = await sharp(layer).ensureAlpha().extractChannel(3).toColourspace("b-w").toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: rgba("#ffffff") } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
}

async function buildAssets(
  brand: MobileBrand,
  mark: Mark,
  hero: Buffer,
  /** A finished, full-bleed launcher icon. When present it IS the app icon:
   *  iOS gets it edge to edge (the OS applies its own corner mask); Android's
   *  adaptive foreground gets it inset on a white ground so the launcher's
   *  circle/squircle crop trims only the artwork's own white margin. Splash,
   *  favicon and the in-app logo still come from the venue mark. */
  finishedIcon?: Buffer | null,
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const rel = (assetPath: string) => assetPath.replace(/^\.\//, "");
  if (finishedIcon) {
    files.set(
      rel(brand.assets.icon),
      await sharp(finishedIcon)
        .resize(ICON_PX, ICON_PX, { fit: "cover", position: "centre" })
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer(),
    );
    files.set(
      rel(brand.assets.adaptiveForeground),
      await contain(finishedIcon, ICON_PX, FINISHED_ICON_INSET),
    );
    files.set(rel(brand.assets.adaptiveBackground), await solid(ICON_PX, "#ffffff"));
  } else {
    files.set(
      rel(brand.assets.icon),
      await onGround(mark.bytes, ICON_PX, ICON_INSET, brand.colors.red),
    );
    files.set(
      rel(brand.assets.adaptiveForeground),
      await contain(mark.bytes, ICON_PX, ADAPTIVE_INSET),
    );
    files.set(rel(brand.assets.adaptiveBackground), await solid(ICON_PX, brand.colors.red));
  }
  if (brand.assets.adaptiveMonochrome) {
    files.set(rel(brand.assets.adaptiveMonochrome), await monochromeLayer(mark.bytes, ICON_PX));
  }
  files.set(rel(brand.assets.splash), await contain(mark.bytes, ICON_PX, SPLASH_INSET));
  files.set(
    rel(brand.assets.favicon),
    await onGround(mark.bytes, FAVICON_PX, ICON_INSET, brand.colors.red),
  );
  files.set(
    rel(brand.assets.hero),
    await sharp(hero)
      .resize(HERO_W, HERO_H, { fit: "cover", position: "centre" })
      .flatten({ background: rgba(brand.colors.red) })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer(),
  );
  files.set(
    rel(brand.assets.logo),
    await sharp(mark.bytes)
      .resize(LOGO_PX, LOGO_PX, { fit: "inside", background: rgba("#000000", 0) })
      .png()
      .toBuffer(),
  );
  return files;
}

// -------------------------------------------------------------------- report

/** The pairings mobile/src actually renders — printed so a re-brand is auditable. */
const CHECKS: [string, keyof MobileBrand["colors"], keyof MobileBrand["colors"]][] = [
  ["header title on chrome", "onRed", "red"],
  ["accent on chrome", "goldSoft", "red"],
  ["CTA label on accent fill", "ink", "goldSoft"],
  ["price on card", "red", "creamCard"],
  ["body on card", "ink", "creamCard"],
  ["muted body on page", "inkSoft", "cream"],
  ["success on card", "positive", "creamCard"],
  ["error on card", "danger", "creamCard"],
];

function report(
  brand: MobileBrand,
  mark: Mark,
  heroSource: string,
  files: Map<string, Buffer>,
  dryRun: boolean,
): void {
  const out = process.stdout;
  out.write(`\n${dryRun ? "would brand" : "branded"} the Expo app for ${brand.venue.name}\n`);
  out.write(`  venue        ${brand.venue.slug}  ·  theme ${brand.venue.themeId}\n`);
  out.write(`  app name     ${brand.app.name}\n`);
  out.write(`  expo slug    ${brand.app.slug}\n`);
  out.write(`  scheme       ${brand.app.scheme}://\n`);
  out.write(`  ios / android ${brand.app.iosBundleIdentifier} / ${brand.app.androidPackage}\n`);
  out.write(`  version      ${brand.app.version}\n`);
  out.write(
    `  mark         ${mark.source}${mark.hasAlpha ? "" : " (opaque — no monochrome icon)"}\n`,
  );
  out.write(`  hero         ${heroSource}\n`);
  out.write(`  api url      ${brand.apiUrl ?? "(build-time EXPO_PUBLIC_API_URL)"}\n`);

  out.write(`  scrim        ${brand.scrim}\n`);
  out.write("\n  palette\n");
  for (const [token, value] of Object.entries(brand.colors)) {
    out.write(`    ${token.padEnd(10)} ${value}\n`);
  }
  out.write("\n  contrast (WCAG AA needs 4.5:1)\n");
  for (const [label, fg, bg] of CHECKS) {
    const ratio = contrastRatio(brand.colors[fg], brand.colors[bg]);
    out.write(`    ${ratio >= 4.5 ? "✓" : "✗"} ${ratio.toFixed(2).padStart(5)}:1  ${label}\n`);
  }
  out.write(`\n  files\n`);
  for (const name of files.keys()) out.write(`    ${name}\n`);
}

// ---------------------------------------------------------------------- main

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  let venue: VenueRow;
  if (opts.useDb) {
    venue = await loadVenue(opts.venue ?? process.env.BRAND_MOBILE_VENUE ?? undefined);
  } else {
    if (!opts.name || !opts.slug) throw new Error("--no-db needs --name and --slug");
    venue = {
      name: opts.name,
      slug: opts.slug,
      theme: opts.theme ?? null,
      logoKey: null,
      bannerKey: null,
      backdrop: null,
      // No database to read the flag from, and a build tool must never
      // invent a certification claim: --no-db is always "not halal".
      halal: false,
    };
  }

  const input = {
    name: opts.name ?? venue.name,
    slug: opts.slug ?? venue.slug,
    themeId: opts.theme ?? venue.theme,
    logoKey: venue.logoKey,
    bannerKey: venue.bannerKey,
    backdropId: venue.backdrop,
    halal: venue.halal,
    apiUrl: opts.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? null,
    bundlePrefix: opts.bundlePrefix,
    version: opts.version,
  };

  // Derived twice: the first pass only supplies the palette the monogram
  // fallback paints itself in; the mark then decides whether a monochrome
  // icon is emitted at all.
  // Two passes on purpose: the palette is a pure function of the theme, so the
  // provisional brand is what the monogram and gradient fallbacks paint
  // themselves in. Only the icon set (does the logo have alpha?) and the scrim
  // (how light is the hero?) depend on the images, so the second pass folds
  // those measurements in.
  const provisional = deriveMobileBrand(input);
  const mark = await loadMark(opts, venue, provisional);
  const hero = await loadHero(opts, venue, provisional);
  const brand = deriveMobileBrand({
    ...input,
    monochrome: mark.hasAlpha,
    heroGroundHex: await heroGround(hero.bytes),
  });
  const finishedIcon = await loadFinishedIcon(opts, brand);
  const files = await buildAssets(brand, mark, hero.bytes, finishedIcon?.bytes ?? null);

  const manifestPath = path.join(opts.mobileDir, "brand.generated.json");
  const modulePath = path.join(opts.mobileDir, "src", "brand.generated.ts");
  const plan = new Map<string, Buffer>([
    ...[...files].map(
      ([name, bytes]) => [path.join(opts.mobileDir, name), bytes] as [string, Buffer],
    ),
    [manifestPath, Buffer.from(`${JSON.stringify(buildBrandManifest(brand), null, 2)}\n`)],
    [modulePath, Buffer.from(renderBrandModule(brand))],
  ]);

  if (!opts.dryRun) {
    await mkdir(path.join(opts.mobileDir, GENERATED_ASSET_DIR), { recursive: true });
    for (const [file, bytes] of plan) await writeFile(file, bytes);
  }
  report(
    brand,
    mark,
    hero.source,
    new Map([...plan].map(([file, bytes]) => [path.relative(opts.mobileDir, file), bytes])),
    opts.dryRun,
  );
  if (opts.dryRun) process.stdout.write("\n  --dry-run: nothing written\n");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\nbrand:mobile failed — ${error instanceof Error ? error.message : error}\n`,
  );
  process.exitCode = 1;
});
