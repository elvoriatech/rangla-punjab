import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { recordOrderEventTx } from "./order-events";
import { createLogger } from "./logger";
import { AUTO_ACCEPT_WINDOW_MS } from "./payment-windows";

export { AUTO_ACCEPT_WINDOW_MS, CHECKOUT_EXPIRY_MS } from "./payment-windows";

const log = createLogger();

/**
 * Payment settlement — the ONE place an online order becomes paid (owner,
 * 2026-10-21, after order O-6: the guest paid an old card page after
 * switching to PayPal, the webhook failed, and a Stripe retry plus a manual
 * resend put the order on the board twice, a day late).
 *
 * The rule: money is only TAKEN after every check passes. Card payments are
 * authorized (reserved) by the guest and captured by us; PayPal payments
 * are approved by the guest and captured by us. Under a per-order lock, in
 * one transaction, a confirmed payment is checked against its PAYMENT
 * ATTEMPT (`payment_attempts`, amount and currency fixed when the attempt
 * started and immutable in the database):
 *
 *   - names the right order, for exactly the attempt's amount + currency;
 *   - the order still exists, is not cancelled, is still unpaid and online,
 *     and still costs what the attempt asked for;
 *   - it arrives within AUTO_ACCEPT_WINDOW_MS of the attempt starting.
 *
 * All pass → capture → the order is paid and goes to the kitchen.
 * Any fails → the reservation is RELEASED: nothing is charged, the attempt
 * is closed, the order (if it was waiting on this attempt) is marked
 * failed, and its history says why. No refund, no manual step.
 *
 * Only money that was already taken without us (a card page created before
 * this change, which charged at once) can still need a human; that is
 * recorded as `resolution = needed` in the attempt and the order history.
 */

export type DeclineReason =
  | "late"
  | "amount_mismatch"
  | "order_amount_changed"
  | "double_payment"
  | "order_cancelled"
  | "order_deleted"
  | "not_online"
  | "order_mismatch"
  | "attempt_closed"
  | "unknown_attempt";

/** Why a payment was not taken (or, if it was taken without us, why it
 *  needs a human). Plain words for the order history. */
export const DECLINE_TEXT: Record<DeclineReason, string> = {
  late: "confirmed after the 45-minute window",
  amount_mismatch: "the amount differs from what this payment asked for",
  order_amount_changed: "the order total changed after the guest started paying",
  double_payment: "the order was already paid with another payment",
  order_cancelled: "the order was cancelled",
  order_deleted: "the order was deleted",
  not_online: "the order is no longer set to online payment",
  order_mismatch: "the payment names a different order",
  attempt_closed: "this payment page had already been closed",
  unknown_attempt: "it matches no payment we started",
};

export interface PaymentConfirmation {
  tenantId: string;
  provider: "stripe" | "paypal";
  /** cs_… / pi_… (Stripe) or the PayPal order id. */
  ref: string;
  /** The order the provider's metadata names, when it names one. */
  orderId?: string | null;
  /**
   * "authorized": the money is reserved, not taken — `capture` takes it,
   *   `release` gives it back. This is every new payment.
   * "captured": the money was already taken without us (a pre-change card
   *   page, or a PayPal capture event for a capture we made).
   */
  stage: "authorized" | "captured";
  /** What is reserved / what was taken. Null = unknown → never accepted. */
  amountCents: number | null;
  currency: string | null;
  capture?: () => Promise<{ captured: boolean; amountCents: number; currency: string }>;
  release?: () => Promise<boolean>;
  source: "webhook" | "verify" | "reconcile" | "capture" | "switch" | "delete";
}

export type SettleOutcome =
  | { kind: "settled"; orderId: string }
  | { kind: "already_processed"; orderId: string; paid: boolean }
  /** Authorized money released — the guest was not charged. */
  | { kind: "declined"; orderId: string; reason: DeclineReason }
  /** The capture itself failed — nothing taken, attempt failed. */
  | { kind: "capture_failed"; orderId: string }
  /** Money already taken without us and the order cannot accept it. */
  | { kind: "needs_resolution"; orderId: string; reason: DeclineReason }
  | { kind: "unknown_attempt" };

/**
 * One transaction for one order's payments, serialized against every other
 * payment path for the same order by a transaction-level advisory lock —
 * so a Stripe capture and a PayPal capture can never both happen. Longer
 * timeout than `asTenant`'s default: a provider capture runs inside it.
 */
export function withOrderPaymentLock<T>(
  tenantId: string,
  orderId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pay:${orderId}`})::bigint)`;
      return fn(tx);
    },
    { timeout: 30_000, maxWait: 15_000 },
  );
}

