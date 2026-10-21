import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { getStripeProvider, sharedStripeConfigured, stripeProviderForKey } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/stripe/webhook-handler";
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
    // Same dispatcher as /api/stripe/webhook: each event id is handled
    // once (a retry or a manual "Resend" of a handled event is a no-op),
    // every settlement is checked against the order's current payment, a
    // deleted order never comes back, and gift cards activate here too.
    const outcome = await handleStripeEvent(event);
    return NextResponse.json({ received: true, kind: outcome.kind }, { status: outcome.status });
  } catch (err) {
    captureException(err, { eventId: event.id, eventType: event.type });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
