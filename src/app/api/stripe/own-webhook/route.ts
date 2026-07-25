import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { stripeProviderForKey } from "@/lib/stripe";
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
  if (!tenant || !secret || !webhook) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const provider = await stripeProviderForKey(secret, webhook);
  let event;
  try {
    event = provider.constructWebhookEvent(body, signature);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { metadata?: Record<string, string | null> };
      const orderId = session.metadata?.orderId;
      if (orderId) await markOrderPaid(tenant.id, orderId);
    }
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    captureException(err, { eventId: event.id, eventType: event.type });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
