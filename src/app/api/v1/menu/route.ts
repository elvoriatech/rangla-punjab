import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { resolvePreviewContext } from "@/lib/preview-context";
import { loadPublicMenu } from "@/lib/public-menu";
import { getPublicVenueAccess } from "@/lib/order-service";
import { getRestaurantSlug } from "@/lib/restaurant";
import { menuImageUrl } from "@/lib/menu-images";
import { siteUrl } from "@/lib/site-url";

/**
 * GET /api/v1/menu[?locale=de]
 *
 * The mobile app's menu read — the published menu of THE restaurant
 * (single-tenant deploy, no slug in the URL). Delegates to the same
 * loader the web page uses, so the two surfaces can never disagree.
 *
 * Contract rules (binding on every v1 payload): money is integer cents,
 * image URLs are absolute, timestamps are ISO, and clients MUST tolerate
 * fields and enum values they don't recognize.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  if (!context) {
    return withCors(NextResponse.json({ ok: false, error: "not_published" }, { status: 404 }));
  }

  const locale = req.nextUrl.searchParams.get("locale") ?? undefined;
  const [menu, access] = await Promise.all([
    loadPublicMenu(context, locale ?? undefined),
    getPublicVenueAccess(context.tenantId, context.venueId),
  ]);
  if (!menu) {
    return withCors(NextResponse.json({ ok: false, error: "not_published" }, { status: 404 }));
  }

  const origin = siteUrl();
  const abs = (path: string): string => (path.startsWith("http") ? path : `${origin}${path}`);
  const branding = menu.venue.branding;

  return withCors(
    NextResponse.json(
      {
        ok: true,
        venue: {
          name: menu.venue.name,
          slug: menu.venue.slug,
          currency: menu.venue.currency,
          locale: menu.locale,
          defaultLocale: menu.venue.defaultLocale,
          enabledLocales: menu.venue.enabledLocales,
          logoUrl: branding.logoKey
            ? abs(menuImageUrl(branding.logoKey, menu.venue.id, 192))
            : null,
          theme: branding.theme ?? null,
          hours: menu.venue.hours,
        },
        ordering: {
          dineIn: access.modes.dineIn,
          takeaway: access.modes.takeaway,
          delivery: access.modes.delivery,
          deliveryAreas: access.modes.deliveryAreas,
          deliveryFeeCents: access.modes.deliveryFeeCents,
          deliveryMinCents: access.modes.deliveryMinCents,
          acceptedPayments: access.modes.acceptedPayments,
          onlinePayment: access.onlinePayment,
        },
        categories: menu.categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          photoUrl: cat.photoKey ? abs(menuImageUrl(cat.photoKey, cat.id, 160)) : null,
          items: cat.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            currency: item.currency,
            isAvailable: item.isAvailable,
            allergens: item.allergens,
            traces: item.traces,
            dietary: item.dietary,
            spice: item.spice,
            photoUrl: abs(menuImageUrl(item.photoKey, item.id, 640)),
            variants: item.variants.map((v) => ({
              id: v.id,
              name: v.name,
              priceDeltaCents: v.priceDeltaCents,
            })),
          })),
        })),
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" } },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
