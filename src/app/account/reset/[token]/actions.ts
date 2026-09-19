"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import {
  CUSTOMER_PASSWORD_MIN_LENGTH,
  consumeCustomerPasswordReset,
} from "@/lib/customer-password-reset";
import { isLocaleCode } from "@/lib/locales";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";

/**
 * Set the new password — the no-JS twin of
 * `POST /api/auth/customer/reset/[token]`.
 *
 * On success there is deliberately NO auto-sign-in: consuming the token
 * revoked every live session of that customer, so the honest next step is
 * the sign-in form with the password they just chose. When the link came
 * from the phone (`app=`), the last hop is the hand-over page instead, so
 * the browser gives control back to the app.
 */

const schema = z.object({
  token: z.string().trim().min(10).max(512),
  password: z.string().min(CUSTOMER_PASSWORD_MIN_LENGTH).max(200),
  confirm: z.string().min(1).max(200),
});

export async function resetCustomerPasswordAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const localeRaw = String(form.get("locale") ?? "");
  const locale = isLocaleCode(localeRaw) ? localeRaw : null;
  const app = sanitizeAppReturnUrl(String(form.get("app") ?? ""));
  const back = (error: string): string => {
    const params = new URLSearchParams({ error });
    if (locale) params.set("locale", locale);
    if (app) params.set("app", app);
    return `/account/reset/${encodeURIComponent(token)}?${params.toString()}`;
  };

  const parsed = schema.safeParse({
    token,
    password: form.get("password"),
    confirm: form.get("confirm"),
  });
  if (!parsed.success) redirect(back("invalid"));
  if (parsed.data.password !== parsed.data.confirm) redirect(back("mismatch"));

  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) redirect(back("failed"));

  const result = await consumeCustomerPasswordReset(
    context.tenantId,
    parsed.data.token,
    parsed.data.password,
  );
  if (!result.ok) {
    redirect(back(result.error === "weak_password" ? "invalid" : "invalid_or_expired"));
  }

  if (app) {
    const params = new URLSearchParams({ to: app, status: "reset" });
    if (locale) params.set("locale", locale);
    redirect(`/auth/app-return?${params.toString()}`);
  }
  redirect(`/account?reset=1${locale ? `&locale=${locale}` : ""}`);
}
