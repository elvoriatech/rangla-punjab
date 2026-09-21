import { prisma } from "./db";
import { asTenant } from "./tenant";
import { createLogger } from "./logger";
import type { PayPalWebhookHeaders } from "./paypal";
import { parsePayPalCustomId, payPalProviderFor } from "./paypal";
import { env } from "./env";
import { finalizePayPalReturn } from "./paypal-service";
import { getPayPalKeysForTenant } from "./tenant-payment-keys";
import { markOrderPaid } from "./connect-service";
import { finalizeGiftCardPayPalReturn, giftCardIdFromPayPalRef } from "./gift-card-payment";

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

  // WHAT was paid for — and therefore which restaurant's PayPal app is
  // this about? The stamp names the tenant; the tenant-scoped lookup
  // confirms the row really is ours and really is this PayPal order.
  //
  // Two kinds of subject share this endpoint: an ORDER and a GIFT CARD
  // purchase. They are told apart by the `gc_` prefix the gift-card
  // flow stamps into its custom id, so neither can ever be settled down
  // the other's path.
  const ref = payPalOrderRefOf(event);
  const stamp = parsePayPalCustomId(payPalCustomIdOf(event));
  const giftCardId = stamp ? giftCardIdFromPayPalRef(stamp.orderId) : null;
  const subject =
    !ref || !stamp
      ? null
      : giftCardId
        ? await asTenant(stamp.tenantId, async (tx) => {
            const card = await tx.giftCard.findFirst({
              where: { id: giftCardId, paymentRef: ref, paymentProvider: "paypal" },
              select: { id: true, tenantId: true },
            });
            return card
              ? { kind: "gift_card" as const, id: card.id, tenantId: card.tenantId }
              : null;
          })
        : await asTenant(stamp.tenantId, async (tx) => {
            const order = await tx.order.findFirst({
              where: { id: stamp.orderId, paymentRef: ref, paymentProvider: "paypal" },
              select: { id: true, tenantId: true },
            });
            return order
              ? { kind: "order" as const, id: order.id, tenantId: order.tenantId }
              : null;
          });
  if (!subject) {
    // Same status as a bad signature: an unknown PayPal order id must not
    // be distinguishable from a forged one to whoever is probing.
    log.info("paypal.webhook.unknown_order", { eventId: event.id, type: event.event_type });
    return { status: 400, kind: "invalid" };
  }

  const keys = await getPayPalKeysForTenant(subject.tenantId);
  const webhookId = keys.webhookId ?? env.PAYPAL_WEBHOOK_ID ?? null;
  if (!webhookId) return { status: 400, kind: "not_configured" };

  const provider = payPalProviderFor(keys);
  const verified = await provider.verifyWebhookSignature({
    rawBody: input.rawBody,
    headers: input.headers,
    webhookId,
  });
  if (!verified) {
    log.warn("paypal.webhook.invalid_signature", { eventId: event.id, subjectId: subject.id });
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

  // PayPal refused the money: the order is marked `failed` (guest sees
  // retry / pay cash / cancel). Gift cards need nothing — an unpaid card
  // is never shown or counted.
  if (
    subject.kind === "order" &&
    (event.event_type === "PAYMENT.CAPTURE.DENIED" ||
      event.event_type === "PAYMENT.CAPTURE.DECLINED")
  ) {
    const { markOrderPaymentFailed } = await import("./connect-service");
    await markOrderPaymentFailed(subject.tenantId, subject.id);
    return { status: 200, kind: "processed" };
  }

  if (!SETTLING_EVENTS.has(event.event_type)) {
    log.info("paypal.webhook.ignored", { eventId: event.id, type: event.event_type });
    return { status: 200, kind: "ignored" };
  }

  if (subject.kind === "gift_card") {
    // One path for both event types: PayPal's capture is idempotent, so
    // "already captured" (CAPTURE.COMPLETED) and "approved, maybe never
    // captured" (ORDER.APPROVED) converge on the same call, and
    // `activateGiftCard` behind it only ever flips pending → active.
    const result = await finalizeGiftCardPayPalReturn(subject.tenantId, subject.id);
    if (!result.paid) {
      log.warn("paypal.webhook.capture_incomplete", { eventId: event.id, giftCardId: subject.id });
    }
  } else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    // PayPal already has the money; nothing to capture. Just settle.
    await markOrderPaid(subject.tenantId, subject.id);
  } else {
    // Approved but possibly never captured (guest never returned). The
    // capture is idempotent, so racing the return leg is harmless.
    const result = await finalizePayPalReturn(subject.tenantId, subject.id);
    if (!result.paid) {
      log.warn("paypal.webhook.capture_incomplete", { eventId: event.id, orderId: subject.id });
    }
  }
  log.info("paypal.webhook.processed", {
    eventId: event.id,
    type: event.event_type,
    kind: subject.kind,
    subjectId: subject.id,
  });
  return { status: 200, kind: "processed" };
}
