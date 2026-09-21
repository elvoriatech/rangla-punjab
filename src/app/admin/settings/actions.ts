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

/**
 * P3-1 — persist the operator fee model + site kill switch.
 * The form talks in human units (percent, euros); we store basis points
 * and cents.
 */
export async function saveOperatorSettingsAction(form: FormData): Promise<void> {
  await requireAdmin();
  // Single-restaurant white-label: no commission, ever. feeMode stays
  // pinned to "upfront" (= own-gateway mode, 0 per order) — the form no
  // longer posts fee fields and this action must never resurrect them.
  const feeMode: FeeMode = "upfront";
  const feeBp = 0;
  const feeMinCents = 0;
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
  // prod.env owns the Stripe keys — nothing may be saved over them.
  const { stripeKeysInEnv } = await import("@/lib/payment-keys-env");
  if (stripeKeysInEnv()) redirect("/admin/settings");
  await updatePlatformStripeKeys({
    secret: String(form.get("stripeSecret") ?? ""),
    webhook: String(form.get("stripeWebhook") ?? ""),
    connectWebhook: String(form.get("stripeConnectWebhook") ?? ""),
  });
  revalidatePath("/admin/settings", "page");
  redirect("/admin/settings?saved=keys");
}
