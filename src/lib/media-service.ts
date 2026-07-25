import { randomUUID } from "node:crypto";
import { asUser } from "./tenant";
import { normalizeImage } from "./image-normalize";
import { writeUpload } from "./image-storage";

/**
 * Server-side image ingestion for dashboard forms. The menu editor's
 * forms are plain multipart posts, so the server action hands the File
 * here — we validate, normalize, write it to local disk under the
 * tenant prefix (`public/uploads/{tenant}/uploads/{uuid}`), and create
 * the Media row in one go. The `/img/[key]` route resizes on read.
 *
 * The declared MIME type is only a cheap first gate (fast rejection with
 * a friendly error). What actually gets stored is decided by
 * `normalizeImage`, which detects the real format from the bytes and
 * re-encodes: EXIF/GPS stripped, longest edge ≤ 2048px, same container.
 * A spoofed Content-Type or renamed non-image never reaches storage.
 */

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// 10 MB intake: modern phone JPEGs run 3–8 MB. What we *store* is far
// smaller — uploads are normalized (≤2048px, metadata-stripped) first.
export const MAX_BYTES = 10 * 1024 * 1024;

export type MediaResult =
  | { ok: true; mediaId: string; storageKey: string }
  | { ok: false; error: "invalid_type" | "too_large" | "empty" | "invalid_image" };

export async function saveUploadedImage(
  userId: string,
  file: File,
  altText: string,
): Promise<MediaResult> {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "invalid_type" };
  }
  if (file.size === 0) return { ok: false, error: "empty" };
  if (file.size > MAX_BYTES) return { ok: false, error: "too_large" };

  const normalized = await normalizeImage(Buffer.from(await file.arrayBuffer()));
  if (!normalized.ok) return normalized;

  return asUser(userId, async (tx) => {
    const tenant = await tx.tenant.findFirstOrThrow({ select: { id: true } });
    const storageKey = `${tenant.id}/uploads/${randomUUID()}`;

    await writeUpload(storageKey, normalized.bytes);

    const media = await tx.media.create({
      data: {
        tenantId: tenant.id,
        storageKey,
        width: normalized.width,
        height: normalized.height,
        bytes: normalized.bytes.length,
        altText: altText.slice(0, 300) || null,
      },
      select: { id: true },
    });
    return { ok: true as const, mediaId: media.id, storageKey };
  });
}

/**
 * Header-only dimension sniffing. Returns 0×0 when the container isn't
 * recognized — callers treat dimensions as advisory, not authoritative.
 */
export function parseImageDimensions(
  buf: Buffer,
  contentType: string,
): { width: number; height: number } {
  try {
    if (contentType === "image/png") return parsePng(buf);
    if (contentType === "image/jpeg") return parseJpeg(buf);
    if (contentType === "image/webp") return parseWebp(buf);
  } catch {
    // Malformed header — fall through to unknown.
  }
  return { width: 0, height: 0 };
}

function parsePng(buf: Buffer): { width: number; height: number } {
  // 8-byte signature, then IHDR: length(4) + "IHDR"(4) + width(4) + height(4).
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function parseJpeg(buf: Buffer): { width: number; height: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { width: 0, height: 0 };
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1]!;
    // SOF0–SOF15 except DHT(C4)/JPGA(C8)/DAC(CC) carry dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const length = buf.readUInt16BE(offset + 2);
    offset += 2 + length;
  }
  return { width: 0, height: 0 };
}

function parseWebp(buf: Buffer): { width: number; height: number } {
  // RIFF????WEBP then a chunk: VP8X (extended), VP8L (lossless), VP8 (lossy).
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF") return { width: 0, height: 0 };
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    // 24-bit little-endian minus-one fields at offsets 24 and 27.
    const width = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
    const height = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
    return { width, height };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return { width: 0, height: 0 };
}
