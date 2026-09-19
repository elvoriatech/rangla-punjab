import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { isLocaleCode } from "@/lib/locales";
import { publicMenuDefaultLocale } from "@/lib/public-menu-lang";
import { getRestaurantSlug } from "@/lib/restaurant";
import { AppReturnView } from "./app-return-view";

/**
 * Browser hand-over. The app opened a web page — the provider login, or
 * PayPal's approve page — and the leg that ends the round trip lands
 * here with the app's own deep link in `?to=`. This page's only job is
 * to give the browser back to the app (meta refresh → `location.replace`
 * → a button the guest can press).
 *
 * `?status=success|failed` is set by the PayPal return leg only, and
 * turns the heading into the payment's outcome instead of the sign-in
 * line — the guest never signed in on that trip.
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
  searchParams: Promise<{ to?: string; locale?: string; status?: string }>;
}): Promise<React.ReactElement> {
  const { to, locale: localeParam, status } = await searchParams;
  const locale = isLocaleCode(localeParam) ? localeParam : await venueLocale();
  // The brand name, not a venue read: this page renders in the two
  // seconds before the app takes over, and the venue row is behind RLS
  // here (a public read of it needs the SECURITY DEFINER seam below).
  return (
    <AppReturnView
      to={to}
      locale={locale ?? "en"}
      venueName={BRAND.name}
      status={status === "success" || status === "failed" ? status : null}
    />
  );
}

/** Best effort — an unseeded or unreachable venue just means English. */
async function venueLocale(): Promise<string | null> {
  try {
    return await publicMenuDefaultLocale(await getRestaurantSlug());
  } catch {
    return null;
  }
}
