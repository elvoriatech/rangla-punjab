"use server";

import { updateVenueBanner, updateVenueHours, updateVenueOrdering } from "@/lib/venue-service";
import type { DayHours, Weekday } from "@/lib/opening-hours";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { saveUploadedImage } from "@/lib/media-service";
import { checkRateLimit, GOOGLE_LOOKUP_IP } from "@/lib/rate-limit";
import { searchPlaces } from "@/lib/google-rating";
import {
  refreshVenueGoogleRating,
  updateVenueGoogleManualRating,
  updateVenueGooglePlaceId,
  updateVenueGoogleRatingEnabled,
  updateVenueHalalFilter,
  updateVenueLocalization,
  updateVenueLogo,
  updateVenueLoyalty,
  updateVenueName,
  venueAdminBase,
} from "@/lib/venue-service";

async function requireUser(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return userId;
}

async function finish(userId: string, ok: boolean, flag: string): Promise<never> {
  if (ok) {
    const { purgeMenuForUser } = await import("@/lib/cdn-purge");
    await purgeMenuForUser(userId);
  }
  const path = `${(await venueAdminBase(userId)) ?? "/dashboard"}/settings`;
  revalidatePath("/dashboard/settings", "page");
  revalidatePath("/dashboard", "page");
  redirect(ok ? `${path}?saved=${flag}` : `${path}?error=${flag}`);
}

export async function saveVenueNameAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueName(userId, { name: String(form.get("name") ?? "") });
  return finish(userId, result.ok, "name");
}

export async function saveLogoAction(form: FormData): Promise<void> {
  const userId = await requireUser();

  const logo = form.get("logo");
  if (!(logo instanceof File) || logo.size === 0) return finish(userId, false, "logo");

  const saved = await saveUploadedImage(userId, logo, "Venue logo");
  if (!saved.ok) return finish(userId, false, "logo");

  const result = await updateVenueLogo(userId, saved.storageKey);
  return finish(userId, result.ok, "logo");
}

export async function removeLogoAction(): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueLogo(userId, null);
  return finish(userId, result.ok, "logo-removed");
}

export async function saveBannerAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const banner = form.get("banner");
  if (!(banner instanceof File) || banner.size === 0) return finish(userId, false, "banner");
  const saved = await saveUploadedImage(userId, banner, "Venue banner");
  if (!saved.ok) return finish(userId, false, "banner");
  const result = await updateVenueBanner(userId, saved.storageKey);
  return finish(userId, result.ok, "banner");
}

export async function removeBannerAction(): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueBanner(userId, null);
  return finish(userId, result.ok, "banner-removed");
}

export async function saveHalalAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueHalalFilter(userId, form.get("halal") === "on");
  return finish(userId, result.ok, "halal");
}

