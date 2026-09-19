import { cache } from "react";
import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { venueIcons } from "@/lib/menu-images";
import { notFound } from "next/navigation";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getPublicVenueAccess } from "@/lib/order-service";
import { getOperatorSettings } from "@/lib/operator-settings";
import { currentOpenState, currentTodaySlotTimes } from "@/lib/opening-hours";
import { loadPublicMenu, resolvePublicCategoryParam, siteUrl } from "@/lib/public-menu";
import { filterMenuByDiet, parseDietFilter } from "@/lib/dietary-filter";
import { getRestaurantSlug } from "@/lib/restaurant";
import { MenuView } from "../menu-view";
import { menuCopy } from "@/lib/i18n/menu";

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

/** Per-request cached loader — metadata + page share ONE tenant
 *  transaction (see the same pattern on the default-locale page). */
const getMenuForRequest = cache(async (slug: string, preview: string | null, locale: string) => {
  const context = await resolvePreviewContext(slug, preview);
  if (!context) return null;
  const menu = await loadPublicMenu(context, locale);
  if (!menu) return null;
  return { context, menu };
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  const slug = await getRestaurantSlug();
  const loaded = await getMenuForRequest(slug, null, locale);
  if (!loaded) return {};
  const { menu } = loaded;

  const base = siteUrl();
  const languages: Record<string, string> = {};
  for (const l of menu.venue.enabledLocales) {
    languages[l] = `${base}/${l}`;
  }
  languages["x-default"] = `${base}/${menu.venue.defaultLocale}`;

  const url = `${base}/${locale}`;
  // Snippet copy follows the URL's locale, same as the page body.
  const t = menuCopy(locale);
  const title = t.metadata.title(menu.venue.name);
  const description = t.metadata.description(menu.venue.name);
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
  searchParams: Promise<{ preview?: string; diet?: string | string[]; cat?: string | string[] }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const slug = await getRestaurantSlug();
  const { preview, diet, cat } = await searchParams;

  const loaded = await getMenuForRequest(slug, preview ?? null, locale);
  if (!loaded) notFound();
  const { context, menu } = loaded;

  // Guardrail: if the venue has not enabled this locale, refuse the URL
  // rather than silently rendering the default translation.
  if (!menu.venue.enabledLocales.includes(locale)) notFound();

  const access = await getPublicVenueAccess(context.tenantId, context.venueId);
  // Lapsed tenants past their grace period: the menu stops resolving.
  if (!access.menuVisible) notFound();
  const { siteActive } = await getOperatorSettings();
  const diets = parseDietFilter(diet);
  // Same server-side `?cat=` handling as the default-locale page, so a
  // deep link (`/de?cat=offers`) filters without JavaScript here too.
  const activeCategoryId = resolvePublicCategoryParam(menu, cat);
  const filtered = filterMenuByDiet(menu, diets);
  return (
    <MenuView
      menu={filtered}
      activeDiets={diets}
      activeCategoryId={activeCategoryId}
      allCategories={menu.categories.map((c) => ({ id: c.id, name: c.name }))}
      orderingModes={access.modes}
      onlinePayment={access.onlinePayment}
      loyalty={access.loyalty}
      orderingPaused={!siteActive}
      openNow={currentOpenState(menu.venue.hours, menu.venue.timezone)}
      requestSlots={currentTodaySlotTimes(menu.venue.hours, menu.venue.timezone)}
      reserve={
        access.modes.reservations
          ? {
              slug: menu.venue.slug,
              hours: menu.venue.hours,
              timezone: menu.venue.timezone,
            }
          : undefined
      }
    />
  );
}
