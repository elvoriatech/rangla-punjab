/**
 * Derives every brand PNG the WEB serves from the two 1024² masters.
 *
 *   public/brand/rangla-logo.png                  → the venue mark (logo-*),
 *                                                   the favicon + apple-touch icon
 *   public/brand/rangla-punjab-mobile-app-icon.*  → the launcher art (icon-*)
 *
 * The mobile app's own assets are NOT our business — `scripts/brand-mobile.ts`
 * owns `mobile/assets/*`. This script only writes into `public/`.
 *
 * Why it exists: the icons dropped in by hand for the September 2026 rebrand
 * were straight 24-bit exports — 96 kB at 192², 610 kB at 512². Two of them
 * (`brand/logo-192.png` behind the public menu's venue mark, `brand/icon-192.png`
 * behind the web-app manifest) are fetched on every guest page load, so they
 * alone put the Lighthouse `resource-summary:total:size` budget in
 * `lighthouserc.json` 63 kB over the line.
 *
 * The art is a flat-shaded illustration, so a 256-colour palette is visually
 * indistinguishable from the 24-bit original even magnified — see the 96 px
 * A/B in the P1-26 fix — and costs a quarter of the bytes. Everything stays
 * PNG: the manifest and apple-touch-icon consumers require it, and the email
 * templates (`src/emails/layout.tsx` renders `logo-192` at 84²) reach mail
 * clients that still do not decode WebP.
 *
 * Which master feeds what (September 2026 — "favicon also for website"):
 *   • Browser-chrome icons — `favicon.ico`, the 180 apple-touch icon and its
 *     512 sibling — come from the LOGO. A tab, a bookmark and a home-screen
 *     shortcut are the website wearing its face, and the face is the turbaned
 *     character, not the lettered app-icon artwork.
 *   • PWA *install* icons — `brand/icon-192/512.png` — stay on the app icon,
 *     so an installed web app and the native app share one launcher mark.
 *
 * The logo is a character floating in a white square, and at 16 px the whole
 * figure collapses into a smudge. The `.ico` frames therefore crop to the
 * head + turban (the top HEAD_FRACTION of the artwork's content box, then
 * tightened to its own ink and re-squared with a hair of white margin), which
 * still reads as *this* restaurant a tab-width away. The 180 and 512 are large
 * enough to carry the whole figure, so they keep it.
 *
 * Re-run after replacing a master:  pnpm brand:web
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const LOGO_MASTER = "public/brand/rangla-logo.png";
const ICON_MASTER = "public/brand/rangla-punjab-mobile-app-icon.jpeg";

/** How much of the artwork's content box the favicon crop keeps, from the top. */
const HEAD_FRACTION = 0.6;
/** White margin left around the cropped head, as a fraction of its long side. */
const HEAD_MARGIN = 0.06;
/**
 * Pixel distance from the corner colour that still counts as background when
 * finding the artwork's edges. The masters are drawn on flat white, so a small
 * threshold survives JPEG-ish ringing without eating the outline.
 */
const TRIM_THRESHOLD = 10;

/** The `.ico` carries these frames; 48 is what Windows shows on the taskbar. */
const FAVICON_FRAMES = [16, 32, 48] as const;

interface Output {
  /** Path under the repo root. */
  file: string;
  master: string;
  size: number;
  /** Fetched by a guest on the public menu — keep these smallest. */
  critical?: boolean;
}

const OUTPUTS: Output[] = [
  // The venue mark. Rendered at 40–44 CSS px by the public menu, 32 px in the
  // admin rail, 84 px in email. 192² covers all of them past 4× DPR.
  { file: "public/brand/logo-192.png", master: LOGO_MASTER, size: 192, critical: true },
  { file: "public/brand/logo-512.png", master: LOGO_MASTER, size: 512 },
  // Web-app *install* icons (src/app/manifest.ts, src/lib/venue-manifest.ts).
  // The 192 is fetched during the installability check on every audit. These
  // stay on the app-icon master on purpose — see the header note.
  { file: "public/brand/icon-192.png", master: ICON_MASTER, size: 192, critical: true },
  { file: "public/brand/icon-512.png", master: ICON_MASTER, size: 512 },
  // apple-touch-icon (src/app/layout.tsx, src/lib/menu-images.ts) + the 512
  // sibling kept beside it for parity with the manifest pair. Both show the
  // logo: this is the icon a guest ends up with on their home screen.
  { file: "public/rangla-icon-180.png", master: LOGO_MASTER, size: 180 },
  { file: "public/rangla-icon-512.png", master: LOGO_MASTER, size: 512 },
];

/** A critical-path icon over this is a regression worth failing on. */
const CRITICAL_BUDGET_BYTES = 25_000;
/** The favicon is requested by literally every browser on every page. */
const FAVICON_BUDGET_BYTES = 15_000;

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

