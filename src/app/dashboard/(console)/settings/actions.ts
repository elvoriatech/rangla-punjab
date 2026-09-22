"use server";

import {
  updateVenueBanner,
  updateVenueHeroSlides,
  updateVenueHours,
  updateVenueOrdering,
} from "@/lib/venue-service";
import type { DayHours, Weekday } from "@/lib/opening-hours";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId, setSessionCookie } from "@/lib/auth";
import { changeUserPassword } from "@/lib/auth-service";
import { clientIp } from "@/lib/client-ip";
import { saveUploadedImage } from "@/lib/media-service";
import {
  BUILT_IN_SLIDES,
  HERO_BANNER_STORAGE,
  HERO_SLIDE_STORAGE,
  bannerSlideKey,
} from "@/lib/hero-slides";
import { checkRateLimit, GOOGLE_LOOKUP_IP, PASSWORD_CHANGE_IP } from "@/lib/rate-limit";
import { searchPlaces } from "@/lib/google-rating";
import {
  refreshVenueGoogleRating,
  updateVenueAppLinks,
  updateGiftCardProduct,
  updateVenueContact,
  updateVenueGiftCards,
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

/**
 * `finish`'s twin for the one card on this page that isn't about the
 * VENUE. Same redirect contract (`?saved=` / `?error=` read by the same
 * MESSAGES map), minus the CDN purge: a password appears on no cached
 * copy of the public menu, so purging it would be an API call that buys
 * nothing.
 */
async function finishAccount(userId: string, ok: boolean, flag: string): Promise<never> {
  const path = `${(await venueAdminBase(userId)) ?? "/dashboard"}/settings`;
  revalidatePath("/dashboard/settings", "page");
  redirect(ok ? `${path}?saved=${flag}` : `${path}?error=${flag}`);
}

/**
 * The owner's own password — current, new, confirm.
 *
 * The current password is not ceremony: this page is reached from a
 * dashboard that stays open on the counter's tablet all service, and
 * without it anyone walking past could lock the owner out of their own
 * restaurant. `changeUserPassword` owns every rule; this action is the
 * cookie half.
 *
 * That cookie half matters. A successful change bumps
 * `sessions_valid_from`, which kills EVERY session value issued before
 * it — including the one in the browser that just submitted the form. So
 * we mint a fresh cookie immediately afterwards: other devices (and the
 * restaurant app, if it is signed in on the same account) are signed
 * out, this browser is not. That is exactly what the success banner
 * promises.
 */
export async function changePasswordAction(form: FormData): Promise<void> {
  const userId = await requireUser();

  // Per-IP ceiling on top of the session check: the form takes the
  // current password, so an unattended dashboard is otherwise a guessing
  // oracle. Server actions don't receive the Request; `headers()` carries
  // the same proxy headers, so the trust boundary stays in `clientIp()`.
  const ip = clientIp(new Request("http://action.local", { headers: await headers() }));
  const rl = await checkRateLimit(PASSWORD_CHANGE_IP, ip);
  if (!rl.ok) return finishAccount(userId, false, "password_rate_limited");

  const result = await changeUserPassword(userId, {
    currentPassword: String(form.get("currentPassword") ?? ""),
    newPassword: String(form.get("newPassword") ?? ""),
    confirmPassword: String(form.get("confirmPassword") ?? ""),
  });
  if (!result.ok) return finishAccount(userId, false, `password_${result.error}`);

  // Re-issued AFTER the write, so its `iat` sits at or past the new
  // cutoff. Legal here because a Server Function may write cookies.
  await setSessionCookie(userId);
  return finishAccount(userId, true, "password");
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

/** Adds one photo to the end of the app's home slider. */
export async function addHeroSlideAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const slide = form.get("slide");
  if (!(slide instanceof File) || slide.size === 0) return finish(userId, false, "slide");
  const saved = await saveUploadedImage(userId, slide, "App home slider dish", HERO_SLIDE_STORAGE);
  if (!saved.ok) return finish(userId, false, "slide");
  const result = await updateVenueHeroSlides(userId, { op: "add", key: saved.storageKey });
  if (!result.ok && result.error === "full") return finish(userId, false, "slide-full");
  return finish(userId, result.ok, "slide");
}

/** Adds a full-slide banner (a finished poster) to the end of the slider. */
export async function addHeroBannerAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const banner = form.get("slideBanner");
  if (!(banner instanceof File) || banner.size === 0) return finish(userId, false, "slide");
  const saved = await saveUploadedImage(
    userId,
    banner,
    "App home slider banner",
    HERO_BANNER_STORAGE,
  );
  if (!saved.ok) return finish(userId, false, "slide");
  const result = await updateVenueHeroSlides(userId, {
    op: "add",
    key: bannerSlideKey(saved.storageKey),
  });
  if (!result.ok && result.error === "full") return finish(userId, false, "slide-full");
  return finish(userId, result.ok, "slide");
}

/**
 * Puts one of the app's own posters back in the slider.
 *
 * The name is checked against the catalogue rather than trusted: a
 * `builtin:` key that names no file would render a broken slide in every
 * guest's app, and this form posts a name straight from the browser.
 */
export async function addBuiltInSlideAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const name = String(form.get("name") ?? "");
  if (!BUILT_IN_SLIDES.some((s) => s.name === name)) {
    return finish(userId, false, "slide-builtin");
  }
  const result = await updateVenueHeroSlides(userId, { op: "add", key: `builtin:${name}` });
  if (!result.ok && result.error === "full") return finish(userId, false, "slide-full");
  return finish(userId, result.ok, "slide-builtin");
}

