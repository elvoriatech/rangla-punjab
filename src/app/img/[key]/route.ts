import { NextResponse } from "next/server";
import { readUpload } from "@/lib/image-storage";
import { imgRequestSchema, resizeImage } from "@/lib/image-resize";
import { getOrCreateVariant } from "@/lib/image-cache";

/**
 * `/img/[key]?w=<width>&fmt=<format>` — resized public URL for a stored
 * image. Serves the variant from the on-disk cache, rendering it with
 * sharp on the first request only, and streams it with a long-TTL
 * Cache-Control so any HTTP cache absorbs repeat hits too.
 *
 * `w` must be one of `ALLOWED_WIDTHS` (the sizes the app actually
 * renders); anything else is a 400 rather than an unbounded encode.
 *
 * The key is URL-encoded on the way in — `{tenantId}/uploads/{uuid}`
 * contains `/`, which Next unwraps into this single dynamic segment.
 *
 * Cache posture: immutable for a year — a resized image is deterministic
 * in width+format, so a stale response is always safe to serve.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);

  const url = new URL(request.url);
  // Content negotiation: when the caller didn't pin a format, serve AVIF
  // to browsers that advertise it (25-35% smaller than webp) and webp to
  // everyone else. Vary: Accept keeps HTTP caches correct.
  const pinnedFmt = url.searchParams.get("fmt");
  const acceptsAvif = (request.headers.get("accept") ?? "").includes("image/avif");
  const parsed = imgRequestSchema.safeParse({
    w: url.searchParams.get("w") ?? undefined,
    fmt: pinnedFmt ?? (acceptsAvif ? "avif" : undefined),
  });
  if (!parsed.success || !decodedKey) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { w, fmt } = parsed.data;

  let out: Buffer;
  try {
    // Cache hit short-circuits before we touch the original at all — the
    // stored master is 0.2–0.8 MB and a hit has no reason to read it.
    out = await getOrCreateVariant(decodedKey, w, fmt, async () => {
      const original = await readUpload(decodedKey);
      if (!original) throw new MissingOriginal();
      return resizeImage(original, w, fmt);
    });
  } catch (err) {
    // A typed sentinel rather than a captured flag: under de-duplication
    // this rejection is shared with every concurrent waiter, so the
    // reason has to travel with the error itself.
    if (err instanceof MissingOriginal) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // Corrupt/undecodable source — never 500 a menu image.
    return NextResponse.json({ error: "unprocessable" }, { status: 422 });
  }

  return new Response(new Uint8Array(out), {
    status: 200,
    headers: {
      "Content-Type": `image/${fmt}`,
      "Cache-Control": "public, max-age=31536000, immutable",
      Vary: "Accept",
    },
  });
}

/** The stored original is gone (or never existed) → 404, not 422. */
class MissingOriginal extends Error {}
