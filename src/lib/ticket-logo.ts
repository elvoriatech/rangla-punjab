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
