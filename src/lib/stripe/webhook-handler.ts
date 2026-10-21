import { asTenant } from "../tenant";
import { logger } from "../logger";
import type { StripeEvent } from "./provider";
import { closeAttempt } from "../payment-settlement";
import { processWebhookOnce } from "../webhook-claims";
import { recordForOrder } from "../order-events";

/**
 * Webhook business logic. Kept out of the route handler so tests can call
 * it directly without an HTTP round-trip. The tenant is read from the
 * Stripe object's `metadata.tenantId`, which we set at checkout creation.
 *
 * Retry-safe and idempotent (owner, 2026-10-21): an event is claimed in
 * `webhook_events` as "processing" and marked "done" only once its work
 * committed. If the work throws, the claim is released and the route
 * answers 500, so Stripe's retry runs it again — a failed delivery is never
 * mistaken for a handled one (before, the claim was written first, and a
 * failure halfway lost the payment for good). A second delivery arriving
 * while the first is still running is answered 409, and Stripe retries it.
 *
 * Order payments are never settled from the event's own fields: the event
 * is a trigger, and `processStripeOrderPayment` asks Stripe for the payment
 * as it is now, then captures (or releases) under the order's lock.
 */

export type WebhookOutcome =
  | { status: 200; kind: "processed" | "replayed" | "ignored" }
  | { status: 400; kind: "invalid" }
  | { status: 409; kind: "busy" };

interface HasMetadata {
  metadata?: Record<string, string | null | undefined>;
}

/** Events that mean "money for this payment may be reserved or taken now". */
const PAYMENT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "payment_intent.amount_capturable_updated",
  "payment_intent.succeeded",
]);

export async function handleStripeEvent(event: StripeEvent): Promise<WebhookOutcome> {
  const result = await processWebhookOnce(event.id, "stripe", () => dispatch(event));
  if (result === "replayed") {
    logger.info("stripe.webhook.replay", { eventId: event.id, type: event.type });
    return { status: 200, kind: "replayed" };
  }
  if (result === "busy") return { status: 409, kind: "busy" };
  return result;
}

async function dispatch(event: StripeEvent): Promise<WebhookOutcome> {
  const object = event.data.object as HasMetadata;
  const meta = object.metadata;
  // The order log: Stripe's message exactly as it arrived (minus any
  // secret, see `redactPayload`), for the order it is about.
  if (meta?.orderId && meta?.tenantId) {
    await recordForOrder(meta.tenantId, meta.orderId, {
      kind: "stripe.webhook",
      actor: "stripe",
      summary: event.type,
      payload: event,
    });
  }

  if (PAYMENT_EVENTS.has(event.type)) {
    if (meta?.giftCardId) {
      await activatePaidGiftCard(event, object);
      return { status: 200, kind: "processed" };
    }
    await processOrderPayment(event, object);
    return { status: 200, kind: "processed" };
  }

  switch (event.type) {
    case "payment_intent.payment_failed":
      await failCurrentAttempt(event);
      return { status: 200, kind: "processed" };
    // Final: the page ran out, a delayed method failed, the intent was
    // cancelled — this attempt can never take money.
    case "checkout.session.expired":
      await closeOrderAttempt(event, "expired");
      return { status: 200, kind: "processed" };
    case "checkout.session.async_payment_failed":
      await closeOrderAttempt(event, "failed");
      return { status: 200, kind: "processed" };
    case "payment_intent.canceled":
      await closeOrderAttempt(event, "cancelled");
      return { status: 200, kind: "processed" };
    case "account.updated":
      await handleAccountUpdated(event);
      return { status: 200, kind: "processed" };
    default:
      logger.info("stripe.webhook.ignored", { eventId: event.id, type: event.type });
      return { status: 200, kind: "ignored" };
  }
}

/**
 * A declined card: `pending → failed`, so the guest is shown "Payment
 * failed" with try again / pay cash / cancel. NOT final — the guest may try
 * another card on the same page or sheet, and that success still settles
 * (the attempt stays open). Only the order's CURRENT attempt may fail it: a
 * decline on an older attempt must not flip a newer pending payment.
 */