export async function removeHeroSlideAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const key = String(form.get("key") ?? "");
  const result = await updateVenueHeroSlides(userId, { op: "remove", key });
  return finish(userId, result.ok, "slide-removed");
}

/** Moves a slide one place earlier (`dir=up`) or later (`dir=down`). */
export async function moveHeroSlideAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const key = String(form.get("key") ?? "");
  const by = form.get("dir") === "up" ? -1 : 1;
  const result = await updateVenueHeroSlides(userId, { op: "move", key, by });
  return finish(userId, result.ok, "slide-moved");
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
    // Minutes a guest may cancel a CASH order; 0 = off, capped at 60 by
    // the schema, blank falls back to the default 10.
    cashCancelMinutes: parseInt(String(form.get("cashCancelMinutes") ?? ""), 10),
    // An unchecked checkbox sends nothing at all, which is exactly the
    // `off` we want — and off is where this one belongs by default.
    appCancelEnabled: form.get("appCancelEnabled") === "on",
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

/**
 * Gift cards: the master switch and how long a card stays valid.
 *
 * The expiry box is deliberately tolerant — `gift-card-config.ts` catches
 * a blank or fat-fingered value and falls back to the recommended 36
 * months rather than failing the save. An owner must never end up with a
 * card term they did not choose BECAUSE the form refused to save.
 */
export async function saveGiftCardsAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueGiftCards(userId, {
    enabled: form.get("giftCardsEnabled") === "on",
    expiryMonths: parseInt(String(form.get("giftCardExpiryMonths") ?? ""), 10),
  });
  return finish(userId, result.ok, "giftcards");
}

/**
 * One gift-card design — name, price, picture, on/off sale.
 *
 * One row posts at a time: the three designs are independent products, and
 * an owner re-pricing the €50 card should not have to re-pick the other
 * two pictures to save it.
 *
 * The file input is OPTIONAL here, unlike the logo card's: an empty one
 * means "keep the picture you have", so renaming a design never silently
 * clears its artwork. A chosen file follows `saveLogoAction` exactly —
 * ingest through `saveUploadedImage`, store the returned storage key.
 */
export async function saveGiftCardProductAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const productId = String(form.get("productId") ?? "");

  // Euro input, integer cents in the DB — the same conversion the ordering
  // and loyalty saves do. A blank or unparseable box becomes 0, which the
  // service refuses: a €0 gift card is a mistake, not a price.
  const cents = Math.round(parseFloat(String(form.get("price") ?? "").replace(",", ".")) * 100);

  const image = form.get("image");
  let imageKey: string | undefined;
  if (image instanceof File && image.size > 0) {
    const saved = await saveUploadedImage(userId, image, "Gift card design");
    if (!saved.ok) return finish(userId, false, "giftcard-image");
    imageKey = saved.storageKey;
  }

  const result = await updateGiftCardProduct(userId, productId, {
    name: String(form.get("name") ?? "").trim(),
    priceCents: Number.isFinite(cents) ? cents : 0,
    active: form.get("active") === "on",
    ...(imageKey ? { imageKey } : {}),
  });
  return finish(userId, result.ok, "giftcard-product");
}

/** Drop a design's picture back to none — the twin of `removeLogoAction`,
 *  and the only way back once an owner has uploaded over a shipped
 *  default. */
export async function removeGiftCardImageAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateGiftCardProduct(userId, String(form.get("productId") ?? ""), {
    imageKey: null,
  });
  return finish(userId, result.ok, "giftcard-image-removed");
}

/**
 * The restaurant's own ways in — landline, mobile, WhatsApp, e-mail.
 *
 * All four post together because they are one card, and an empty box is
 * the clear: deleting the text and pressing save is what an owner means by
 * "take that off the menu". A box that holds something which is not a
 * phone number (or, for e-mail, not an address) is refused BY NAME
 * (`contact_mobile`, `contact_email`), so the banner can say which of the
 * four to look at — silently dropping it would leave the owner believing
 * something is published when it is not.
 *
 * `finish(ok: true)` purges the CDN: these numbers are on every cached copy
 * of the public menu.
 */
export async function saveContactAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueContact(userId, {
    landline: String(form.get("landline") ?? ""),
    // No longer offered (landline + e-mail only): saving clears any number
    // stored before, so nothing lingers in the database either.
    mobile: "",
    whatsapp: "",
    email: String(form.get("email") ?? ""),
    address: String(form.get("address") ?? ""),
  });
  return finish(userId, result.ok, result.ok ? "contact" : `contact_${result.field ?? "invalid"}`);
}

/**
 * Where a guest gets the app — App Store, Google Play, direct APK.
 *
 * One card, three boxes, posted together for the same reason the contact
 * numbers are: they answer one question ("can I get your app?") and an
 * owner fixing a typo in one must not have to re-paste the others.
 *
 * An empty box is the clear. A box holding something that is not a
 * publishable link is refused BY NAME (`app_ios`), because the commonest
 * mistake here is pasting the Play listing into the Apple box — which a
 * bare "invalid" would leave the owner hunting for.
 *
 * `finish(ok: true)` purges the CDN: these links are in the footer and the
 * header of every cached copy of the public menu.
 */
export async function saveAppLinksAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const result = await updateVenueAppLinks(userId, {
    ios: String(form.get("appIos") ?? ""),
    android: String(form.get("appAndroid") ?? ""),
    apk: String(form.get("appApk") ?? ""),
  });
  return finish(userId, result.ok, result.ok ? "app" : `app_${result.field ?? "invalid"}`);
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
