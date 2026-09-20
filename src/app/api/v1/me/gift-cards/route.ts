import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { authenticateCustomer } from "@/lib/customer-request";
import { listGiftCardsForCustomer } from "@/lib/gift-card-service";

/**
 * GET /api/v1/me/gift-cards — every card this guest has BOUGHT, in
 * whatever state, newest first.
 *
 * "Bought", not "holds": a gift card is a bearer instrument with no
 * owner field, so there is no such thing as the set of cards in your
 * possession. What the account can honestly show is the ones you paid
 * for — including the ones you gave away, which is exactly what the
 * buyer wants to see ("did they use it yet?").
 *
 * Abandoned `pending_payment` rows are filtered out by the service: a
 * card nobody paid for was never bought.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateCustomer(req);
  if (!auth.ok) {
    const status = auth.reason === "unavailable" ? 503 : 401;
    const error = auth.reason === "unavailable" ? "unavailable" : "unauthorized";
    return withCors(NextResponse.json({ ok: false, error }, { status }));
  }

  // A gift-card outage must not cost the guest their account screen —
  // same posture as the loyalty read next door.
  const cards = await listGiftCardsForCustomer(auth.tenantId, auth.customer.id).catch(() => []);

  return withCors(
    NextResponse.json({ ok: true, cards }, { headers: { "Cache-Control": "private, no-store" } }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
