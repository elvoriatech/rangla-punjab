import { prisma } from "../db";
import { asTenant } from "../tenant";
import { logger } from "../logger";
import type { StripeEvent } from "./provider";
import { settleStripeOrderPayment } from "../connect-service";
import { recordForOrder } from "../order-events";

/**
 * Webhook business logic. Kept out of the route handler so tests can call
 * it directly without an HTTP round-trip. All DB writes happen through
 * `asTenant(tenantId, …)` — the tenant is read from the Stripe object's
 * `metadata.tenantId`, which we set at checkout creation (P1-19e).
 *
 * Idempotency: every event id we process is inserted into the
 * `webhook_events` table with `ON CONFLICT DO NOTHING`. The insert
 * either claims the event (1 row) or tells us another delivery already
 * did (0 rows), atomically, so two simultaneous Stripe retries cannot
 * both proceed. Downstream writes are `upsert` shaped anyway, so a
 * double-processing would still converge on the same row state.
 *
 * This used to be a Redis SET with a 7-day TTL. It moved to Postgres so
 * that settling a payment does not depend on Redis being reachable: with
 * the old guard, a Redis outage made every webhook fail, and the order
 * stayed `pending` until Stripe's retries happened to find Redis back.
 * Rows are pruned by the daily maintenance tick.
 */

export type WebhookOutcome =
  { status: 200; kind: "processed" | "replayed" | "ignored" } | { status: 400; kind: "invalid" };

interface HasMetadata {
  metadata?: Record<string, string | null | undefined>;
}

interface CheckoutSessionShape extends HasMetadata {
  customer?: string | null;
  subscription?: string | null;
  client_reference_id?: string | null;
}

export async function handleStripeEvent(event: StripeEvent): Promise<WebhookOutcome> {
  // Claim the event. `skipDuplicates` compiles to ON CONFLICT DO
  // NOTHING, so the count tells us whether we won: 1 = ours to process,
  // 0 = an earlier (or concurrent) delivery already has it. A replay
  // short-circuits with 200, which is how Stripe learns to stop
  // retrying.
  const claimed = await prisma.webhookEvent.createMany({
    data: [{ id: event.id, provider: "stripe" }],
    skipDuplicates: true,
  });
  if (claimed.count === 0) {
    logger.info("stripe.webhook.replay", { eventId: event.id, type: event.type });
    return { status: 200, kind: "replayed" };
  }

  // The order log: Stripe's message exactly as it arrived (minus any
  // secret, see `redactPayload`), for the order it is about.
  const meta = (event.data.object as HasMetadata).metadata;
  if (meta?.orderId && meta?.tenantId) {
    await recordForOrder(meta.tenantId, meta.orderId, {
      kind: "stripe.webhook",
      actor: "stripe",
      summary: event.type,
      payload: event,
    });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      // "Completed" means the guest finished the checkout page, not that the
      // money arrived: with a delayed method (SEPA debit, bank transfer …)
      // the session completes UNPAID and may still fail. Settle only when
      // Stripe says paid; the delayed outcome comes as async_payment_*.
      const paymentStatus = (event.data.object as { payment_status?: string }).payment_status;
      if (paymentStatus !== undefined && paymentStatus !== "paid") {
        logger.info("stripe.checkout.unpaid", { eventId: event.id, paymentStatus });
        return { status: 200, kind: "processed" };
      }
      await handleCheckoutCompleted(event);
      return { status: 200, kind: "processed" };
    }
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutCompleted(event);
      return { status: 200, kind: "processed" };
    case "checkout.session.async_payment_failed":
      await failCurrentAttempt(event);
      return { status: 200, kind: "processed" };
    case "payment_intent.succeeded":
      // Native app payment sheet (P-app): the guest confirmed a bare
      // PaymentIntent, so there is no checkout session — but the
      // orderId/tenantId metadata is identical, so settlement is too.
      await handleOrderSettlement(event, event.data.object as HasMetadata);
      return { status: 200, kind: "processed" };
    case "payment_intent.payment_failed":
      await failCurrentAttempt(event);
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
 * `pending → failed`: the guest is shown "Payment failed" with try again /
 * pay cash / cancel, and the order stays off the kitchen. A later retry
 * that succeeds still settles it (markOrderPaid takes `failed` too). Used
 * for a declined card (payment_intent.payment_failed) and a delayed method
 * that failed after checkout (checkout.session.async_payment_failed).
 */
async function failCurrentAttempt(event: StripeEvent): Promise<void> {
  const meta = (event.data.object as HasMetadata).metadata;
  logger.info("stripe.order.payment_failed", {
    eventId: event.id,
    orderId: meta?.orderId ?? null,
  });
  if (!meta?.orderId || !meta?.tenantId) return;
  // Only the order's CURRENT attempt may fail it: a decline on an older
  // card attempt must not flip a newer pending payment.
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

async function handleCheckoutCompleted(event: StripeEvent): Promise<void> {
  // Guest ORDER payment (mode=payment, created on the restaurant's
  // connected account — arrives via the Connect webhook). Routed by the
  // orderId metadata stamped in createOrderCheckout.
  await handleOrderSettlement(event, event.data.object as CheckoutSessionShape);
}

/**
 * Settle whatever object carries our `orderId`/`tenantId` metadata — a
 * checkout session (web) or a PaymentIntent (native app sheet). Both are
 * stamped identically at creation, so one settlement path serves both.
 * Idempotent, so Stripe retries converge; an object without our metadata
 * belongs to someone else's flow and is logged, not thrown on.
 */
async function handleOrderSettlement(event: StripeEvent, object: HasMetadata): Promise<void> {
  // A GIFT CARD purchase is stamped with its own metadata key rather
  // than an orderId, so the two can never be confused: settling one as
  // the other would either print a kitchen ticket for food nobody
  // ordered, or leave a paid card unspendable.
  const giftCardId = object.metadata?.giftCardId;
  if (giftCardId) {
    const giftTenantId = object.metadata?.tenantId;
    if (!giftTenantId) {
      logger.warn("stripe.giftcard.missing_tenant", { eventId: event.id, giftCardId });
      return;
    }
    const { activateGiftCard } = await import("../gift-card-service");
    const activated = await activateGiftCard(giftTenantId, giftCardId, {
      provider: "stripe",
      ref: refOf(object),
    });
    logger.info("stripe.giftcard.paid", { eventId: event.id, giftCardId, activated });
    return;
  }

  const orderId = object.metadata?.orderId;
  if (!orderId) return;
  const orderTenantId = object.metadata?.tenantId;
  if (!orderTenantId) {
    logger.warn("stripe.order.missing_tenant", { eventId: event.id, orderId });
    return;
  }
  // Checked against the order's current payment: an old card tab paid
  // after a switch, a second payment, or money for a cancelled / deleted
  // order are each handled safely (see settleStripeOrderPayment).
  const outcome = await settleStripeOrderPayment(orderTenantId, orderId, refOf(object));
  logger.info("stripe.order.paid", { eventId: event.id, orderId, outcome });
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
