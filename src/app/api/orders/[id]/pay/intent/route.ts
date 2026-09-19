import { NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { createOrderPaymentIntent } from "@/lib/connect-service";
import { getOperatorSettings } from "@/lib/operator-settings";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { checkRateLimit, ORDER_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Guest pays inside the mobile app — the native-PaymentSheet sibling of
 * POST /api/orders/{id}/pay. Same auth (the order's HMAC receipt token),
 * same kill switch, same rate limit; returns a PaymentIntent client
 * secret plus the publishable key that unlocks it, rather than a hosted
 * checkout URL.
 *
 * The app falls back to /pay (hosted checkout in a browser) on any
 * non-201 — notably `publishable_key_missing`, which means the server has
 * real Stripe keys but nobody has configured the public identifier yet.
 *
 * CORS: native fetch ignores it, but the Expo web preview calls this
 * cross-origin. Safe to be permissive — no cookies, token-authorized.
 */

const bodySchema = z.object({ token: z.string().min(10).max(2048) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rl = await checkRateLimit(ORDER_IP, clientIp(request));
  if (!rl.ok) return withCors(NextResponse.json({ error: "rate_limited" }, { status: 429 }));

  // P2-4: site kill switch — no new payments while the site is paused.
  const settings = await getOperatorSettings();
  if (!settings.siteActive) {
    return withCors(NextResponse.json({ error: "ordering_paused" }, { status: 503 }));
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "invalid" }, { status: 400 }));

  const verified = verifyReceiptToken(parsed.data.token);
  if (!verified || verified.orderId !== id) {
    return withCors(NextResponse.json({ error: "invalid_token" }, { status: 403 }));
  }

  const result = await createOrderPaymentIntent(verified.tenantId, id, parsed.data.token);
  if (!result.ok) {
    const status =
      result.error === "invalid_token" ? 403 : result.error === "not_found" ? 404 : 409;
    return withCors(NextResponse.json({ error: result.error }, { status }));
  }
  return withCors(
    NextResponse.json(
      {
        mode: result.mode,
        ref: result.ref,
        clientSecret: result.clientSecret,
        publishableKey: result.publishableKey,
        amountCents: result.amountCents,
        currency: result.currency,
        merchantName: result.merchantName,
      },
      { status: 201 },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
