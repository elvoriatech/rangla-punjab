import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * Convert the marketing screenshots + culture tiles to right-sized WebP
 * and delete the heavyweight originals. Run after every
 * capture-marketing/capture-menus pass:
 *
 *   pnpm exec tsx scripts/optimize-marketing.ts
 *
 * Product screenshots render at ≤ ~800 CSS px on the landing page, so
 * 1600 px (retina 2×) is plenty — the raw captures are 2880 px PNGs at
 * up to 1.4 MB each.
 */

const DIRS = ["public/marketing", "public/marketing/culture"];
const MAX_WIDTH = 1600;
const QUALITY = 80;

async function main(): Promise<void> {
  let before = 0;
  let after = 0;
  for (const dir of DIRS) {
    for (const file of readdirSync(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (![".png", ".jpeg", ".jpg"].includes(ext)) continue;
      const src = path.join(dir, file);
      const out = path.join(dir, `${path.basename(file, ext)}.webp`);
      const size = statSync(src).size;
      before += size;
      const img = sharp(src);
      const meta = await img.metadata();
      await img
        .resize({ width: Math.min(meta.width ?? MAX_WIDTH, MAX_WIDTH), withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(out);
      after += statSync(out).size;
      unlinkSync(src);
      console.log(
        `✓ ${file} ${(size / 1024).toFixed(0)}KB → ${path.basename(out)} ${(statSync(out).size / 1024).toFixed(0)}KB`,
      );
    }
  }
  console.log(
    `total: ${(before / 1024 / 1024).toFixed(1)}MB → ${(after / 1024 / 1024).toFixed(1)}MB`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
