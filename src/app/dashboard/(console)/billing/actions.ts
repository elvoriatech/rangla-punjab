"use server";

import { venueAdminBase } from "@/lib/venue-service";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { createBillingPortal, createCheckout } from "@/lib/billing-service";
import { siteUrl } from "@/lib/public-menu";

async function requireUser(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return userId;
}

/**
 * Server action for the "Start / activate support subscription" button.
 * Success → redirect the whole page to Stripe's checkout URL (works even
 * without JS because it's a POST-then-redirect).
 */
export async function subscribeToSupportAction(): Promise<void> {
  const userId = await requireUser();
  const base = siteUrl();
  const adminBase = (await venueAdminBase(userId)) ?? "/dashboard";
  const result = await createCheckout(userId, "support", {
    successUrl: `${base}${adminBase}/billing?ok=1`,
    cancelUrl: `${base}${adminBase}/billing?cancelled=1`,
  });
  if (result.ok) redirect(result.url);
  // Fall through — checkout failed. Reload the billing page; error state
  // display is a polish follow-up.
  redirect(`${adminBase}/billing?error=checkout_failed`);
}

export async function openBillingPortalAction(): Promise<void> {
  const userId = await requireUser();
  const adminBase = (await venueAdminBase(userId)) ?? "/dashboard";
  const result = await createBillingPortal(userId, `${siteUrl()}${adminBase}/billing`);
  if (result.ok) redirect(result.url);
  redirect(`${adminBase}/billing?error=no_customer`);
}

/** "Set up payouts" — start (or resume) Stripe Connect onboarding for
 *  guest online payments. The fake provider completes instantly in dev;
 *  the real one sends the owner to Stripe's hosted KYC flow. */
export async function setupPaymentsAction(): Promise<void> {
  const userId = await requireUser();
  const { prisma } = await import("@/lib/db");
  const { startConnectOnboarding } = await import("@/lib/connect-service");
  const user = await prisma.user.findFirstOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  const base = (await venueAdminBase(userId)) ?? "/dashboard";
  const result = await startConnectOnboarding(userId, user.email, `${base}/billing`);
  if (!result || !result.ok) redirect(`${base}/billing?error=payments`);
  redirect(result.url);
}

/** Save the restaurant's OWN Stripe keys + enable flag (upfront/flat plans:
 *  the restaurant collects 100% directly). Keys are encrypted; blank fields
 *  keep the current value. */
export async function saveOwnKeysAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const { updateOwnKeys } = await import("@/lib/tenant-payment-keys");
  await updateOwnKeys(userId, {
    secret: String(form.get("ownSecret") ?? ""),
    webhook: String(form.get("ownWebhook") ?? ""),
    enabled: form.get("ownEnabled") === "on",
  });
  const base = (await venueAdminBase(userId)) ?? "/dashboard";
  redirect(`${base}/billing?ownkeys=saved`);
}

/** "Check connection" — re-verify the Connect account's status with Stripe
 *  (charges-enabled / KYC) so the owner can confirm their setup is live
 *  without waiting for a webhook. */
export async function checkPaymentsAction(): Promise<void> {
  const userId = await requireUser();
  const { refreshConnectStatus } = await import("@/lib/connect-service");
  await refreshConnectStatus(userId);
  const base = (await venueAdminBase(userId)) ?? "/dashboard";
  redirect(`${base}/billing?connect=checked`);
}
