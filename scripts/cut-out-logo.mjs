/**
 * The venue's mascot, cut off the white card it is drawn on.
 *
 * The launch screen shows the logo straight on the red (owner,
 * 2026-09-22: "there is no background of logo") — no cream medallion, no
 * white square. The source art is a mascot on white, so the white has to
 * go, and it cannot go by colour alone: the mascot's own shirt and
 * turban are white too.
 *
 * So the background is taken by a FLOOD FILL from the edges. White that
 * is connected to the border is the card; white inside the figure is the
 * figure, because the artist drew a black outline all the way round it
 * and the fill cannot cross it.
 *
 * Run: node scripts/cut-out-logo.mjs
 */
import sharp from "sharp";

const SRC = "public/brand/rangla-logo.png";
const DEST = "mobile/assets/logo-cutout.png";

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const near = (i) => {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const min = Math.min(r, g, b);
  return min > 232 && Math.max(r, g, b) - min < 14;
};

const bg = new Uint8Array(W * H);
const queue = [];
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = y * W + x;
  if (bg[p]) return;
  if (!near(p * C)) return;
  bg[p] = 1;
  queue.push(p);
};
for (let x = 0; x < W; x++) {
  push(x, 0);
  push(x, H - 1);
}
for (let y = 0; y < H; y++) {
  push(0, y);
  push(W - 1, y);
}
for (let head = 0; head < queue.length; head++) {
  const p = queue[head];
  const x = p % W, y = (p - x) / W;
  push(x + 1, y);
  push(x - 1, y);
  push(x, y + 1);
  push(x, y - 1);
}

const out = Buffer.from(data);
let cleared = 0;
for (let p = 0; p < W * H; p++) {
  if (bg[p]) {
    out[p * C + 3] = 0;
    cleared++;
  }
}
console.log(`cleared ${((cleared / (W * H)) * 100).toFixed(1)}% of the canvas`);

// Trim to the figure, then square it so the app can size it by one edge.
const cut = await sharp(out, { raw: { width: W, height: H, channels: C } }).png().toBuffer();
const trimmed = await sharp(cut).trim({ threshold: 1 }).toBuffer();
const t = await sharp(trimmed).metadata();
const side = Math.max(t.width, t.height);
await sharp({
  create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: trimmed, gravity: "center" }])
  .png({ compressionLevel: 9 })
  .toFile(DEST);
const m = await sharp(DEST).metadata();
console.log(DEST, m.width + "x" + m.height, "(figure was " + t.width + "x" + t.height + ")");
