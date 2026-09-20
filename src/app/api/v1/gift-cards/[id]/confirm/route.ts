import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { authenticateCustomer } from "@/lib/customer-request";
import { settleFakeGiftCardPayment } from "@/lib/gift-card-payment";
import { getStripeProvider } from "@/lib/stripe";
import { asTenant } from "@/lib/tenant";

/**
 * POST /api/v1/gift-cards/{id}/confirm — dev/CI only.
 *
 * The fake Stripe provider has no sheet and sends no webhooks, so the
 * app shows a "Simulate payment (test)" button that lands here. The
 * order flow has the identical escape hatch at
 * `/api/orders/{id}/pay/confirm`, and this is its gift-card twin,
 * including the hard refusal when the provider is real: a route that
 * could mark a card paid without money moving is a route that will, one
 * day, be called in production.
 */

const bodySchema = z.object({ ref: z.string().min(3).max(200) });

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

  const provider = await getStripeProvider();
  if (provider.mode !== "fake") {
    // Real money settles by webhook, and only by webhook.
    return withCors(NextResponse.json({ ok: false, error: "webhook_only" }, { status: 400 }));
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }

  // The card must be this guest's own. The confirm route is the one place
  // a client names a card id directly, so ownership is checked here
  // rather than inferred — a bearer code lets you SPEND a card, never
  // settle someone else's purchase.
  const owned = await asTenant(auth.tenantId, (tx) =>
    tx.giftCard.findFirst({
      where: { id, purchaserCustomerId: auth.customer.id },
      select: { id: true },
    }),
  );
  if (!owned) {
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
  }

  const settled = await (
    provider as unknown as { settleOrderCheckout(ref: string): unknown }
  ).settleOrderCheckout(parsed.data.ref);
  if (!settled) {
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
  }

  const paid = await settleFakeGiftCardPayment(auth.tenantId, id, parsed.data.ref);
  return withCors(
    NextResponse.json({ ok: true, paid }, { headers: { "Cache-Control": "private, no-store" } }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
