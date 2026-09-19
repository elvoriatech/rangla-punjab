import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { getStripeProvider, sharedStripeConfigured, stripeProviderForKey } from "@/lib/stripe";
import { markOrderPaid } from "@/lib/connect-service";
import { captureException } from "@/lib/observability";

/**
 * Own-keys webhook: settles orders charged on the restaurant's OWN Stripe
 * account (upfront/flat plan). The owner points a webhook in their Stripe at
 * this URL; we verify it with their stored webhook secret. Single-restaurant
 * deploy ⇒ exactly one tenant to resolve. (The fake/demo path settles via the
 * local pay-confirm route instead; this endpoint is the real-Stripe path.)
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  const tenant = await prisma.tenant.findFirst({
    where: { stripeOwnEnabled: true, stripeOwnSecretEnc: { not: null } },
    select: { id: true, stripeOwnSecretEnc: true, stripeOwnWebhookEnc: true },
  });
  const secret = decryptSecret(tenant?.stripeOwnSecretEnc);
  const webhook = decryptSecret(tenant?.stripeOwnWebhookEnc);
  // Dashboard keys win; otherwise the deployment's STRIPE_* env keys are the
  // restaurant's account (single-restaurant build) and STRIPE_WEBHOOK_SECRET
  // verifies this delivery — so the owner may register either this URL or
  // /api/stripe/webhook and both settle the order.
  const provider =
    tenant && secret && webhook
      ? await stripeProviderForKey(secret, webhook)
      : (await sharedStripeConfigured())
        ? await getStripeProvider()
        : null;
  if (!provider) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }
  let event;
  try {
    event = provider.constructWebhookEvent(body, signature);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    // `checkout.session.completed` is the hosted-checkout (web) settlement;
    // `payment_intent.succeeded` is the same order paid through the mobile
    // app's native payment sheet. Both objects carry the orderId/tenantId
    // metadata we stamped at creation, so they settle identically.
    if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
      const object = event.data.object as { metadata?: Record<string, string | null> };
      const orderId = object.metadata?.orderId;
      const tenantId =
        object.metadata?.tenantId ??
        tenant?.id ??
        (await prisma.tenant.findFirst({ select: { id: true } }))?.id;
      if (orderId && tenantId) await markOrderPaid(tenantId, orderId);
    }
    // payment_intent.payment_failed is deliberately ignored: the order
    // stays pending so the guest can retry with another card.
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    captureException(err, { eventId: event.id, eventType: event.type });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