/** Record a new attempt — inside the transaction that points the order at it. */
export async function createPaymentAttemptTx(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    venueId: string;
    orderId: string;
    orderLabel: string;
    provider: "stripe" | "paypal";
    ref: string;
    amountCents: number;
    currency: string;
  },
): Promise<void> {
  await tx.paymentAttempt.create({
    data: { ...input, currency: input.currency.toUpperCase() },
  });
}

/** The attempt for (provider, ref), or null. */
export function findAttempt(
  tenantId: string,
  provider: "stripe" | "paypal",
  ref: string,
): Promise<{ orderId: string; status: string; createdAt: Date } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return tx.paymentAttempt.findUnique({
      where: { provider_ref: { provider, ref } },
      select: { orderId: true, status: true, createdAt: true },
    });
  });
}

/**
 * The attempt can never take money any more (page expired, guest's card
 * declined, payment cancelled): close it, and if the order was waiting on
 * exactly this attempt, mark the order's payment failed (the guest is
 * offered try again / pay cash / cancel).
 */
export async function closeAttempt(
  tenantId: string,
  provider: "stripe" | "paypal",
  ref: string,
  status: "failed" | "expired" | "cancelled",
): Promise<boolean> {
  const attempt = await findAttempt(tenantId, provider, ref);
  if (!attempt) return false;
  return withOrderPaymentLock(tenantId, attempt.orderId, async (tx) => {
    const closed = await tx.paymentAttempt.updateMany({
      where: { provider, ref, status: "open" },
      data: { status },
    });
    if (closed.count === 0) return false;
    const failed = await tx.order.updateMany({
      where: { id: attempt.orderId, paymentRef: ref, paymentStatus: "pending" },
      data: { paymentStatus: "failed" },
    });
    if (failed.count > 0) {
      const where = await locateOrder(tx, attempt.orderId);
      if (where) {
        await recordOrderEventTx(tx, {
          tenantId,
          venueId: where.venueId,
          orderId: attempt.orderId,
          orderLabel: where.label,
          kind: "payment.failed",
          actor: provider,
          summary:
            status === "expired"
              ? "Payment page expired — nothing was charged"
              : "Payment failed or was abandoned — nothing was charged",
        });
      }
    }
    return true;
  });
}

interface Effects {
  settledOrderId?: string;
}

/**
 * The decision itself, inside a caller's `withOrderPaymentLock`
 * transaction. Returns the outcome plus the side effects to run AFTER the
 * transaction commits (the new-order mails and pushes).
 */
