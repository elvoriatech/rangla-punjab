import { cache } from "react";
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
import { filterMenuByDiet, parseDietFilter, resolveCategoryParam } from "@/lib/dietary-filter";
import { MenuView } from "./menu-view";
import { menuCopy } from "@/lib/i18n/menu";

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

/**
 * Per-request menu loader shared by generateViewport, generateMetadata,
 * and the page body. Next runs all three for every request; uncached,
 * each opened its own tenant transaction and under load the trio
 * exhausted Prisma's transaction slots ("Unable to start a transaction
 * in the given time"). React cache() keyed on primitive args collapses
 * them to ONE transaction per request.
 */
const getMenuForRequest = cache(async (slug: string, preview: string | null) => {
  const context = await resolvePreviewContext(slug, preview);
  if (!context) return null;
  const menu = await loadPublicMenu(context);
  if (!menu) return null;
  return { context, menu };
});

/** Tint the browser chrome (Android Chrome toolbar, iOS Safari accents)
 *  to the venue's menu background — a plain QR scan then melts into the
 *  theme instead of sitting under a default-grey bar. The manifest
 *  carries the same colour for installed PWAs; this covers the far more
 *  common not-installed open. */
export async function generateViewport(): Promise<Viewport> {
  const slug = await getRestaurantSlug();
  const loaded = await getMenuForRequest(slug, null);
  if (!loaded) return {};
  return { themeColor: resolveMenuTheme(loaded.menu.venue.branding.theme).vars.bg };
}

export async function generateMetadata(): Promise<Metadata> {
  const slug = await getRestaurantSlug();
  const loaded = await getMenuForRequest(slug, null);
  if (!loaded) return {};
  const { menu } = loaded;
  const url = `${siteUrl()}/`;
  // Title + description in the venue's own language: this is the snippet
  // a search engine shows, and an English one under a Spanish menu reads
  // like someone else's restaurant.
  const t = menuCopy(menu.locale);
  const title = t.metadata.title(menu.venue.name);
  const description = t.metadata.description(menu.venue.name);
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

  const loaded = await getMenuForRequest(slug, preview ?? null);
  if (!loaded) notFound();
  const { context, menu } = loaded;
  const access = await getPublicVenueAccess(context.tenantId, context.venueId);
  // Lapsed tenants past their grace period: the menu stops resolving.
  if (!access.menuVisible) notFound();
  // P2-4: operator kill switch — menu stays visible, ordering closes.
  const { siteActive } = await getOperatorSettings();

  const diets = parseDietFilter(diet);
  const activeCategoryId = resolveCategoryParam(menu, cat);
  // Category filtering moved to the client (category-tabs.tsx): the page
  // always carries every category and the active one is expressed by the
  // `hidden` attribute on the others, so tapping a tab is instant. The
  // diet filter stays server-side (it changes which dishes exist).
  const filtered = filterMenuByDiet(menu, diets);
  // Keep the *unfiltered* category list around so the tabs render every
  // category even when the guest has narrowed the view to one.
  return (
    <MenuView
      menu={filtered}
      orderingModes={access.modes}
      onlinePayment={access.onlinePayment}
      paypalPayment={access.paypalPayment}
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
      allCategories={menu.categories.map((c) => ({ id: c.id, name: c.name }))}
      activeDiets={diets}
      activeCategoryId={activeCategoryId}
    />
  );
}
