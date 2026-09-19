import { NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { verifyOrderPayment } from "@/lib/connect-service";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { checkRateLimit, ORDER_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * POST /api/orders/{id}/pay/verify — "did my card payment go through?"
 *
 * The app's PaymentSheet already knows the answer; this makes the SERVER
 * know it too, by reading the PaymentIntent from Stripe and settling the
 * order when it succeeded. Belt to the webhook's braces: a venue with a
 * missing or mis-subscribed webhook still shows the guest "Paid" and still
 * prints the kitchen ticket. Same auth as every pay route (the order's
 * receipt token), same rate limit, CORS for the Expo web preview.
 */

const bodySchema = z.object({ token: z.string().min(10).max(2048) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rl = await checkRateLimit(ORDER_IP, clientIp(request));
  if (!rl.ok) return withCors(NextResponse.json({ error: "rate_limited" }, { status: 429 }));

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "invalid" }, { status: 400 }));

  const verified = verifyReceiptToken(parsed.data.token);
  if (!verified || verified.orderId !== id) {
    return withCors(NextResponse.json({ error: "invalid_token" }, { status: 403 }));
  }

  const result = await verifyOrderPayment(verified.tenantId, id, parsed.data.token);
  if (!result.ok) {
    const status =
      result.error === "invalid_token" ? 403 : result.error === "not_found" ? 404 : 409;
    return withCors(NextResponse.json({ error: result.error }, { status }));
  }
  return withCors(
    NextResponse.json(
      { paid: result.paid, status: result.status },
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