export async function settleConfirmedPaymentTx(
  tx: Prisma.TransactionClient,
  c: PaymentConfirmation,
): Promise<{ outcome: SettleOutcome; effects: Effects }> {
  const now = new Date();
  const attempt = await tx.paymentAttempt.findUnique({
    where: { provider_ref: { provider: c.provider, ref: c.ref } },
  });

  if (!attempt) {
    log.warn("payment.unknown_attempt", {
      provider: c.provider,
      ref: c.ref,
      orderId: c.orderId,
      stage: c.stage,
    });
    if (c.stage === "authorized") {
      await c.release?.();
      return { outcome: { kind: "unknown_attempt" }, effects: {} };
    }
    // Money taken under a ref we never issued: kept as its own attempt (at
    // the amount reported) when the order is known here, so it is caught.
    if (!c.orderId || c.amountCents === null || !c.currency) {
      return { outcome: { kind: "unknown_attempt" }, effects: {} };
    }
    const where = await locateOrder(tx, c.orderId);
    if (!where) return { outcome: { kind: "unknown_attempt" }, effects: {} };
    await tx.paymentAttempt.create({
      data: {
        tenantId: c.tenantId,
        venueId: where.venueId,
        orderId: c.orderId,
        orderLabel: where.label,
        provider: c.provider,
        ref: c.ref,
        amountCents: c.amountCents,
        currency: c.currency.toUpperCase(),
        status: "succeeded",
        succeededAt: now,
        resolution: "needed",
        resolutionReason: "unknown_attempt",
      },
    });
    await logNeedsResolution(tx, c, where.venueId, c.orderId, where.label, "unknown_attempt");
    return {
      outcome: { kind: "needs_resolution", orderId: c.orderId, reason: "unknown_attempt" },
      effects: {},
    };
  }

  // Idempotent: a retry, a manual resend, or the pay page and a webhook
  // racing each other all land here after the first one.
  if (attempt.status === "succeeded") {
    const order = await tx.order.findFirst({
      where: { id: attempt.orderId },
      select: { paymentStatus: true },
    });
    return {
      outcome: {
        kind: "already_processed",
        orderId: attempt.orderId,
        paid: attempt.settled && order?.paymentStatus === "paid",
      },
      effects: {},
    };
  }

  const reason = await checkAcceptable(tx, c, attempt, now);

  if (reason) {
    if (c.stage === "authorized") {
      // Not taken: release the reservation. If the provider will not let
      // go (it moved on meanwhile), throw — the caller's retry looks again.
      const released = c.release ? await c.release() : true;
      if (!released) throw new Error(`payment ${c.ref}: could not release the reservation`);
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: attempt.status === "open" ? "cancelled" : attempt.status },
      });
      // A cancelled order keeps its state; only an order still waiting on
      // exactly this attempt is told its payment did not go through.
      const failed = await tx.order.updateMany({
        where: {
          id: attempt.orderId,
          paymentRef: attempt.ref,
          paymentStatus: "pending",
          status: { not: "cancelled" },
        },
        data: { paymentStatus: "failed" },
      });
      await recordOrderEventTx(tx, {
        tenantId: c.tenantId,
        venueId: attempt.venueId,
        orderId: attempt.orderId,
        orderLabel: attempt.orderLabel,
        kind: "payment.not_captured",
        actor: c.provider,
        summary: `Not charged — ${DECLINE_TEXT[reason]}; the reserved amount was released${
          failed.count > 0 ? ". Payment marked failed" : ""
        } · ${c.ref}`,
        payload: { reason, ref: c.ref, amountCents: c.amountCents, source: c.source },
      });
      log.info("payment.declined", { orderId: attempt.orderId, ref: c.ref, reason });
      return {
        outcome: { kind: "declined", orderId: attempt.orderId, reason },
        effects: {},
      };
    }
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "succeeded",
        succeededAt: now,
        resolution: "needed",
        resolutionReason: reason,
      },
    });
    await logNeedsResolution(tx, c, attempt.venueId, attempt.orderId, attempt.orderLabel, reason);
    return {
      outcome: { kind: "needs_resolution", orderId: attempt.orderId, reason },
      effects: {},
    };
  }

  if (c.stage === "authorized") {
    const taken = c.capture ? await c.capture() : { captured: false, amountCents: 0, currency: "" };
    if (!taken.captured) {
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "failed" } });
      await tx.order.updateMany({
        where: { id: attempt.orderId, paymentRef: attempt.ref, paymentStatus: "pending" },
        data: { paymentStatus: "failed" },
      });
      await recordOrderEventTx(tx, {
        tenantId: c.tenantId,
        venueId: attempt.venueId,
        orderId: attempt.orderId,
        orderLabel: attempt.orderLabel,
        kind: "payment.failed",
        actor: c.provider,
        summary: `The payment could not be captured — nothing was charged · ${c.ref}`,
      });
      log.warn("payment.capture_failed", { orderId: attempt.orderId, ref: c.ref });
      return { outcome: { kind: "capture_failed", orderId: attempt.orderId }, effects: {} };
    }
    // The provider says it took something else than we asked: money moved,
    // so a human must look (cannot happen with an amount we set ourselves).
    if (
      taken.amountCents !== attempt.amountCents ||
      taken.currency.toUpperCase() !== attempt.currency.toUpperCase()
    ) {
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "succeeded",
          succeededAt: now,
          resolution: "needed",
          resolutionReason: "amount_mismatch",
        },
      });
      await logNeedsResolution(
        tx,
        { ...c, amountCents: taken.amountCents, currency: taken.currency },
        attempt.venueId,
        attempt.orderId,
        attempt.orderLabel,
        "amount_mismatch",
      );
      return {
        outcome: { kind: "needs_resolution", orderId: attempt.orderId, reason: "amount_mismatch" },
        effects: {},
      };
    }
  }

  await tx.paymentAttempt.update({
    where: { id: attempt.id },
    data: { status: "succeeded", succeededAt: now, settled: true },
  });
  const before = await tx.order.findFirst({
    where: { id: attempt.orderId },
    select: { paymentRef: true },
  });
  await tx.order.update({
    where: { id: attempt.orderId },
    // `paidAt` is when the order reaches the board: the accept window and
    // the promised time are counted from here (`order-eta.ts`). The order
    // now points at the attempt that paid it, so the board shows the right
    // rail and no other attempt can be captured on top of it.
    data: {
      paymentStatus: "paid",
      paidAt: now,
      paymentProvider: attempt.provider,
      paymentRef: attempt.ref,
    },
  });
  const superseded = before?.paymentRef !== attempt.ref;
  await recordOrderEventTx(tx, {
    tenantId: c.tenantId,
    venueId: attempt.venueId,
    orderId: attempt.orderId,
    orderLabel: attempt.orderLabel,
    kind: superseded ? "payment.superseded_paid" : "payment.paid",
    actor: c.provider,
    summary: superseded
      ? `Paid on an earlier ${c.provider === "stripe" ? "card page" : "PayPal page"} · ${c.ref}`
      : "Payment confirmed — order is paid",
    payload: { ref: c.ref, amountCents: attempt.amountCents, source: c.source },
  });
  log.info("payment.settled", { orderId: attempt.orderId, ref: c.ref, source: c.source });
  return {
    outcome: { kind: "settled", orderId: attempt.orderId },
    effects: { settledOrderId: attempt.orderId },
  };
}

