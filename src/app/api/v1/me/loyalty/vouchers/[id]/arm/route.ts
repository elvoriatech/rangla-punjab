import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { authenticateCustomer } from "@/lib/customer-request";
import { setVoucherArmed } from "@/lib/loyalty-service";
import { checkRateLimit, type RateLimitConfig } from "@/lib/rate-limit";

/**
 * POST /api/v1/me/loyalty/vouchers/{id}/arm — "use this voucher on my
 * next order" (or take it back off). Round one only records the intent;
 * the checkout half that spends it is round two.
 *
 * 404 `not_found` when the voucher is not this customer's, 409
 * `not_armable` when it is redeemed / expired / revoked — never a silent
 * 200, because the app's toggle has to be able to snap back.
 */

/** Token-authenticated, so this is not brute-force defence: it bounds how
 *  hard one device can hammer the toggle if its UI ever loops. Same
 *  ceiling and posture as the profile write on /api/v1/me. */
const LOYALTY_WRITE_IP: RateLimitConfig = {
  scope: "loyalty-write:ip",
  limit: 30,
  windowSec: 60,
  failOpen: true,
};

const bodySchema = z.object({ armed: z.boolean() });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rl = await checkRateLimit(LOYALTY_WRITE_IP, clientIp(req));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }

  const auth = await authenticateCustomer(req);
  if (!auth.ok) {
    const status = auth.reason === "unavailable" ? 503 : 401;
    const error = auth.reason === "unavailable" ? "unavailable" : "unauthorized";
    return withCors(NextResponse.json({ ok: false, error }, { status }));
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }

  const { id } = await ctx.params;
  const result = await setVoucherArmed(auth.tenantId, auth.customer.id, id, parsed.data.armed);
  if (!result.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error },
        { status: result.error === "not_found" ? 404 : 409 },
      ),
    );
  }

  return withCors(
    NextResponse.json(
      { ok: true, voucher: result.voucher },
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
