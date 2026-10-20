import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AboutSection, splitVenueName } from "../(public)/about-section";
import { LegalLayout } from "../legal/_components/legal-layout";
import { menuCopy } from "@/lib/i18n/menu";
import { getPublicVenueAccess } from "@/lib/order-service";
import { resolvePreviewContext } from "@/lib/preview-context";
import { loadPublicMenu, siteUrl } from "@/lib/public-menu";
import { getRestaurantSlug } from "@/lib/restaurant";
import { searchCuisine, seoProfile } from "@/lib/seo-profile";

/**
 * `/ueber-uns` — the restaurant's "About us" (owner, 2026-10-20): who, where
 * in Konstanz, how to order. Its own page rather than a block on the menu,
 * linked from the menu footer and the legal list. German, like the menu's
 * home page; every sentence comes from the venue's own settings
 * (`about-section.tsx`). Server-rendered, no script, cached like the menu.
 */

export const revalidate = 300;

async function load() {
  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) return null;
  const menu = await loadPublicMenu(context);
  if (!menu) return null;
  const access = await getPublicVenueAccess(context.tenantId, context.venueId);
  if (!access.menuVisible) return null;
  return { menu, access };
}

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await load();
  if (!loaded) return {};
  const { name, cityFromName } = splitVenueName(loaded.menu.venue.name);
  const where = cityFromName ? ` in ${cityFromName}` : "";
  const t = menuCopy("de");
  const cuisine = searchCuisine("de");
  return {
    title: `Über uns – ${name}${where}`,
    description: t.about.intro(
      name,
      cuisine.phrase,
      cityFromName,
      seoProfile().signatureDishes.join(", "),
    ),
    alternates: { canonical: `${siteUrl()}/ueber-uns` },
  };
}

export default async function AboutPage(): Promise<React.ReactElement> {
  const loaded = await load();
  if (!loaded) notFound();
  const { menu, access } = loaded;
  const t = menuCopy("de");
  const { name, cityFromName } = splitVenueName(menu.venue.name);
  return (
    <LegalLayout
      title={t.about.heading(name, cityFromName)}
      currentPath="/ueber-uns"
      reviewBanner={false}
    >
      <AboutSection
        asPage
        t={t}
        venueName={menu.venue.name}
        postalAddress={menu.venue.postalAddress ?? null}
        cuisine={searchCuisine("de").phrase}
        dishes={seoProfile().signatureDishes}
        takeaway={access.modes.takeaway}
        delivery={access.modes.delivery}
        deliveryAreas={access.modes.deliveryAreas}
        reservations={access.modes.reservations}
      />
      <p>
        <Link href="/" className="font-semibold underline underline-offset-4">
          Zur Speisekarte und online bestellen
        </Link>
      </p>
    </LegalLayout>
  );
}
