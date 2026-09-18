import { prisma } from "./db";
import { asTenant } from "./tenant";
import { createLogger } from "./logger";
import type { PayPalWebhookHeaders } from "./paypal";
import { parsePayPalCustomId, payPalProviderFor } from "./paypal";
import { env } from "./env";
import { finalizePayPalReturn } from "./paypal-service";
import { getPayPalKeysForTenant } from "./tenant-payment-keys";
import { markOrderPaid } from "./connect-service";

const log = createLogger();

/**
 * PayPal webhook business logic, kept out of the route so tests can call
 * it without an HTTP round-trip (same split as the Stripe handler).
 *
 * Why this exists: the return leg (/api/paypal/return) only fires if the
 * guest's browser actually comes back from PayPal. Close the tab after
 * approving, lose the connection, or hit the app's back button, and the
 * money moves but the order sits at `pending` forever. PayPal's webhook
 * is the server-to-server confirmation that does not depend on the
 * guest, so we capture + settle from it too.
 *
 * Trust model: PayPal ships no shared secret. Every delivery is verified
 * by asking PayPal (verify-webhook-signature) with the webhook id the
 * restaurant registered this endpoint under. The restaurant's credentials
 * live per tenant, and a webhook arrives with no tenant context, so — as
 * with Stripe's `metadata.tenantId` — we read our own `custom_id` stamp
 * ("<tenantId>:<orderId>") off the event, confirm inside that tenant's
 * RLS scope that the order exists and carries this PayPal order id as
 * `paymentRef`, and only then spend a provider call verifying the
 * signature with that tenant's keys. The stamp is untrusted input used
 * solely to pick whose keys to verify with; the tenant-scoped order match
 * plus the verified signature are what authorize settlement.
 *
 * Idempotency: the event id is claimed in `webhook_events` exactly like
 * Stripe's; capture itself is idempotent on PayPal's side as well, and
 * markOrderPaid only flips `pending → paid`, so a race with the return
 * leg converges on the same row state.
 */

export type PayPalWebhookOutcome =
  | { status: 200; kind: "processed" | "replayed" | "ignored" }
  | { status: 400; kind: "invalid" | "not_configured" | "invalid_signature" };

export interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource?: {
    id?: string;
    status?: string;
    custom_id?: string;
    purchase_units?: { reference_id?: string; custom_id?: string }[];
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
}

/** Event types that mean "money for this order is (or will be) captured". */
const SETTLING_EVENTS = new Set([
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.ORDER.COMPLETED",
  "PAYMENT.CAPTURE.COMPLETED",
]);

export function parsePayPalWebhookHeaders(
  get: (name: string) => string | null,
): PayPalWebhookHeaders | null {
  const transmissionId = get("paypal-transmission-id");
  const transmissionTime = get("paypal-transmission-time");
  const transmissionSig = get("paypal-transmission-sig");
  const certUrl = get("paypal-cert-url");
  const authAlgo = get("paypal-auth-algo");
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    return null;
  }
  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

/** The PayPal order id an event refers to, whatever its resource type. */
export function payPalOrderRefOf(event: PayPalWebhookEvent): string | null {
  const r = event.resource;
  if (!r) return null;
  if (event.event_type.startsWith("CHECKOUT.ORDER.")) return r.id ?? null;
  return r.supplementary_data?.related_ids?.order_id ?? null;
}

/** Our "<tenantId>:<orderId>" stamp — on the purchase unit for order
 *  events, on the capture itself for payment events. */
export function payPalCustomIdOf(event: PayPalWebhookEvent): string | null {
  const r = event.resource;
  if (!r) return null;
  return r.purchase_units?.[0]?.custom_id ?? r.custom_id ?? null;
}

export async function handlePayPalWebhook(input: {
  rawBody: string;
  headers: PayPalWebhookHeaders;
}): Promise<PayPalWebhookOutcome> {
  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(input.rawBody) as PayPalWebhookEvent;
  } catch {
    return { status: 400, kind: "invalid" };
  }
  if (!event || typeof event.id !== "string" || typeof event.event_type !== "string") {
    return { status: 400, kind: "invalid" };
  }

  // Which order — and therefore which restaurant's PayPal app — is this
  // about? The stamp names the tenant; the tenant-scoped lookup confirms
  // the order really is ours and really is this PayPal order.
  const ref = payPalOrderRefOf(event);
  const stamp = parsePayPalCustomId(payPalCustomIdOf(event));
  const order =
    ref && stamp
      ? await asTenant(stamp.tenantId, (tx) =>
          tx.order.findFirst({
            where: { id: stamp.orderId, paymentRef: ref, paymentProvider: "paypal" },
            select: { id: true, tenantId: true },
          }),
        )
      : null;
  if (!order) {
    // Same status as a bad signature: an unknown PayPal order id must not
    // be distinguishable from a forged one to whoever is probing.
    log.info("paypal.webhook.unknown_order", { eventId: event.id, type: event.event_type });
    return { status: 400, kind: "invalid" };
  }

  const keys = await getPayPalKeysForTenant(order.tenantId);
  const webhookId = keys.webhookId ?? env.PAYPAL_WEBHOOK_ID ?? null;
  if (!webhookId) return { status: 400, kind: "not_configured" };

  const provider = payPalProviderFor(keys);
  const verified = await provider.verifyWebhookSignature({
    rawBody: input.rawBody,
    headers: input.headers,
    webhookId,
  });
  if (!verified) {
    log.warn("paypal.webhook.invalid_signature", { eventId: event.id, orderId: order.id });
    return { status: 400, kind: "invalid_signature" };
  }

  // Claim the event id only AFTER verification — an attacker must not be
  // able to pre-empt a real delivery's id with a forged one.
  const claimed = await prisma.webhookEvent.createMany({
    data: [{ id: event.id, provider: "paypal" }],
    skipDuplicates: true,
  });
  if (claimed.count === 0) {
    log.info("paypal.webhook.replay", { eventId: event.id, type: event.event_type });
    return { status: 200, kind: "replayed" };
  }

  if (!SETTLING_EVENTS.has(event.event_type)) {
    log.info("paypal.webhook.ignored", { eventId: event.id, type: event.event_type });
    return { status: 200, kind: "ignored" };
  }

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    // PayPal already has the money; nothing to capture. Just settle.
    await markOrderPaid(order.tenantId, order.id);
  } else {
    // Approved but possibly never captured (guest never returned). The
    // capture is idempotent, so racing the return leg is harmless.
    const result = await finalizePayPalReturn(order.tenantId, order.id);
    if (!result.paid) {
      log.warn("paypal.webhook.capture_incomplete", { eventId: event.id, orderId: order.id });
    }
  }
  log.info("paypal.webhook.processed", {
    eventId: event.id,
    type: event.event_type,
    orderId: order.id,
  });
  return { status: 200, kind: "processed" };
}
