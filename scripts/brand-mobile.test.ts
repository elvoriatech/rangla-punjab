/**
 * Guards the one property of the generated launcher icon that no reviewer
 * catches by eye and no screenshot of *this* phone proves: that the Android
 * adaptive foreground survives every OEM mask.
 *
 * Android hands the launcher a 108dp foreground layer and lets it crop to
 * whatever shape it likes — circle, squircle, teardrop. Only the inner 72dp
 * (two thirds of the canvas, radius 1/3) is guaranteed to survive. Artwork
 * outside that ring is a coin flip per device.
 *
 * It bit us once: `FINISHED_ICON_INSET` was 0.66, read as "two thirds of the
 * canvas", but that scales the artwork's *square* to 0.66 — and a square of
 * side 0.66 reaches 0.467 from the centre at its corners, half again past the
 * safe radius. Nothing looked wrong until the icon grew a wordmark, and then
 * "RESTAURANT" lost its R and its T on any launcher with a circular mask.
 *
 * So the assertion is on the *ink*, not on the constant and not on the layer's
 * opacity: the foreground is stacked on the background exactly as Android
 * stacks them, and no pixel that differs from that background may sit further
 * than 1/3 of the canvas from its centre. Measuring opacity instead would fail
 * on a white-square master for free — those corners are opaque, but they are
 * white on white and nobody can see them clipped.
 *
 * Re-run `pnpm brand:mobile --venue <slug>` after swapping a master; if a
 * busier piece of art pushes past the ring, this fails and the inset needs
 * re-measuring (the factor to shrink by is printed in the failure message).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

const GENERATED = path.join(process.cwd(), "mobile/assets/generated");
const FOREGROUND = path.join(GENERATED, "adaptive-foreground.png");
const BACKGROUND = path.join(GENERATED, "adaptive-background.png");

/** Android's guaranteed-visible zone: 72dp of a 108dp canvas ⇒ radius 1/3. */
const SAFE_RADIUS = 1 / 3;
/** How far a channel must move off the background before it reads as artwork. */
const INK_DELTA = 24;

/**
 * How far the artwork's furthest visible pixel sits from the centre of the
 * stacked icon, as a fraction of the canvas. 0.5 is the middle of an edge,
 * 0.707 a corner.
 */
async function inkRadius(): Promise<{ radius: number; at: [number, number] }> {
  const foreground = await sharp(await readFile(FOREGROUND))
    .png()
    .toBuffer();
  const { info: fg } = await sharp(foreground).toBuffer({ resolveWithObject: true });
  const background = await sharp(await readFile(BACKGROUND))
    .resize(fg.width, fg.height)
    .toBuffer();

  // What the launcher actually draws, and what it draws it on.
  const stacked = await sharp(background)
    .composite([{ input: foreground }])
    .raw()
    .toBuffer();
  const ground = await sharp(background).raw().toBuffer({ resolveWithObject: true });
  const channels = ground.info.channels;

  let radius = 0;
  let at: [number, number] = [0, 0];
  for (let y = 0; y < fg.height; y++) {
    for (let x = 0; x < fg.width; x++) {
      const i = (y * fg.width + x) * channels;
      let ink = false;
      for (let c = 0; c < Math.min(channels, 3); c++) {
        if (Math.abs(stacked[i + c] - ground.data[i + c]) > INK_DELTA) ink = true;
      }
      if (!ink) continue;
      const r = Math.hypot((x + 0.5) / fg.width - 0.5, (y + 0.5) / fg.height - 0.5);
      if (r > radius) {
        radius = r;
        at = [x, y];
      }
    }
  }
  return { radius, at };
}

describe("android adaptive foreground", () => {
  it("keeps every visible pixel of the artwork inside the 72/108 safe circle", async () => {
    const { radius, at } = await inkRadius();
    expect(
      radius,
      `artwork reaches ${radius.toFixed(4)} of the canvas from the centre at pixel ` +
        `[${at.join(", ")}], past Android's ${SAFE_RADIUS.toFixed(4)} safe radius — a circular ` +
        `mask would cut it. Lower FINISHED_ICON_INSET in scripts/brand-mobile.ts by ` +
        `${(SAFE_RADIUS / radius).toFixed(3)}× and re-run \`pnpm brand:mobile\`.`,
    ).toBeLessThanOrEqual(SAFE_RADIUS);
  });
});
