import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { authenticateCustomer } from "@/lib/customer-request";
import { cancelPendingGiftCard } from "@/lib/gift-card-payment";

/**
 * POST /api/v1/gift-cards/{id}/cancel — the buyer backs out of a voucher
 * purchase whose payment is stuck.
 *
 * Signed-in customers only, and only their OWN unpaid card (checked in
 * `cancelPendingGiftCard`, which also asks Stripe first so a payment that
 * already went through activates the card instead of losing it).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const auth = await authenticateCustomer(req);
  if (!auth.ok) {
    const status = auth.reason === "unavailable" ? 503 : 401;
    const error = auth.reason === "unavailable" ? "unavailable" : "unauthorized";
    return withCors(NextResponse.json({ ok: false, error }, { status }));
  }

  const result = await cancelPendingGiftCard(auth.tenantId, auth.customer.id, id);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return withCors(NextResponse.json({ ok: false, error: result.error }, { status }));
  }
  return withCors(
    NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
