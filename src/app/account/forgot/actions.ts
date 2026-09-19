"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { clientIp } from "@/lib/client-ip";
import { requestCustomerPasswordReset } from "@/lib/customer-password-reset";
import { isLocaleCode } from "@/lib/locales";
import { resolvePreviewContext } from "@/lib/preview-context";
import { checkRateLimit, RESET_EMAIL, RESET_IP } from "@/lib/rate-limit";
import { getRestaurantSlug } from "@/lib/restaurant";

/**
 * "Send me a reset link" — the no-JS twin of
 * `POST /api/auth/customer/reset/request`. Same rate limits, same
 * service call, same deliberate silence: every outcome that is about the
 * ADDRESS (unknown, deleted, signs in with Google) ends on the same
 * `?sent=1` screen, so the form cannot be used to find out who has an
 * account here. Only outcomes about the CALLER — a malformed address, a
 * tripped limiter — say anything else.
 */

const schema = z.object({ email: z.string().trim().email().max(254) });

export async function requestCustomerResetAction(form: FormData): Promise<void> {
  const localeRaw = String(form.get("locale") ?? "");
  const locale = isLocaleCode(localeRaw) ? localeRaw : null;
  const app = sanitizeAppReturnUrl(String(form.get("app") ?? ""));
  const back = (suffix: string): string => {
    const params = new URLSearchParams(suffix);
    if (locale) params.set("locale", locale);
    if (app) params.set("app", app);
    return `/account/forgot?${params.toString()}`;
  };

  const parsed = schema.safeParse({ email: form.get("email") });
  if (!parsed.success) redirect(back("error=invalid"));

  // Server actions don't receive the Request; headers() carries the same
  // proxy headers, so the shared trust-boundary logic stays in one place.
  const ip = clientIp(new Request("http://action.local", { headers: await headers() }));
  for (const [cfg, id] of [
    [RESET_IP, ip] as const,
    [RESET_EMAIL, parsed.data.email.toLowerCase()] as const,
  ]) {
    const rl = await checkRateLimit(cfg, id);
    if (!rl.ok) redirect(back("error=rate_limited"));
  }

  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) redirect(back("error=failed"));

  await requestCustomerPasswordReset(context.tenantId, parsed.data.email, {
    locale,
    appReturnUrl: app,
  });
  redirect(back("sent=1"));
}
