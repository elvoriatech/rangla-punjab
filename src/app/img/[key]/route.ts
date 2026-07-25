import { NextResponse } from "next/server";
import { readUpload } from "@/lib/image-storage";
import { imgRequestSchema, resizeImage } from "@/lib/image-resize";

/**
 * `/img/[key]?w=<width>&fmt=<format>` — resized public URL for a stored
 * image. Reads the original from local disk (`public/uploads/{key}`) and
 * re-encodes it to the requested width+format with sharp, streaming the
 * result with a long-TTL Cache-Control so any HTTP cache absorbs repeat
 * hits without re-encoding.
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

  const original = await readUpload(decodedKey);
  if (!original) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let out: Buffer;
  try {
    out = await resizeImage(original, parsed.data.w, parsed.data.fmt);
  } catch {
    // Corrupt/undecodable source — never 500 a menu image.
    return NextResponse.json({ error: "unprocessable" }, { status: 422 });
  }

  return new Response(new Uint8Array(out), {
    status: 200,
    headers: {
      "Content-Type": `image/${parsed.data.fmt}`,
      "Cache-Control": "public, max-age=31536000, immutable",
      Vary: "Accept",
    },
  });
}
