/**
 * Derives every brand PNG the WEB serves from the two 1024² masters.
 *
 *   public/brand/rangla-logo.png                  → the venue mark (logo-*)
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
 * Re-run after replacing a master:  pnpm brand:web
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const LOGO_MASTER = "public/brand/rangla-logo.png";
const ICON_MASTER = "public/brand/rangla-punjab-mobile-app-icon.jpeg";

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
  // Web-app manifest icons (src/app/manifest.ts, src/lib/venue-manifest.ts).
  // The 192 is fetched during the installability check on every audit.
  { file: "public/brand/icon-192.png", master: ICON_MASTER, size: 192, critical: true },
  { file: "public/brand/icon-512.png", master: ICON_MASTER, size: 512 },
  // apple-touch-icon (src/app/layout.tsx, src/lib/menu-images.ts) + the 512
  // sibling kept beside it for parity with the manifest pair.
  { file: "public/rangla-icon-180.png", master: ICON_MASTER, size: 180 },
  { file: "public/rangla-icon-512.png", master: ICON_MASTER, size: 512 },
];

/** A critical-path icon over this is a regression worth failing on. */
const CRITICAL_BUDGET_BYTES = 25_000;

async function main(): Promise<void> {
  const root = process.cwd();
  let failed = false;

  for (const out of OUTPUTS) {
    const master = await readFile(path.join(root, out.master));
    const before = await stat(path.join(root, out.file)).then(
      (s) => s.size,
      () => 0,
    );
    const png = await sharp(master)
      .resize(out.size, out.size, { fit: "cover", kernel: "lanczos3" })
      // `palette` routes through libimagequant — same engine as pngquant,
      // no external binary, so this runs anywhere `sharp` installs.
      .png({ palette: true, quality: 85, effort: 10, compressionLevel: 9 })
      .toBuffer();
    await writeFile(path.join(root, out.file), png);

    const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
    console.log(
      `${out.file.padEnd(32)} ${out.size}²  ${kb(before).padStart(9)} → ${kb(png.length).padStart(9)}`,
    );
    if (out.critical && png.length > CRITICAL_BUDGET_BYTES) {
      console.error(
        `  ✗ ${out.file} is ${kb(png.length)}, over the ${kb(CRITICAL_BUDGET_BYTES)} critical-path budget`,
      );
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
