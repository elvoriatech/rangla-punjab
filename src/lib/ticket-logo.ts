import sharp from "sharp";
import { readUpload } from "./image-storage";

/**
 * The venue logo, ready for a printed ticket: small, black-and-white
 * (a receipt printer has no colour; a grey-scale image dithers cleanly)
 * and inlined as a data URI, because the app prints the ticket in a
 * WebView with no network — an `<img src="https://…">` would print blank.
 *
 * Memoised per storage key: a new logo is uploaded under a new key, so a
 * cached entry can never show an old logo. Null when the venue has no
 * logo or it cannot be read — the ticket then prints without one.
 */
const cache = new Map<string, string | null>();

export const TICKET_LOGO_PX = 160;

export async function ticketLogoDataUri(
  logoKey: string | null | undefined,
): Promise<string | null> {
  if (!logoKey) return null;
  const hit = cache.get(logoKey);
  if (hit !== undefined) return hit;
  let uri: string | null = null;
  try {
    const raw = await readUpload(logoKey);
    if (raw) {
      const png = await sharp(raw)
        .resize(TICKET_LOGO_PX, TICKET_LOGO_PX, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .grayscale()
        .normalise()
        .png({ palette: true, colours: 16 })
        .toBuffer();
      uri = `data:image/png;base64,${png.toString("base64")}`;
    }
  } catch {
    uri = null;
  }
  cache.set(logoKey, uri);
  return uri;
}

/** A 1-bit image for an ESC/POS printer (`GS v 0`): rows of packed bits,
 *  most significant bit first, 1 = black. */
export interface RasterImage {
  bytesPerRow: number;
  height: number;
  data: Uint8Array;
}

const rasterCache = new Map<string, RasterImage | null>();

/**
 * The venue logo for the Bluetooth receipt printer — the same picture as
 * the HTML ticket's, as black dots `widthDots` wide (owner, 2026-10-11:
 * "add the logo to the kitchen ticket too"). Null when there is no logo.
 */
export async function ticketLogoRaster(
  logoKey: string | null | undefined,
  widthDots = 192,
): Promise<RasterImage | null> {
  if (!logoKey) return null;
  const key = `${logoKey}@${widthDots}`;
  const hit = rasterCache.get(key);
  if (hit !== undefined) return hit;
  let out: RasterImage | null = null;
  try {
    const raw = await readUpload(logoKey);
    if (raw) {
      const { data, info } = await sharp(raw)
        .resize(widthDots, widthDots, { fit: "inside", withoutEnlargement: false })
        .flatten({ background: "#ffffff" })
        .grayscale()
        .normalise()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const bytesPerRow = Math.ceil(info.width / 8);
      const bits = new Uint8Array(bytesPerRow * info.height);
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[y * info.width + x]! < 128) {
            bits[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
          }
        }
      }
      out = { bytesPerRow, height: info.height, data: bits };
    }
  } catch {
    out = null;
  }
  rasterCache.set(key, out);
  return out;
}
