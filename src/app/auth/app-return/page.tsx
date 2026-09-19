import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { isLocaleCode } from "@/lib/locales";
import { publicMenuDefaultLocale } from "@/lib/public-menu-lang";
import { getRestaurantSlug } from "@/lib/restaurant";
import { AppReturnView } from "./app-return-view";

/**
 * Sign-in hand-over. The app opened the provider login in a browser; the
 * customer callback ends here with the app's own deep link in `?to=`, and
 * this page's only job is to give the browser back to the app (meta
 * refresh → `location.replace` → a button the guest can press).
 *
 * The deep link is allow-listed to app schemes inside `AppReturnView`, so
 * a hand-typed `?to=https://…` renders nothing but "you can close this
 * window". Language follows plan decision 5: `?locale=` when a link
 * carries a valid one, else the venue's default.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string; locale?: string }>;
}): Promise<React.ReactElement> {
  const { to, locale: localeParam } = await searchParams;
  const locale = isLocaleCode(localeParam) ? localeParam : await venueLocale();
  // The brand name, not a venue read: this page renders in the two
  // seconds before the app takes over, and the venue row is behind RLS
  // here (a public read of it needs the SECURITY DEFINER seam below).
  return <AppReturnView to={to} locale={locale ?? "en"} venueName={BRAND.name} />;
}

/** Best effort — an unseeded or unreachable venue just means English. */
async function venueLocale(): Promise<string | null> {
  try {
    return await publicMenuDefaultLocale(await getRestaurantSlug());
  } catch {
    return null;
  }
}
