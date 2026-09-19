import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { requestCustomerPasswordReset } from "@/lib/customer-password-reset";
import { checkRateLimit, RESET_EMAIL, RESET_IP } from "@/lib/rate-limit";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";

/**
 * "Send me a reset link" for a GUEST account — the app's forgot-password
 * sheet and the web form both land here.
 *
 * ALWAYS `200 {ok:true}`: a known address, an unknown one and a Google
 * account are indistinguishable from the outside, so this endpoint can
 * never be used to find out who eats here. The 429 is a different signal
 * (a limit on the caller, not a verdict on the address), and the 404 only
 * fires when the deployment has no venue at all.
 *
 * `appReturnUrl` is the phone's deep link; it is allow-listed to app
 * schemes inside the service before it is put into the emailed link.
 */

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  locale: z.string().trim().max(10).optional(),
  appReturnUrl: z.string().trim().max(512).nullish(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "invalid" }, { status: 400 }));

  for (const [cfg, id] of [
    [RESET_IP, clientIp(request)] as const,
    [RESET_EMAIL, parsed.data.email.trim().toLowerCase()] as const,
  ]) {
    const rl = await checkRateLimit(cfg, id);
    if (!rl.ok) {
      return withCors(
        NextResponse.json(
          { error: "rate_limited" },
          { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
        ),
      );
    }
  }

  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) return withCors(NextResponse.json({ error: "unknown_venue" }, { status: 404 }));

  await requestCustomerPasswordReset(context.tenantId, parsed.data.email, {
    locale: parsed.data.locale ?? null,
    appReturnUrl: parsed.data.appReturnUrl ?? null,
  });
  return withCors(NextResponse.json({ ok: true }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
