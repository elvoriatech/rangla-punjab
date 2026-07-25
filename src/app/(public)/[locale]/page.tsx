import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { venueIcons } from "@/lib/menu-images";
import { notFound } from "next/navigation";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getPublicVenueAccess } from "@/lib/order-service";
import { getOperatorSettings } from "@/lib/operator-settings";
import { currentOpenState, currentTodaySlotTimes } from "@/lib/opening-hours";
import { loadPublicMenu, siteUrl } from "@/lib/public-menu";
import { filterMenuByDiet, parseDietFilter } from "@/lib/dietary-filter";
import { getRestaurantSlug } from "@/lib/restaurant";
import { MenuView } from "../menu-view";

/**
 * Locale-scoped public menu page. Mirrors `/r/[slug]` but forces the
 * loader to a specific locale from the URL segment. If the venue's
 * `enabledLocales` list does not include the requested locale we 404 —
 * we don't fall back to the default, because that would give guests a
 * false-positive impression that the URL is legitimate.
 *
 * `<html lang>` is set by the root layout via the middleware-injected
 * pathname (see `src/middleware.ts` + `src/app/layout.tsx`).
 * `generateMetadata` emits hreflang alternates + canonical so SEO tools
 * can crawl every locale of the same menu.
 */

interface Params {
  locale: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  if (!context) return {};

  const menu = await loadPublicMenu(context, locale);
  if (!menu) return {};

  const base = siteUrl();
  const languages: Record<string, string> = {};
  for (const l of menu.venue.enabledLocales) {
    languages[l] = `${base}/${l}`;
  }
  languages["x-default"] = `${base}/${menu.venue.defaultLocale}`;

  const url = `${base}/${locale}`;
  const title = `${menu.venue.name} — Menu`;
  const description = `Menu for ${menu.venue.name}. See dishes, prices, allergen and dietary information.`;
  return {
    title,
    description,
    // Same per-restaurant favicon as the base /r/{slug} route.
    icons: venueIcons(menu.venue.branding.logoKey),
    alternates: {
      canonical: url,
      languages,
    },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      locale,
      siteName: BRAND.name,
    },
  };
}

export default async function LocalisedPublicMenuPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ preview?: string; diet?: string | string[] }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const slug = await getRestaurantSlug();
  const { preview, diet } = await searchParams;

  const context = await resolvePreviewContext(slug, preview ?? null);
  if (!context) notFound();

  const menu = await loadPublicMenu(context, locale);
  if (!menu) notFound();

  // Guardrail: if the venue has not enabled this locale, refuse the URL
  // rather than silently rendering the default translation.
  if (!menu.venue.enabledLocales.includes(locale)) notFound();

  const access = await getPublicVenueAccess(context.tenantId, context.venueId);
  // Lapsed tenants past their grace period: the menu stops resolving.
  if (!access.menuVisible) notFound();
  const { siteActive } = await getOperatorSettings();
  const diets = parseDietFilter(diet);
  const filtered = filterMenuByDiet(menu, diets);
  return (
    <MenuView
      menu={filtered}
      activeDiets={diets}
      orderingModes={access.modes}
      onlinePayment={access.onlinePayment}
      orderingPaused={!siteActive}
      openNow={currentOpenState(menu.venue.hours, menu.venue.timezone)}
      requestSlots={currentTodaySlotTimes(menu.venue.hours, menu.venue.timezone)}
    />
  );
}
