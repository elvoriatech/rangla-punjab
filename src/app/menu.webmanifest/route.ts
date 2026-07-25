import { NextResponse } from "next/server";
import { resolvePreviewContext } from "@/lib/preview-context";
import { loadPublicMenu } from "@/lib/public-menu";
import { buildVenueManifest } from "@/lib/venue-manifest";
import { getRestaurantSlug } from "@/lib/restaurant";

/**
 * `/menu.webmanifest` — the restaurant's web-app manifest, linked from
 * the site metadata. (`/manifest.webmanifest` is reserved by Next's
 * metadata-file convention, so we serve it here as a plain route.) Only
 * fetched by browsers evaluating installability, so a fresh venue lookup
 * per hit is fine; still cached for an hour since name/theme/logo change
 * rarely.
 */
export async function GET(): Promise<Response> {
  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  if (!context) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const menu = await loadPublicMenu(context);
  if (!menu) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const manifest = buildVenueManifest({
    name: menu.venue.name,
    theme: menu.venue.branding.theme,
    logoKey: menu.venue.branding.logoKey,
  });
  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
