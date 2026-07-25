"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { provisionRestaurant } from "@/lib/provisioning";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { requestPasswordReset } from "@/lib/verification-service";

/**
 * Provision a new restaurant (P3-2). Operator-only — the service itself
 * re-checks isPlatformAdmin. On success we land back on the list with the
 * new restaurant; on failure we bounce to the form with a coded error so
 * the operator can correct the input (nothing was created).
 */
export async function provisionRestaurantAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const result = await provisionRestaurant(userId, {
    restaurantName: String(form.get("restaurantName") ?? ""),
    ownerEmail: String(form.get("ownerEmail") ?? ""),
    templateKey: String(form.get("templateKey") ?? ""),
    venueName: String(form.get("venueName") ?? "").trim() || undefined,
    currency: String(form.get("currency") ?? "EUR"),
    locale: String(form.get("locale") ?? "en"),
  });

  if (result.ok) {
    revalidatePath("/admin/restaurants", "page");
    redirect("/admin/restaurants?saved=provisioned");
  }
  if (result.error === "forbidden") redirect("/login");
  redirect(`/admin/restaurants/new?error=${result.error}`);
}

/**
 * Re-send the owner's set-password invite (the same reset-token email used
 * at provisioning). Operator-only. Safe: requestPasswordReset is a no-op if
 * the email isn't on file, so it never reveals whether an account exists.
 */
export async function resendOwnerInviteAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  if (!(await isPlatformAdmin(userId))) redirect("/login");
  const email = String(form.get("ownerEmail") ?? "").trim();
  if (email) await requestPasswordReset(email);
  revalidatePath("/admin/restaurants", "page");
  redirect("/admin/restaurants?saved=invited");
}
