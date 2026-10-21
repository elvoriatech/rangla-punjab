import { NextResponse } from "next/server";
import { z } from "zod";
import { processStripeOrderPayment } from "@/lib/connect-service";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { getStripeProvider } from "@/lib/stripe";

/**
 * FAKE-PROVIDER ONLY: the local pay page's "Pay" button completes the
 * fake checkout (the card is reserved, as with Stripe) and then settles it
 * through the same capture-after-checks path the webhook uses. With the real
 * provider this endpoint refuses — real settlements come exclusively
 * through the signed webhook.
 */

const bodySchema = z.object({
  token: z.string().min(10).max(2048),
  ref: z.string().min(4).max(128),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const provider = await getStripeProvider();
  if (provider.mode !== "fake") {
    return NextResponse.json({ error: "webhook_only" }, { status: 400 });
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const verified = verifyReceiptToken(parsed.data.token);
  if (!verified || verified.orderId !== id) {
    return NextResponse.json({ error: "invalid_token" }, { status: 403 });
  }

  // The fake provider tracks the checkout ref; settling twice is a no-op.
  const settled = (
    provider as unknown as {
      settleOrderCheckout(ref: string): { orderId: string; tenantId: string } | null;
    }
  ).settleOrderCheckout(parsed.data.ref);
  if (!settled || settled.orderId !== id) {
    return NextResponse.json({ error: "unknown_checkout" }, { status: 404 });
  }
  const done = await processStripeOrderPayment(verified.tenantId, parsed.data.ref, {
    orderId: id,
    source: "verify",
  });
  const paid = done.kind === "settled" || (done.kind === "already_processed" && done.paid);
  return NextResponse.json({ paid }, { status: paid ? 200 : 409 });
}
