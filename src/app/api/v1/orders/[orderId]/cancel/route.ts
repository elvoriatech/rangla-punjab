import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { cancelUnpaidOrderByGuest } from "@/lib/connect-service";
import { corsPreflight, withCors } from "@/lib/cors";
import { checkRateLimit, ORDER_IP } from "@/lib/rate-limit";
import { verifyReceiptToken } from "@/lib/receipt-token";

/**
 * POST /api/v1/orders/{orderId}/cancel — the guest calls off their own
 * order while its online payment is stuck.
 *
 * Authorised by the order's receipt token (the same one every pay route
 * takes). The rules — still `placed`, unpaid, card/PayPal chosen, and a
 * Stripe payment that has not succeeded or is not still processing — live
 * in `cancelUnpaidOrderByGuest`; this route only maps its answer to HTTP.
 */

const bodySchema = z.object({ token: z.string().min(10).max(2048) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  const rl = await checkRateLimit(ORDER_IP, clientIp(request));
  if (!rl.ok) return withCors(NextResponse.json({ error: "rate_limited" }, { status: 429 }));

  const { orderId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "invalid" }, { status: 400 }));

  const verified = verifyReceiptToken(parsed.data.token);
  if (!verified || verified.orderId !== orderId) {
    return withCors(NextResponse.json({ error: "invalid_token" }, { status: 403 }));
  }

  const result = await cancelUnpaidOrderByGuest(verified.tenantId, orderId, parsed.data.token);
  if (!result.ok) {
    const status =
      result.error === "invalid_token" ? 403 : result.error === "not_found" ? 404 : 409;
    return withCors(NextResponse.json({ error: result.error }, { status }));
  }
  return withCors(
    NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
