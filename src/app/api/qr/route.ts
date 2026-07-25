import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getVenueForUser } from "@/lib/venue-service";
import { renderQrPng, renderQrSvg } from "@/lib/qr";
import { siteUrl } from "@/lib/public-menu";

/**
 * QR image for the caller's own venue. Authenticated (session cookie) so
 * the endpoint can't be used as a free QR generator; the encoded URL is
 * always the venue's public menu — no user-controlled data ends up in the
 * code.
 *
 * Query params:
 *   format=png|svg   (default png)
 *   download=1       adds Content-Disposition: attachment
 *
 * Colors stay black-on-white: maximum module contrast is what makes a
 * laminated, wine-splashed table tent still scan in candlelight.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) return NextResponse.json({ error: "no_venue" }, { status: 404 });
  const venue = venueResult.value;

  const params = new URL(request.url).searchParams;
  const format = params.get("format") === "svg" ? "svg" : "png";
  const download = params.get("download") === "1";
  const publicUrl = `${siteUrl()}/`;

  const headers = new Headers({ "Cache-Control": "private, max-age=300" });
  const filename = `guesto-qr-${venue.slug}.${format}`;
  if (download) headers.set("Content-Disposition", `attachment; filename="${filename}"`);

  if (format === "svg") {
    const svg = await renderQrSvg(publicUrl);
    headers.set("Content-Type", "image/svg+xml");
    return new NextResponse(svg, { headers });
  }

  const png = await renderQrPng(publicUrl);
  headers.set("Content-Type", "image/png");
  return new NextResponse(new Uint8Array(png), { headers });
}
