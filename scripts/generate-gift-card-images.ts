/**
 * Generates the three default gift-card images shipped in
 * `public/brand/gift-cards/`.
 *
 * Owner decision 2026-09-21: no card art — every voucher shows just the
 * restaurant's logo (`mobile/assets/source/logo.jpeg`) centred on a plain
 * white field. The three files stay separate (one per seeded design,
 * matching the `imageKey`s in `gift-card-service.ts`) so an owner can
 * still replace any one of them from the dashboard, but they are
 * identical by default.
 *
 * Still WORDLESS — no card name, no price, no language — for the same
 * reason as before: the owner renames the designs and the guest picks the
 * amount, so any baked-in text would soon be wrong.
 *
 * PNG rather than SVG because the same URL is rendered by React Native's
 * <Image> in the Expo app, which will not rasterise a remote SVG.
 *
 * Re-run with:  pnpm exec tsx scripts/generate-gift-card-images.ts
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** Credit-card proportions (85.6 × 54 mm ≈ 1.586:1), at 2× for retina. */
const WIDTH = 1024;
const HEIGHT = 646;
/** The logo's square side: most of the card's height, with a margin. */
const LOGO_SIDE = 560;

const SLUGS = ["kleine-freude", "genussabend", "festmahl"] as const;

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), "public", "brand", "gift-cards");
  await mkdir(outDir, { recursive: true });

  // The logo artwork already sits on white, so a white field makes it
  // seamless — no edge where the square image meets the card.
  const logo = await sharp(path.join(process.cwd(), "mobile", "assets", "source", "logo.jpeg"))
    .resize(LOGO_SIDE, LOGO_SIDE)
    .toBuffer();

  for (const slug of SLUGS) {
    await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: "#ffffff" } })
      .composite([{ input: logo, gravity: "center" }])
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toFile(path.join(outDir, `${slug}.png`));
    console.log(`wrote ${slug}.png`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