export async function saveOrderingAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  // Euro inputs arrive as decimal strings; store integer cents. NaN or
  // negative values fall to 0 rather than failing the whole save.
  const cents = (v: FormDataEntryValue | null): number => {
    const n = Math.round(parseFloat(String(v ?? "0").replace(",", ".")) * 100);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  // Delivery areas arrive as indexed rows (areaZip_0, areaFee_0, …).
  // A row with an empty ZIP is dropped — clearing the ZIP is how the
  // owner removes an area; the trailing blank row is the "add" slot.
  // Missing/garbage numbers fall to 0, never fail the save.
  const deliveryAreas: Array<{
    zip: string;
    locality: string;
    feeCents: number;
    minCents: number;
    freeOverCents: number;
  }> = [];
  const seenZips = new Set<string>();
  for (let i = 0; form.has(`areaZip_${i}`); i += 1) {
    const zip = String(form.get(`areaZip_${i}`) ?? "").trim();
    if (zip.length < 3 || zip.length > 10 || seenZips.has(zip)) continue;
    seenZips.add(zip);
    deliveryAreas.push({
      zip,
      locality: String(form.get(`areaLocality_${i}`) ?? "")
        .trim()
        .slice(0, 80),
      feeCents: cents(form.get(`areaFee_${i}`)),
      minCents: cents(form.get(`areaMin_${i}`)),
      freeOverCents: cents(form.get(`areaFreeOver_${i}`)),
    });
  }
  const result = await updateVenueOrdering(userId, {
    dineIn: form.get("dineIn") === "on",
    takeaway: form.get("takeaway") === "on",
    delivery: form.get("delivery") === "on",
    reservations: form.get("reservations") === "on",
    deliveryAreas,
    // Legacy flat fields cleared once areas exist; kept as fallback
    // (any ZIP) while the owner hasn't defined areas yet.
    deliveryZips: [],
    deliveryFeeCents: deliveryAreas.length > 0 ? 0 : cents(form.get("deliveryFee")),
    deliveryMinCents: deliveryAreas.length > 0 ? 0 : cents(form.get("deliveryMin")),
    acceptedPayments: form.getAll("acceptedPayments").map(String),
    // Comma/newline-separated textarea; the schema splits, dedupes and
    // drops anything that isn't an address.
    notifyEmails: String(form.get("notifyEmails") ?? ""),
    // Whole hours, at least one, no ceiling — a blank or fat-fingered
    // box falls back to the schema default instead of failing the save.
    issueWindowHours: parseInt(String(form.get("issueWindowHours") ?? ""), 10),
  });
  return finish(userId, result.ok, "ordering");
}

export async function saveLoyaltyAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  // Euro inputs arrive as decimal strings; store integer cents. Same
  // tolerance as the ordering save — a blank or fat-fingered field falls
  // back to the schema default rather than failing the whole section.
  const cents = (v: FormDataEntryValue | null): number =>
    Math.round(parseFloat(String(v ?? "").replace(",", ".")) * 100);
  const whole = (v: FormDataEntryValue | null): number => parseInt(String(v ?? ""), 10);
  const result = await updateVenueLoyalty(userId, {
    enabled: form.get("loyaltyEnabled") === "on",
    minOrderCents: cents(form.get("loyaltyMinOrder")),
    pointsPerOrder: whole(form.get("loyaltyPointsPerOrder")),
    rewardPoints: whole(form.get("loyaltyRewardPoints")),
    rewardValueCents: cents(form.get("loyaltyRewardValue")),
    voucherExpiryMonths: whole(form.get("loyaltyExpiryMonths")),
  });
  return finish(userId, result.ok, "loyalty");
}

/** P7-14 — the venue's Google Place ID. Blank clears it, which turns the
 *  rating line off everywhere; a changed id also drops the cached number
 *  (see `updateVenueGooglePlaceId`). */
export async function saveGoogleAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueGooglePlaceId(userId, String(form.get("googlePlaceId") ?? ""));
  return finish(userId, result.ok, "google");
}

/** P7-14 — "Show the Google rating to guests". An unchecked checkbox
 *  sends nothing at all, which is exactly the `off` we want; the line
 *  disappears from every surface while both stored numbers survive. */
export async function saveGoogleRatingEnabledAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueGoogleRatingEnabled(userId, form.get("ratingEnabled") === "on");
  return finish(userId, result.ok, "google_rating_visibility");
}

/**
 * P7-14 — the rating the owner types in themselves, for a deployment with
 * no Places API key. Both boxes are required together; both empty is the
 * clear, which is why the same service call backs the Clear button below.
 * `finish(ok: true)` purges the CDN, because this number is on every
 * cached copy of the public menu.
 */
export async function saveGoogleManualRatingAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueGoogleManualRating(userId, {
    rating: String(form.get("manualRating") ?? ""),
    count: String(form.get("manualCount") ?? ""),
  });
  return finish(userId, result.ok, "google_manual");
}

/** The same write with both fields empty — a button rather than "delete
 *  the text in two boxes and press Save", because that is what the owner
 *  actually means by "stop showing this". */
export async function clearGoogleManualRatingAction(): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueGoogleManualRating(userId, { rating: "", count: "" });
  return finish(userId, result.ok, "google_manual_cleared");
}