/** Null when the payment may be taken and the order sent to the kitchen. */
async function checkAcceptable(
  tx: Prisma.TransactionClient,
  c: PaymentConfirmation,
  attempt: {
    orderId: string;
    amountCents: number;
    currency: string;
    status: string;
    createdAt: Date;
  },
  now: Date,
): Promise<DeclineReason | null> {
  if (c.orderId && c.orderId !== attempt.orderId) return "order_mismatch";
  if (
    c.amountCents === null ||
    !c.currency ||
    c.amountCents !== attempt.amountCents ||
    c.currency.toUpperCase() !== attempt.currency.toUpperCase()
  ) {
    return "amount_mismatch";
  }
  // Row lock on the order: a guest cancel or an owner edit running at the
  // same moment waits for this decision.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM orders WHERE id = ${attempt.orderId} FOR UPDATE`;
  if (rows.length === 0) return "order_deleted";
  const order = await tx.order.findFirst({
    where: { id: attempt.orderId },
    select: { status: true, paymentStatus: true, totalCents: true, currency: true },
  });
  if (!order) return "order_deleted";
  if (order.status === "cancelled") return "order_cancelled";
  if (order.paymentStatus === "paid") return "double_payment";
  if (order.paymentStatus !== "pending" && order.paymentStatus !== "failed") return "not_online";
  if (
    order.totalCents !== attempt.amountCents ||
    order.currency.toUpperCase() !== attempt.currency.toUpperCase()
  ) {
    return "order_amount_changed";
  }
  if (attempt.status !== "open") return "attempt_closed";
  if (now.getTime() - attempt.createdAt.getTime() > AUTO_ACCEPT_WINDOW_MS) return "late";
  return null;
}

/**
 * Settle a confirmed payment: find its attempt's order, take the order's
 * payment lock, decide (and capture or release), commit, then run the
 * side effects.
 */
export async function settleConfirmedPayment(c: PaymentConfirmation): Promise<SettleOutcome> {
  const attempt = await findAttempt(c.tenantId, c.provider, c.ref);
  const lockOrderId = attempt?.orderId ?? c.orderId ?? `${c.provider}:${c.ref}`;
  const { outcome, effects } = await withOrderPaymentLock(c.tenantId, lockOrderId, (tx) =>
    settleConfirmedPaymentTx(tx, c),
  );
  await runSettlementEffects(c.tenantId, effects);
  return outcome;
}

/** After commit: the new-order mails, pushes, points and payment method. */
export async function runSettlementEffects(tenantId: string, effects: Effects): Promise<void> {
  if (effects.settledOrderId) {
    const { runOrderPaidEffects } = await import("./connect-service");
    await runOrderPaidEffects(tenantId, effects.settledOrderId);
  }
}

async function locateOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<{ venueId: string; label: string } | null> {
  const order = await tx.order.findFirst({
    where: { id: orderId },
    select: { venueId: true, orderNumber: true, orderSeries: true },
  });
  if (order) {
    return {
      venueId: order.venueId,
      label: order.orderSeries
        ? `${order.orderSeries}-${order.orderNumber}`
        : String(order.orderNumber),
    };
  }
  // Deleted: the order log still knows where it lived.
  const logged = await tx.orderEvent.findFirst({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    select: { venueId: true, orderLabel: true },
  });
  return logged ? { venueId: logged.venueId, label: logged.orderLabel ?? "?" } : null;
}

async function logNeedsResolution(
  tx: Prisma.TransactionClient,
  c: PaymentConfirmation,
  venueId: string,
  orderId: string,
  orderLabel: string | null,
  reason: DeclineReason,
): Promise<void> {
  log.warn("payment.needs_resolution", { orderId, ref: c.ref, reason });
  await recordOrderEventTx(tx, {
    tenantId: c.tenantId,
    venueId,
    orderId,
    orderLabel,
    kind: "payment.needs_resolution",
    actor: c.provider,
    summary: `Money was taken but not accepted — ${DECLINE_TEXT[reason]}. Refund it in ${
      c.provider === "stripe" ? "Stripe" : "PayPal"
    } · ${c.ref}`,
    payload: {
      reason,
      ref: c.ref,
      amountCents: c.amountCents,
      currency: c.currency,
      source: c.source,
    },
  });
}
