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

// A 4K-portrait photo is 2160 wide; beyond this it's a bug or a probe.
export const MAX_WIDTH = 4096;

// Same decode guard as image-normalize: reject decompression bombs.
const MAX_INPUT_PIXELS = 60_000_000;

export const imgRequestSchema = z.object({
  w: z.coerce.number().int().min(1).max(MAX_WIDTH),
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
