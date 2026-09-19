import { isLocaleCode, uiLocale, type UiLocale } from "@/lib/locales";
import { publicMenuDefaultLocale } from "@/lib/public-menu-lang";
import { getRestaurantSlug } from "@/lib/restaurant";

/**
 * Language rule for the account-area pages that are reached from a LINK
 * (the reset mail, the app): `?locale=` when the link carries a valid
 * one — the app and our own emails append it — and the venue's own
 * language otherwise. Same rule as the tracker and the payment page
 * (plan decision 5), kept here so the forgot/reset pair states it once.
 */
export async function accountLocale(param?: string | null): Promise<UiLocale> {
  if (isLocaleCode(param)) return uiLocale(param);
  try {
    return uiLocale(await publicMenuDefaultLocale(await getRestaurantSlug()));
  } catch {
    return uiLocale(null);
  }
}
