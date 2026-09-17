import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

/**
 * Read-through disk cache for resized image variants, plus in-flight
 * request de-duplication.
 *
 * WHY: `/img/[key]?w=…` used to re-encode the stored original with sharp
 * on EVERY cold request. `Cache-Control: immutable` only helps a browser
 * that already holds the bytes, and this deploy has no image CDN in
 * front (single restaurant, one small VPS) — so every new guest paid a
 * fresh AVIF/WebP encode of every visible dish. AVIF q50 runs 300–800 ms
 * per photo on a 1-vCPU box, inside the same Node process that serves
 * the menu HTML, so one first-time visitor scanning a 40-dish menu could
 * stall the whole app. Encode once, reuse forever.
 *
 * Variants are safe to cache indefinitely: a storage key is immutable
 * (`{tenantId}/uploads/{uuid}` — every write mints a fresh UUID and the
 * old key is deleted, nothing is ever written over an existing key), and
 * a variant is fully determined by key + width + format. There is no
 * invalidation to get wrong; a replaced photo simply has a new key.
 *
 * On-disk layout mirrors the storage key so deleting an image — or a
 * whole tenant prefix — drops its variants with one recursive remove:
 *
 *   <root>/{tenantId}/uploads/{uuid}/{width}.{fmt}
 *
 * The cache is pure derived data, so it deliberately lives OUTSIDE
 * `public/uploads`: that volume holds the only copy of customer photos
 * and gets backed up, and regenerable bytes have no business in a
 * backup. Losing this directory costs one re-encode per variant, never
 * correctness — so prod mounts it as its own throwaway volume.
 */

/** Default root; override with `IMAGE_CACHE_DIR` (prod mounts a volume). */
export const DEFAULT_CACHE_DIRNAME = ".image-cache";

/**
 * Resolved lazily rather than memoized at import: tests point the cache
 * at a temp dir per case, and the cost is a string join next to file I/O.
 */
export function cacheRoot(): string {
  const configured = process.env.IMAGE_CACHE_DIR;
  return configured ? path.resolve(configured) : path.join(process.cwd(), DEFAULT_CACHE_DIRNAME);
}

/**
 * Fence every path inside the cache root. Storage keys reach us from a
 * URL segment, so the same `../..` guard that protects the upload root
 * protects the cache — a crafted key can never write outside it.
 */
function resolveSafe(relative: string): string {
  const root = cacheRoot();
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("image-cache: path escapes cache root");
  }
  return full;
}

/** Absolute path of one cached variant. */
export function variantPath(key: string, width: number, fmt: string): string {
  return resolveSafe(path.join(key, `${width}.${fmt}`));
}

/** Cached bytes, or null when this variant has not been rendered yet. */
export async function readVariant(key: string, width: number, fmt: string): Promise<Buffer | null> {
  try {
    return await readFile(variantPath(key, width, fmt));
  } catch {
    // Missing (the common case), unreadable, or an escaping key — all
    // collapse to "not cached", and the caller re-encodes.
    return null;
  }
}

/**
 * Write one variant atomically: a temp file in the same directory, then
 * a rename. A concurrent reader therefore sees either nothing or the
 * complete image, never a half-written JPEG.
 *
 * Returns false instead of throwing when the cache is unwritable (full
 * disk, read-only mount, missing volume). A cache that cannot be filled
 * must degrade to "re-encode every time", never to a failed request.
 */
export async function writeVariant(
  key: string,
  width: number,
  fmt: string,
  bytes: Buffer,
): Promise<boolean> {
  try {
    const full = variantPath(key, width, fmt);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, bytes);
    try {
      await rename(tmp, full);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop every cached variant of one key, or of a whole key prefix
 * (`{tenantId}` purges that tenant). Called from the storage layer on
 * delete so the cache cannot outlive the original it was derived from.
 */
export async function deleteVariants(keyOrPrefix: string): Promise<void> {
  try {
    await rm(resolveSafe(keyOrPrefix), { recursive: true, force: true });
  } catch {
    /* nothing cached, or an escaping key — nothing to do either way */
  }
}

/**
 * In-flight encodes, keyed by key+width+format.
 *
 * WHY: ten guests scanning the QR code at the same moment used to kick
 * off ten byte-identical sharp encodes of the same photo, each burning a
 * core. They now await one shared promise. Module-level (per process) is
 * exactly the right scope — this deploy runs a single app container, and
 * two processes would each keep their own map and still write the same
 * bytes to the same path atomically.
 */
const inFlight = new Map<string, Promise<Buffer>>();

/** Number of encodes currently running — for tests and diagnostics. */
export function inFlightCount(): number {
  return inFlight.size;
}

/**
 * Return `key` at `width`/`fmt` from disk, or run `produce()` once and
 * cache the result. Concurrent callers for the same variant share a
 * single `produce()` call.
 *
 * A failing `produce()` rejects every waiting caller and leaves nothing
 * cached, so the next request retries cleanly.
 */
export async function getOrCreateVariant(
  key: string,
  width: number,
  fmt: string,
  produce: () => Promise<Buffer>,
): Promise<Buffer> {
  const cached = await readVariant(key, width, fmt);
  if (cached) return cached;

  const dedupeKey = `${key}|${width}|${fmt}`;
  const pending = inFlight.get(dedupeKey);
  if (pending) return pending;

  const work = (async () => {
    // Re-check under the lock: another caller may have landed the file
    // between our miss above and this point.
    const raced = await readVariant(key, width, fmt);
    if (raced) return raced;

    const bytes = await produce();
    // Best-effort — an unwritable cache still serves this response.
    await writeVariant(key, width, fmt, bytes);
    return bytes;
  })();

  const tracked = work.finally(() => {
    inFlight.delete(dedupeKey);
  });
  // Swallow nothing: callers see the rejection, but an unawaited
  // `tracked` must not surface as an unhandled rejection on its own.
  tracked.catch(() => {});
  inFlight.set(dedupeKey, tracked);
  return tracked;
}
