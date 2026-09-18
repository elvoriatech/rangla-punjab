"use server";

import { updateVenueBanner, updateVenueHours, updateVenueOrdering } from "@/lib/venue-service";
import type { DayHours, Weekday } from "@/lib/opening-hours";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { saveUploadedImage } from "@/lib/media-service";
import {
  updateVenueHalalFilter,
  updateVenueLocalization,
  updateVenueLogo,
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
  });
  return finish(userId, result.ok, "ordering");
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
