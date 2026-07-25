import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import { resolveMenuTheme } from "@/lib/menu-themes";
import { venueIcons } from "@/lib/menu-images";
import { notFound } from "next/navigation";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getPublicVenueAccess } from "@/lib/order-service";
import { getOperatorSettings } from "@/lib/operator-settings";
import { currentOpenState, currentTodaySlotTimes } from "@/lib/opening-hours";
import { loadPublicMenu, siteUrl } from "@/lib/public-menu";
import { getRestaurantSlug } from "@/lib/restaurant";
import {
  filterMenuByCategory,
  filterMenuByDiet,
  parseDietFilter,
  resolveCategoryParam,
} from "@/lib/dietary-filter";
import { MenuView } from "./menu-view";

/**
 * Public menu page — the guest-facing hot path. Server component only:
 * zero JS ships, so LCP is the HTML itself and the render is a plain
 * document you can save/print/screenshot. `?preview=<token>` swaps the
 * data source to the current draft (P1-9); anything else reads the
 * latest published version.
 *
 * Cache headers come from `next.config.ts` (P0-8 + P1-9 split): long-TTL
 * on the public URL, `no-store` on preview URLs.
 */

/** Tint the browser chrome (Android Chrome toolbar, iOS Safari accents)
 *  to the venue's menu background — a plain QR scan then melts into the
 *  theme instead of sitting under a default-grey bar. The manifest
 *  carries the same colour for installed PWAs; this covers the far more
 *  common not-installed open. */
export async function generateViewport(): Promise<Viewport> {
  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  const menu = context ? await loadPublicMenu(context) : null;
  if (!menu) return {};
  return { themeColor: resolveMenuTheme(menu.venue.branding.theme).vars.bg };
}

export async function generateMetadata(): Promise<Metadata> {
  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  if (!context) return {};
  const menu = await loadPublicMenu(context);
  if (!menu) return {};
  const url = `${siteUrl()}/`;
  const title = `${menu.venue.name} — Menu`;
  const description = `Menu for ${menu.venue.name}. See dishes, prices, allergen and dietary information.`;
  return {
    title,
    description,
    // The guest's tab shows the RESTAURANT's identity, not Guesto's:
    // venue logo as favicon, Guesto icons only when no logo exists.
    icons: venueIcons(menu.venue.branding.logoKey),
    // Per-venue PWA: installing from the menu gives the guest an icon
    // named after the restaurant that opens /r/{slug} standalone
    // (full screen, no browser chrome).
    manifest: `/menu.webmanifest`,
    appleWebApp: {
      capable: true,
      title: menu.venue.name,
      statusBarStyle: "black-translucent",
    },
    alternates: {
      canonical: url,
      languages: Object.fromEntries(menu.venue.enabledLocales.map((l) => [l, `${siteUrl()}/${l}`])),
    },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      locale: menu.locale,
      siteName: BRAND.name,
    },
  };
}
export default async function PublicMenuPage({
  searchParams,
}: {
  searchParams: Promise<{
    preview?: string;
    diet?: string | string[];
    cat?: string | string[];
  }>;
}): Promise<React.ReactElement> {
  const slug = await getRestaurantSlug();
  const { preview, diet, cat } = await searchParams;

  const context = await resolvePreviewContext(slug, preview ?? null);
  if (!context) notFound();

  const menu = await loadPublicMenu(context);
  if (!menu) notFound();
  const access = await getPublicVenueAccess(context.tenantId, context.venueId);
  // Lapsed tenants past their grace period: the menu stops resolving.
  if (!access.menuVisible) notFound();
  // P2-4: operator kill switch — menu stays visible, ordering closes.
  const { siteActive } = await getOperatorSettings();

  const diets = parseDietFilter(diet);
  const activeCategoryId = resolveCategoryParam(menu, cat);
  // Apply diet then category so an "empty" state after category-filtering
  // still respects the diet the guest picked.
  const dietFiltered = filterMenuByDiet(menu, diets);
  const filtered = filterMenuByCategory(dietFiltered, activeCategoryId);
  // Keep the *unfiltered* category list around so the tabs render every
  // category even when the guest has narrowed the view to one.
  return (
    <MenuView
      menu={filtered}
      orderingModes={access.modes}
      onlinePayment={access.onlinePayment}
      orderingPaused={!siteActive}
      openNow={currentOpenState(menu.venue.hours, menu.venue.timezone)}
      requestSlots={currentTodaySlotTimes(menu.venue.hours, menu.venue.timezone)}
      allCategories={menu.categories.map((c) => ({ id: c.id, name: c.name }))}
      activeDiets={diets}
      activeCategoryId={activeCategoryId}
    />
  );
}
