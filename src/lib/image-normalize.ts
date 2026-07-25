import sharp from "sharp";

/**
 * Upload-time image normalization. Every accepted upload is decoded and
 * re-encoded once before it touches object storage, so what we store is:
 *
 *  - byte-verified: the format sharp *detects* is authoritative — a
 *    renamed .exe or a spoofed Content-Type never survives decoding;
 *  - bounded: longest edge capped at 2048px (3× the largest size any
 *    menu layout renders, headroom for retina/hero uses), pixel-bomb
 *    inputs rejected before decode;
 *  - stripped: EXIF/GPS and all other metadata are dropped (an owner's
 *    phone photo carries their location — GDPR hygiene), with the EXIF
 *    orientation baked into the pixels first so nothing rotates;
 *  - same-format: JPEG stays JPEG, PNG stays PNG (palette-quantized),
 *    WebP stays WebP. Guests only ever see the /img route's sharp-resized
 *    copies; this bounds what disk stores (~0.2–0.8 MB per photo).
 */

export const NORMALIZED_FORMATS = ["jpeg", "png", "webp"] as const;
export type NormalizedFormat = (typeof NORMALIZED_FORMATS)[number];

export const MAX_IMAGE_EDGE_PX = 2048;

// Decode guard: a 60-megapixel ceiling rejects decompression bombs
// before sharp allocates pixel buffers (a phone photo is ~12 MP).
const MAX_INPUT_PIXELS = 60_000_000;

export type NormalizedImage = {
  ok: true;
  bytes: Buffer;
  contentType: `image/${NormalizedFormat}`;
  format: NormalizedFormat;
  width: number;
  height: number;
};

export type NormalizeResult = NormalizedImage | { ok: false; error: "invalid_image" };

export async function normalizeImage(input: Buffer): Promise<NormalizeResult> {
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    const format = meta.format;
    if (!format || !(NORMALIZED_FORMATS as readonly string[]).includes(format)) {
      return { ok: false, error: "invalid_image" };
    }

    let pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      // Bake EXIF orientation into the pixels — metadata is stripped on
      // re-encode (sharp's default), so without this, portrait photos
      // would come out sideways.
      .rotate()
      .resize({
        width: MAX_IMAGE_EDGE_PX,
        height: MAX_IMAGE_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      });
    if (format === "jpeg") {
      pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
    } else if (format === "webp") {
      pipeline = pipeline.webp({ quality: 80 });
    } else {
      // Palette quantization: 24-bit photographic PNGs drop ~65% with no
      // visible loss; logos/graphics (the typical PNG upload) even more.
      pipeline = pipeline.png({ palette: true, quality: 80, compressionLevel: 9 });
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      bytes: data,
      contentType: `image/${format as NormalizedFormat}`,
      format: format as NormalizedFormat,
      width: info.width,
      height: info.height,
    };
  } catch {
    // Truncated file, pixel bomb, or a container sharp can't parse —
    // all collapse to one caller-facing rejection.
    return { ok: false, error: "invalid_image" };
  }
}
