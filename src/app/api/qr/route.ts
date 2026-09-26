import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getVenueForUser } from "@/lib/venue-service";
import { renderQrPng, renderQrSvg } from "@/lib/qr";
import { siteUrl } from "@/lib/public-menu";
import { APP_DOWNLOAD_PATH } from "@/lib/app-download";

// Brand logo composited over the QR centre. `H`-level error correction
// leaves 30 % redundancy, so the 20 % overlay never breaks scanning.
let logoDataUrlCache: string | null | undefined;
async function brandLogoDataUrl(): Promise<string | undefined> {
  if (logoDataUrlCache !== undefined) return logoDataUrlCache ?? undefined;
  try {
    const png = await readFile(join(process.cwd(), "public/brand/rangla-logo.png"));
    logoDataUrlCache = `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    logoDataUrlCache = null;
  }
  return logoDataUrlCache ?? undefined;
}

/**
 * QR image for the caller's own venue. Authenticated (session cookie) so
 * the endpoint can't be used as a free QR generator; the encoded URL is
 * always the venue's public menu — no user-controlled data ends up in the
 * code.
 *
 * Query params:
 *   target=menu|app  (default menu) — `app` encodes the permanent
 *                    get-the-app link, which sends each phone to its own
 *                    store (see `lib/app-download.ts`)
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
  const app = params.get("target") === "app";
  const publicUrl = app ? `${siteUrl()}${APP_DOWNLOAD_PATH}` : `${siteUrl()}/`;

  const headers = new Headers({ "Cache-Control": "private, max-age=300" });
  const filename = `${venue.slug}-${app ? "app-qr" : "qr"}.${format}`;
  if (download) headers.set("Content-Disposition", `attachment; filename="${filename}"`);

  const logoDataUrl = await brandLogoDataUrl();

  if (format === "svg") {
    const svg = await renderQrSvg(publicUrl, { logoDataUrl });
    headers.set("Content-Type", "image/svg+xml");
    return new NextResponse(svg, { headers });
  }

  const png = await renderQrPng(publicUrl, { logoDataUrl });
  headers.set("Content-Type", "image/png");
  return new NextResponse(new Uint8Array(png), { headers });
}