/** Encodes one PNG frame at `size`², palette-quantised like every other output. */
async function renderPng(source: Buffer, size: number): Promise<Buffer> {
  return (
    sharp(source)
      .resize(size, size, { fit: "cover", kernel: "lanczos3" })
      // `palette` routes through libimagequant — same engine as pngquant,
      // no external binary, so this runs anywhere `sharp` installs.
      .png({ palette: true, quality: 85, effort: 10, compressionLevel: 9 })
      .toBuffer()
  );
}

/**
 * The bounding box of the artwork inside a master, in master pixels.
 *
 * `trim` reports how far it moved each edge, so the negated offsets are the
 * box's origin. Derived rather than hard-coded so swapping the master in
 * doesn't silently mis-crop the favicon.
 */
async function contentBox(
  master: Buffer,
): Promise<{ left: number; top: number; width: number; height: number }> {
  const { info } = await sharp(master)
    .trim({ threshold: TRIM_THRESHOLD })
    .toBuffer({ resolveWithObject: true });
  return {
    left: -(info.trimOffsetLeft ?? 0),
    top: -(info.trimOffsetTop ?? 0),
    width: info.width,
    height: info.height,
  };
}

/**
 * The head/turban region of a master as a white square, ready to downscale.
 *
 * Three steps, because each one alone leaves the 16 px frame unreadable: take
 * the top slice of the content box (drops the hands and torso), trim that
 * slice to its own ink (the head is narrower than the shoulders, so the slice
 * has slack on both sides), then pad back to a square so the `.ico` frames
 * stay undistorted.
 */
async function headCrop(master: Buffer): Promise<Buffer> {
  const box = await contentBox(master);
  const slice = await sharp(master)
    .extract({
      left: box.left,
      top: box.top,
      width: box.width,
      height: Math.round(box.height * HEAD_FRACTION),
    })
    .png()
    .toBuffer();
  // A second `sharp()` on purpose: `trim` runs before `extract` inside one
  // pipeline, which would trim the whole figure and then slice the wrong box.
  const tight = await sharp(slice).trim({ threshold: TRIM_THRESHOLD }).png().toBuffer();
  const { width = 0, height = 0 } = await sharp(tight).metadata();
  const long = Math.max(width, height);
  const side = long + Math.round(long * HEAD_MARGIN) * 2;
  const top = Math.round((side - height) / 2);
  const left = Math.round((side - width) / 2);
  return sharp(tight)
    .extend({
      top,
      bottom: side - height - top,
      left,
      right: side - width - left,
      background: "#ffffff",
    })
    .png()
    .toBuffer();
}

/**
 * Packs PNG frames into an `.ico` container.
 *
 * ICONDIR (6 bytes) + one 16-byte ICONDIRENTRY per frame + the PNG payloads.
 * PNG-in-ICO is what every browser since IE11 reads, and it is what the
 * hand-made `favicon.ico` this replaces already contained.
 */
function encodeIco(frames: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);

  const directory = Buffer.alloc(16 * frames.length);
  let offset = header.length + directory.length;
  frames.forEach((frame, i) => {
    const at = i * 16;
    // 0 means 256 in this field; every frame we ship is well under that.
    directory.writeUInt8(frame.size >= 256 ? 0 : frame.size, at);
    directory.writeUInt8(frame.size >= 256 ? 0 : frame.size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size: 0 = not a 256-colour BMP
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(frame.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += frame.png.length;
  });

  return Buffer.concat([header, directory, ...frames.map((f) => f.png)]);
}

/** Writes `file`, prints the before → after line, and reports a budget bust. */
async function emit(
  root: string,
  file: string,
  bytes: Buffer,
  label: string,
  budget?: number,
): Promise<boolean> {
  const before = await stat(path.join(root, file)).then(
    (s) => s.size,
    () => 0,
  );
  await writeFile(path.join(root, file), bytes);
  console.log(
    `${file.padEnd(32)} ${label.padEnd(10)} ${kb(before).padStart(9)} → ${kb(bytes.length).padStart(9)}`,
  );
  if (budget !== undefined && bytes.length > budget) {
    console.error(`  ✗ ${file} is ${kb(bytes.length)}, over the ${kb(budget)} budget`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const root = process.cwd();
  let ok = true;

  for (const out of OUTPUTS) {
    const master = await readFile(path.join(root, out.master));
    const png = await renderPng(master, out.size);
    ok =
      (await emit(
        root,
        out.file,
        png,
        `${out.size}²`,
        out.critical ? CRITICAL_BUDGET_BYTES : undefined,
      )) && ok;
  }

  // The favicon: head-cropped logo, one PNG per frame, packed into the .ico.
  const head = await headCrop(await readFile(path.join(root, LOGO_MASTER)));
  const frames = await Promise.all(
    FAVICON_FRAMES.map(async (size) => ({ size, png: await renderPng(head, size) })),
  );
  ok =
    (await emit(
      root,
      "public/favicon.ico",
      encodeIco(frames),
      FAVICON_FRAMES.join("/"),
      FAVICON_BUDGET_BYTES,
    )) && ok;

  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