async function failCurrentAttempt(event: StripeEvent): Promise<void> {
  const meta = (event.data.object as HasMetadata).metadata;
  logger.info("stripe.order.payment_failed", {
    eventId: event.id,
    orderId: meta?.orderId ?? null,
  });
  if (!meta?.orderId || !meta?.tenantId) return;
  const ref = refOf(event.data.object as HasMetadata);
  const orderId = meta.orderId;
  const current = await asTenant(meta.tenantId, (tx) =>
    tx.order.findFirst({ where: { id: orderId }, select: { paymentRef: true } }),
  );
  if (current && (ref === null || !current.paymentRef || current.paymentRef === ref)) {
    const { markOrderPaymentFailed } = await import("../connect-service");
    await markOrderPaymentFailed(meta.tenantId, orderId);
  }
}

async function closeOrderAttempt(
  event: StripeEvent,
  status: "failed" | "expired" | "cancelled",
): Promise<void> {
  const object = event.data.object as HasMetadata;
  const tenantId = object.metadata?.tenantId;
  const ref = refOf(object);
  if (!tenantId || !ref || object.metadata?.giftCardId) return;
  const closed = await closeAttempt(tenantId, "stripe", ref, status);
  logger.info("stripe.attempt.closed", { eventId: event.id, ref, status, closed });
}

/**
 * An ORDER payment was reserved or taken. Whatever the event says, ask
 * Stripe and act on that (capture or release, under the order's lock).
 */
async function processOrderPayment(event: StripeEvent, object: HasMetadata): Promise<void> {
  const orderId = object.metadata?.orderId;
  const tenantId = object.metadata?.tenantId;
  const ref = refOf(object);
  if (!orderId || !ref) return;
  if (!tenantId) {
    logger.warn("stripe.order.missing_tenant", { eventId: event.id, orderId });
    return;
  }
  const { processStripeOrderPayment } = await import("../connect-service");
  const outcome = await processStripeOrderPayment(tenantId, ref, { orderId, source: "webhook" });
  logger.info("stripe.order.payment", { eventId: event.id, orderId, outcome: outcome.kind });
}

/**
 * A GIFT CARD purchase is stamped with its own metadata key rather than an
 * orderId, so the two can never be confused: settling one as the other
 * would either print a kitchen ticket for food nobody ordered, or leave a
 * paid card unspendable. Taken at once (no manual capture); a Checkout
 * Session must say `payment_status: "paid"`.
 */
async function activatePaidGiftCard(event: StripeEvent, object: HasMetadata): Promise<void> {
  const giftCardId = object.metadata?.giftCardId;
  const giftTenantId = object.metadata?.tenantId;
  if (!giftCardId) return;
  if (!giftTenantId) {
    logger.warn("stripe.giftcard.missing_tenant", { eventId: event.id, giftCardId });
    return;
  }
  const paymentStatus = (object as { payment_status?: string }).payment_status;
  if (event.type.startsWith("checkout.session.") && paymentStatus !== "paid") return;
  if (event.type === "payment_intent.amount_capturable_updated") return;
  const { activateGiftCard } = await import("../gift-card-service");
  const activated = await activateGiftCard(giftTenantId, giftCardId, {
    provider: "stripe",
    ref: refOf(object),
  });
  logger.info("stripe.giftcard.paid", { eventId: event.id, giftCardId, activated });
}

/** The provider's own id for the settled object, recorded on the card as
 *  its `payment_ref`. Absent on shapes that do not carry one. */
function refOf(object: HasMetadata): string | null {
  const id = (object as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

async function handleAccountUpdated(event: StripeEvent): Promise<void> {
  const account = event.data.object as HasMetadata & { id?: string; charges_enabled?: boolean };
  const tenantId = account.metadata?.tenantId;
  if (!tenantId || !account.id) {
    logger.info("stripe.account.ignored", { eventId: event.id, hasTenant: Boolean(tenantId) });
    return;
  }
  await asTenant(tenantId, (tx) =>
    tx.tenant.updateMany({
      where: { id: tenantId, stripeAccountId: account.id },
      data: { stripeChargesEnabled: Boolean(account.charges_enabled) },
    }),
  );
  logger.info("stripe.account.updated", {
    eventId: event.id,
    chargesEnabled: Boolean(account.charges_enabled),
  });
}
