import { NextResponse } from "next/server";
import { APP_DOWNLOAD_PAGE, appStoreTarget, detectPlatform } from "@/lib/app-download";
import { getRestaurantAppLinks } from "@/lib/restaurant";
import { siteUrl } from "@/lib/site-url";

/**
 * `/app` — what the printed "get the app" QR code opens (see
 * `lib/app-download.ts`).
 *
 * A phone whose store link is saved goes straight to the store; everyone
 * else gets `/app/download`. Always a 302 with `no-store`: the destination
 * changes the day a store link is pasted into Settings, and a phone that
 * cached a permanent redirect to the "coming soon" page would never see it.
 * The page URL is built from `siteUrl()`, not `request.url`: behind the
 * reverse proxy the request URL is the container's own address.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const platform = detectPlatform(request.headers.get("user-agent"));
  const target = appStoreTarget(platform, await getRestaurantAppLinks());
  const response = NextResponse.redirect(target ?? `${siteUrl()}${APP_DOWNLOAD_PAGE}`, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
