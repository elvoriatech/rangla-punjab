import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { resolvePreviewContext } from "@/lib/preview-context";
import { loadPublicMenu } from "@/lib/public-menu";
import { getPublicVenueAccess } from "@/lib/order-service";
import { getRestaurantSlug } from "@/lib/restaurant";
import { menuImageUrl } from "@/lib/menu-images";
import { categoryIcon } from "@/lib/category-icons";
import { siteUrl } from "@/lib/site-url";
import { currentTodaySlotTimes, reservableDates, slotTimesForDate } from "@/lib/opening-hours";
import { isLocaleCode } from "@/lib/locales";
import { publicLoyalty } from "@/lib/loyalty-config";
import { mapsSearchUrl } from "@/lib/google-rating";
import type { PublicMenu } from "@/lib/public-menu";

/**
 * The rating as the APP wants it, which is not quite the shape the web
 * page gets.
 *
 * The web menu renders the number with no link when the venue has no
 * Place ID (the owner typed the rating by hand and never ran the Place ID
 * search). The app cannot: its `asRating()` discards any rating whose
 * `reviewUrl` is not an http(s) URL, so a null there would hide a number
 * the owner deliberately entered. Rather than ship an app update to every
 * installed copy, the server keeps its side of that contract and sends a
 * Google Maps search for the venue name — a real URL that opens the right
 * place page — whenever there is no Place ID to build a review link from.
 */
function appRating(
  rating: PublicMenu["rating"],
  venueName: string,
): { value: number; count: number; reviewUrl: string } | null {
  if (!rating) return null;
  return { ...rating, reviewUrl: rating.reviewUrl ?? mapsSearchUrl(venueName) };
}

/**
 * GET /api/v1/menu[?locale=de]
 *
 * The mobile app's menu read — the published menu of THE restaurant
 * (single-tenant deploy, no slug in the URL). Delegates to the same
 * loader the web page uses, so the two surfaces can never disagree.
 *
 * `?locale` is validated against the venue's `enabledLocales` (plan
 * decision 6). An unknown or disabled code is NOT a 404 — a stale app
 * preference must never cost the guest the menu — it silently falls back
 * to the venue default, and `venue.locale` in the response says which
 * language actually came back.
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

  // A code the registry doesn't know can't be enabled either, so it never
  // reaches the loader; a known-but-disabled one is caught below.
  const requested = req.nextUrl.searchParams.get("locale");
  const candidate = isLocaleCode(requested) ? requested : undefined;
  const [firstPass, access] = await Promise.all([
    loadPublicMenu(context, candidate),
    getPublicVenueAccess(context.tenantId, context.venueId),
  ]);
  if (!firstPass) {
    return withCors(NextResponse.json({ ok: false, error: "not_published" }, { status: 404 }));
  }
  // Disabled-but-valid (an app holding a locale the owner has since turned
  // off): reload in the venue's language so the payload and the echoed
  // locale agree. Cold path — the common case is already correct.
  const enabled = candidate ? firstPass.venue.enabledLocales.includes(candidate) : true;
  const menu = enabled ? firstPass : ((await loadPublicMenu(context)) ?? firstPass);

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
          paypal: access.paypalPayment,
          // Later-today "HH:MM" pickup/delivery slots inside opening hours
          // (same generator as the web drawer). Empty = ASAP only.
          requestSlots: currentTodaySlotTimes(menu.venue.hours, menu.venue.timezone),
          // Table reservations. The SERVER enumerates the bookable
          // date→times grid so the app offers exactly what the reservation
          // endpoint accepts — no opening-hours maths duplicated in RN.
          reservations: access.modes.reservations,
          reservationSlots: access.modes.reservations
            ? reservableDates(menu.venue.hours, menu.venue.timezone, new Date()).map((d) => ({
                date: d.date,
                times: slotTimesForDate(menu.venue.hours, menu.venue.timezone, d.date, new Date()),
              }))
            : [],
        },
        // Loyalty (round one): the numbers the app needs to say "Sign in
        // to earn 5 points" on the cart. Always present, `enabled: false`
        // when the owner has not switched it on — the app shows nothing.
        loyalty: publicLoyalty(access.loyalty),
        // P7-12: how many dishes carry an ACTIVE offer right now. The app
        // hides its offers card, chip and tab badge entirely at 0, so it
        // never has to walk the tree to find that out.
        offerCount: menu.offerCount,
        // P7-14: the venue's Google rating and the link to Google's own
        // review form. Explicitly null — never absent — when the venue has
        // no rating at all (neither fetched nor owner-typed), so the app
        // has one thing to test and hides the line on it.
        rating: appRating(menu.rating, menu.venue.name),
        categories: menu.categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          photoUrl: cat.photoKey ? abs(menuImageUrl(cat.photoKey, cat.id, 160)) : null,
          // The website's Appearance → "icons + names" emoji, inferred from
          // the category name — sent so the app's rail matches the web when
          // no photo is uploaded. Null when the venue shows names only.
          icon: branding.categoryIcons === "icons" ? categoryIcon(cat.name) : null,
          items: cat.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            offer: item.offer ?? null,
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
