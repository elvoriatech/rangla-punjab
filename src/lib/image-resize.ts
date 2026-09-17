import sharp from "sharp";
import { z } from "zod";

/**
 * On-the-fly image resizing with sharp — replaces the old imgproxy hop.
 * The `/img/[key]` route reads the stored original from disk and calls
 * `resizeImage` to produce the requested width + format. Output is a
 * self-contained buffer the route caches hard (deterministic in
 * width+format), so a small VPS re-encodes each size at most once behind
 * the HTTP cache.
 */

export const AVAILABLE_FORMATS = ["webp", "avif", "jpeg", "png"] as const;
export type ImageFormat = (typeof AVAILABLE_FORMATS)[number];

/**
 * Every width the app actually asks for — nothing else is rendered.
 *
 * WHY a whitelist and not a range: `w` arrives from a query string, and
 * each distinct value is a separate sharp encode AND (now that variants
 * are cached) a separate file on the app's disk. Accepting 1–4096 let
 * anyone loop a query param to burn CPU and fill the volume that holds
 * the only copy of customer photos. Pinning the set makes the cache
 * bounded: 14 widths × 4 formats per image, worst case.
 *
 * Derived from the real call sites — keep in sync when a layout adds a
 * size, or the image silently 400s:
 *   64, 180        favicon + apple-touch-icon (`venueIcons`)
 *   80, 96         admin/dashboard thumbs, venue mark
 *   160, 240       category thumbs (+ /api/v1 category photos)
 *   192, 512       installable web-app manifest icons
 *   320, 480, 640  dish cards at 1x (+ /api/v1 item photos)
 *   640, 960, 1280 the same cards at 2x (`menuImageSrcSet` doubles)
 *   640…1920       hero banner's responsive srcset
 *
 * The mobile app never builds these URLs itself — `/api/v1/menu` hands
 * it absolute, server-built URLs (160/192/640), all of them listed here.
 */
export const ALLOWED_WIDTHS = [
  64, 80, 96, 160, 180, 192, 240, 320, 480, 512, 640, 960, 1280, 1920,
] as const;

export type AllowedWidth = (typeof ALLOWED_WIDTHS)[number];

const ALLOWED_WIDTH_SET: ReadonlySet<number> = new Set(ALLOWED_WIDTHS);

export function isAllowedWidth(width: number): boolean {
  return ALLOWED_WIDTH_SET.has(width);
}

// The largest variant we will ever render — a 1920px hero banner.
export const MAX_WIDTH = ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1];

// Same decode guard as image-normalize: reject decompression bombs.
const MAX_INPUT_PIXELS = 60_000_000;

/**
 * Cap libvips' thread pool. The app process serves guest HTML and
 * encodes images; left unbounded, sharp spawns a thread per core per
 * call and a burst of AVIF encodes starves request handling on a 1–2
 * vCPU VPS. One thread keeps image work in the background where it
 * belongs — and with the variant cache in front, each encode happens
 * once. Raise via `SHARP_CONCURRENCY` on a bigger box.
 */
const configuredConcurrency = Number.parseInt(process.env.SHARP_CONCURRENCY ?? "1", 10);
if (Number.isFinite(configuredConcurrency) && configuredConcurrency > 0) {
  sharp.concurrency(configuredConcurrency);
}

export const imgRequestSchema = z.object({
  w: z.coerce.number().int().refine(isAllowedWidth, { message: "unsupported width" }),
  fmt: z.enum(AVAILABLE_FORMATS).optional().default("webp"),
});

export type ImgRequest = z.infer<typeof imgRequestSchema>;

/**
 * Resize `src` to fit within `width` (never upscaling) and encode as
 * `fmt`. EXIF orientation is baked in first so nothing rotates.
 */
export async function resizeImage(src: Buffer, width: number, fmt: ImageFormat): Promise<Buffer> {
  let pipeline = sharp(src, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width, withoutEnlargement: true });

  if (fmt === "avif") pipeline = pipeline.avif({ quality: 50 });
  else if (fmt === "webp") pipeline = pipeline.webp({ quality: 80 });
  else if (fmt === "png") pipeline = pipeline.png({ compressionLevel: 9 });
  else pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });

  return pipeline.toBuffer();
}