/** Redirect back to Settings with query params that aren't the
 *  saved/error pair — the search results and the query that produced
 *  them. No CDN purge: a search changes nothing a guest can see. */
async function finishGoogleSearch(userId: string, params: URLSearchParams): Promise<never> {
  const path = `${(await venueAdminBase(userId)) ?? "/dashboard"}/settings`;
  redirect(`${path}?${params.toString()}`);
}

/** Owner-session + per-IP ceiling shared by the two lookup actions. Server
 *  actions don't receive the Request; `headers()` carries the same proxy
 *  headers, so the trust boundary stays in `clientIp()`. */
async function googleLookupAllowed(): Promise<boolean> {
  const ip = clientIp(new Request("http://action.local", { headers: await headers() }));
  const rl = await checkRateLimit(GOOGLE_LOOKUP_IP, ip);
  return rl.ok;
}

/**
 * P7-14 — "Find my Place ID": Places Text Search for the owner's own
 * restaurant, so setting the rating up never means leaving the dashboard
 * for Google's developer tooling.
 *
 * Results ride back through the query string rather than any session or
 * cookie state: this page is a plain form round-trip, and a redirect that
 * carries its own answer is the only version of that which works with JS
 * off. They are capped at five short rows for the same reason.
 */
export async function searchGooglePlaceAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const query = String(form.get("googleQuery") ?? "").trim();
  const params = new URLSearchParams({ google_q: query });

  if (!(await googleLookupAllowed())) {
    params.set("error", "google_rate_limited");
    return finishGoogleSearch(userId, params);
  }

  const result = await searchPlaces(query);
  if (!result.ok) {
    params.set("error", `google_${result.error}`);
    return finishGoogleSearch(userId, params);
  }
  params.set("google_search", JSON.stringify(result.places));
  return finishGoogleSearch(userId, params);
}

/**
 * P7-14 — "Refresh rating now": the 24-hour cache bypassed on purpose, so
 * an owner who has just saved a Place ID can confirm it names the right
 * restaurant instead of waiting for a guest to open the menu.
 */
export async function refreshGoogleRatingAction(): Promise<void> {
  const userId = await requireUser();
  if (!(await googleLookupAllowed())) return finish(userId, false, "google_rate_limited");
  const result = await refreshVenueGoogleRating(userId);
  // A fresh number changes the public menu, so the success path purges
  // the CDN — which `finish(ok: true)` already does.
  return result.ok
    ? finish(userId, true, "google_refreshed")
    : finish(userId, false, `google_${result.error}`);
}

export async function saveLocalizationAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueLocalization(userId, {
    currency: String(form.get("currency") ?? ""),
    defaultLocale: String(form.get("defaultLocale") ?? ""),
    enabledLocales: form.getAll("enabledLocales").map(String),
  });
  return finish(userId, result.ok, "localization");
}

export async function saveHoursAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const { WEEKDAYS, compileWeekly } = await import("@/lib/opening-hours");
  const time = (v: FormDataEntryValue | null): string | null => {
    const t = String(v ?? "").trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null;
  };
  // Per-day grid: each day is closed, or has up to two open/close slots.
  const perDay: Partial<Record<Weekday, DayHours>> = {};
  for (const wd of WEEKDAYS) {
    if (form.get(`${wd}_closed`) === "on") {
      perDay[wd] = { closed: true, slots: [] };
      continue;
    }
    const slots: { open: string; close: string }[] = [];
    for (const n of [1, 2]) {
      const o = time(form.get(`${wd}_open${n}`));
      const c = time(form.get(`${wd}_close${n}`));
      if (o && c) slots.push({ open: o, close: c });
    }
    perDay[wd] = { closed: slots.length === 0, slots };
  }
  const hours = compileWeekly({ slots: [], closedDays: [], perDay });
  const result = await updateVenueHours(userId, hours);
  return finish(userId, result.ok, "hours");
}
