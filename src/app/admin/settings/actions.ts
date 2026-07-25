"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import {
  updateOperatorSettings,
  updatePlatformStripeKeys,
  asEmailTransport,
  asAppTheme,
  type FeeMode,
} from "@/lib/operator-settings";

async function requireAdmin(): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId || !(await isPlatformAdmin(userId))) redirect("/login");
}

/** Parse a comma-or-dot decimal into a non-negative number, or 0 on garbage. */
function toNumber(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? "0").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * P3-1 — persist the operator fee model + site kill switch.
 * The form talks in human units (percent, euros); we store basis points
 * and cents.
 */
export async function saveOperatorSettingsAction(form: FormData): Promise<void> {
  await requireAdmin();
  const feeMode: FeeMode = form.get("feeMode") === "upfront" ? "upfront" : "percentage";
  const feeBp = Math.round(toNumber(form.get("feePercent")) * 100);
  const feeMinCents = Math.round(toNumber(form.get("feeMinEuros")) * 100);
  const siteActive = form.get("siteActive") === "on";
  // Email overrides: an empty transport/from means "use the env default",
  // stored as NULL. asEmailTransport() rejects anything off the whitelist.
  const emailTransport = asEmailTransport(String(form.get("emailTransport") ?? ""));
  const emailFromRaw = String(form.get("emailFrom") ?? "").trim();
  const emailFrom = emailFromRaw.length >= 3 ? emailFromRaw : null;
  const appTheme = asAppTheme(String(form.get("appTheme") ?? ""));
  await updateOperatorSettings({
    feeMode,
    feeBp,
    feeMinCents,
    siteActive,
    emailTransport,
    emailFrom,
    appTheme,
  });
  revalidatePath("/admin/settings", "page");
  // The theme lives on <html>, set in the root layout — revalidate it too so
  // the switch takes effect across every chrome route immediately.
  revalidatePath("/", "layout");
  redirect("/admin/settings?saved=1");
}

/**
 * Save the platform Stripe keys (encrypted at rest). Separate form so the
 * sensitive fields aren't posted with the rest of the settings. Blank fields
 * keep the current value (write-once UX); the raw values are never echoed
 * back — the page shows only masked hints.
 */
export async function savePlatformStripeKeysAction(form: FormData): Promise<void> {
  await requireAdmin();
  await updatePlatformStripeKeys({
    secret: String(form.get("stripeSecret") ?? ""),
    webhook: String(form.get("stripeWebhook") ?? ""),
    connectWebhook: String(form.get("stripeConnectWebhook") ?? ""),
  });
  revalidatePath("/admin/settings", "page");
  redirect("/admin/settings?saved=keys");
}
