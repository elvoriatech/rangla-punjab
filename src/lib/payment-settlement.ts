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
 * are approved by the guest and captured by us. Each payment is checked
 * against its PAYMENT ATTEMPT (`payment_attempts`: amount and currency
 * fixed when the attempt started, immutable in the database):
 *
 *   - names the right order, for exactly the attempt's amount + currency;
 *   - the order still exists, is not cancelled, is still unpaid and online,
 *     still costs what the attempt asked for, and no other attempt of it
 *     is being captured or has paid it;
 *   - the guest AUTHORIZED within AUTO_ACCEPT_WINDOW_MS of the attempt
 *     starting. When our server gets round to it does not matter: a
 *     payment authorized in time is captured even after downtime (within
 *     the provider's authorization life — Stripe: 7 days).
 *
 * Durable in three steps, so a crash can never lose money that moved:
 *
 *   1. decide, under the order's lock; if the payment may be taken, mark
 *      the attempt "capturing" and COMMIT;
 *   2. capture at the provider (no database transaction open — never hold
 *      a lock across a network call);
 *   3. record the result, under the lock, and settle the order.
 *
 * A crash between 1 and 3 leaves the attempt "capturing"; the reconciler
 * (payment-reconcile.ts) asks the provider and finishes it. A payment that
 * fails a check is RELEASED: nothing is charged, the attempt is closed, the
 * order (if it was waiting on this attempt) is marked failed. Only money
 * that was taken without us (a card page from before authorize-only, or a
 * capture whose order changed meanwhile) needs a human; that is recorded
 * as `resolution = needed` in the attempt and the order history.
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
  | "superseded"
  | "unknown_attempt";

/** Why a payment was not taken (or, if taken without us, why it needs a
 *  human). Plain words for the order history. */
export const DECLINE_TEXT: Record<DeclineReason, string> = {
  late: "the guest authorized it more than 45 minutes after the payment started",
  amount_mismatch: "the amount differs from what this payment asked for",
  order_amount_changed: "the order total changed after the guest started paying",
  double_payment: "the order was already paid (or being paid) with another payment",
  order_cancelled: "the order was cancelled",
  order_deleted: "the order was deleted",
  not_online: "the order is no longer set to online payment",
  order_mismatch: "the payment names a different order",
  attempt_closed: "this payment page had already been closed",
  superseded: "the guest had moved on to another payment for this order",
  unknown_attempt: "it matches no payment we started",
};

export interface CaptureTaken {
  captured: boolean;
  amountCents: number;
  currency: string;
}

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
   * "captured": the money was already taken (a pre-change card page, a
   *   capture we made but could not record, a PayPal capture event).
   */
  stage: "authorized" | "captured";
  /** What is reserved / what was taken. Null = unknown → never accepted. */
  amountCents: number | null;
  currency: string | null;
  /** When the guest authorized, as the PROVIDER reports it. */
  authorizedAt: Date | null;
  capture?: () => Promise<CaptureTaken>;
  release?: () => Promise<boolean>;
  source: "webhook" | "verify" | "reconcile" | "capture" | "switch" | "delete";
}

export type SettleOutcome =
  | { kind: "settled"; orderId: string }
  | { kind: "already_processed"; orderId: string; paid: boolean }
  /** Another path is capturing this attempt right now (or crashed while
   *  doing so — the reconciler finishes it). */
  | { kind: "capturing"; orderId: string }
  /** Authorized money released — the guest was not charged. */
  | { kind: "declined"; orderId: string; reason: DeclineReason }
  /** The capture itself failed — nothing taken, attempt failed. */
  | { kind: "capture_failed"; orderId: string }
  /** Money taken and the order cannot accept it — recorded for a refund. */
  | { kind: "needs_resolution"; orderId: string; reason: DeclineReason }
  | { kind: "unknown_attempt" };

/**
 * One short transaction for one order's payments, serialized against every
 * other payment path for the same order by a transaction-level advisory
 * lock. No provider call ever runs inside it.
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
    { timeout: 15_000, maxWait: 15_000 },
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

export interface AttemptSummary {
  id: string;
  orderId: string;
  status: string;
  amountCents: number;
  currency: string;
  createdAt: Date;
  captureStartedAt: Date | null;
}

/** The attempt for (provider, ref), or null. */
export function findAttempt(
  tenantId: string,
  provider: "stripe" | "paypal",
  ref: string,
): Promise<AttemptSummary | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return tx.paymentAttempt.findUnique({
      where: { provider_ref: { provider, ref } },
      select: {
        id: true,
        orderId: true,
        status: true,
        amountCents: true,
        currency: true,
        createdAt: true,
        captureStartedAt: true,
      },
    });
  });
}

/**
 * The attempt can never take money any more (page expired, a delayed
 * method failed, payment cancelled): close it, and if the order was waiting
 * on exactly this attempt, mark the order's payment failed (the guest is
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
    const failed = await failOrderIfWaitingTx(tx, attempt.orderId, ref);
    if (failed) {
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

type Plan =
  | { kind: "done"; outcome: SettleOutcome; settledOrderId?: string }
  | { kind: "release"; attemptId: string | null; orderId: string | null; reason: DeclineReason }
  | { kind: "capture"; attemptId: string; orderId: string };

/**
 * Settle a confirmed payment: decide (and mark "capturing") under the
 * order's lock, capture or release at the provider, then record — see the
 * module comment for why it is three steps.
 */
export async function settleConfirmedPayment(c: PaymentConfirmation): Promise<SettleOutcome> {
  const known = await findAttempt(c.tenantId, c.provider, c.ref);
  const lockId = known?.orderId ?? c.orderId ?? `${c.provider}:${c.ref}`;
  const plan = await withOrderPaymentLock(c.tenantId, lockId, (tx) => planTx(tx, c));

  if (plan.kind === "done") {
    if (plan.settledOrderId) await runSettlementEffects(c.tenantId, plan.settledOrderId);
    return plan.outcome;
  }

  if (plan.kind === "release") {
    // Not taken. If the provider will not let go (it moved on meanwhile),
    // throw — the webhook retry / the reconciler looks again.
    const released = c.release ? await c.release() : true;
    if (!released) throw new Error(`payment ${c.ref}: could not release the reservation`);
    if (!plan.attemptId || !plan.orderId) return { kind: "unknown_attempt" };
    const { attemptId, orderId, reason } = plan;
    await withOrderPaymentLock(c.tenantId, orderId, (tx) =>
      recordReleaseTx(tx, c, attemptId, reason),
    );
    return { kind: "declined", orderId, reason };
  }

  // plan.kind === "capture": the attempt is committed as "capturing".
  const failedCapture: CaptureTaken = { captured: false, amountCents: 0, currency: "" };
  const taken = c.capture ? await c.capture().catch(() => failedCapture) : failedCapture;
  return finishCapture(c, plan.attemptId, plan.orderId, taken);
}

/**
 * Step 3: record what the provider did with a capture. Also used by the
 * reconciler to finish an attempt left "capturing" by a crash, with what
 * the provider now reports.
 */
export async function finishCapture(
  c: Pick<PaymentConfirmation, "tenantId" | "provider" | "ref" | "source">,
  attemptId: string,
  orderId: string,
  taken: CaptureTaken,
): Promise<SettleOutcome> {
  const result = await withOrderPaymentLock(c.tenantId, orderId, (tx) =>
    finishCaptureTx(tx, c, attemptId, taken),
  );
  if (result.settledOrderId) await runSettlementEffects(c.tenantId, result.settledOrderId);
  return result.outcome;
}

async function planTx(tx: Prisma.TransactionClient, c: PaymentConfirmation): Promise<Plan> {
  const now = new Date();
  let attempt = await tx.paymentAttempt.findUnique({
    where: { provider_ref: { provider: c.provider, ref: c.ref } },
  });

  // A payment started by the PREVIOUS app version (during a deploy) has no
  // attempt row. If the order itself names this exact payment, it is ours:
  // adopt it, at the amount the order carries, timed from when the order
  // was pointed at it.
  if (!attempt && c.orderId) {
    const order = await tx.order.findFirst({
      where: { id: c.orderId, paymentRef: c.ref, paymentProvider: c.provider },
      select: {
        venueId: true,
        orderNumber: true,
        orderSeries: true,
        totalCents: true,
        currency: true,
        updatedAt: true,
      },
    });
    if (order) {
      attempt = await tx.paymentAttempt.create({
        data: {
          tenantId: c.tenantId,
          venueId: order.venueId,
          orderId: c.orderId,
          orderLabel: order.orderSeries
            ? `${order.orderSeries}-${order.orderNumber}`
            : String(order.orderNumber),
          provider: c.provider,
          ref: c.ref,
          amountCents: order.totalCents,
          currency: order.currency.toUpperCase(),
          createdAt: order.updatedAt,
        },
      });
      log.info("payment.attempt_adopted", { orderId: c.orderId, ref: c.ref });
    }
  }

  if (!attempt) {
    log.warn("payment.unknown_attempt", { provider: c.provider, ref: c.ref, stage: c.stage });
    if (c.stage === "authorized") {
      return { kind: "release", attemptId: null, orderId: null, reason: "unknown_attempt" };
    }
    // Money taken under a ref we never issued: kept as its own attempt (at
    // the amount reported) when the order is known here, so it is caught.
    if (!c.orderId || c.amountCents === null || !c.currency) {
      return { kind: "done", outcome: { kind: "unknown_attempt" } };
    }
    const where = await locateOrder(tx, c.orderId);
    if (!where) return { kind: "done", outcome: { kind: "unknown_attempt" } };
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
        authorizedAt: c.authorizedAt,
        resolution: "needed",
        resolutionReason: "unknown_attempt",
      },
    });
    await logNeedsResolution(tx, c, where.venueId, c.orderId, where.label, "unknown_attempt");
    return {
      kind: "done",
      outcome: { kind: "needs_resolution", orderId: c.orderId, reason: "unknown_attempt" },
    };
  }

  // Idempotent: a retry, a manual resend, the pay page and a webhook racing
  // each other all land here after the first one.
  if (attempt.status === "succeeded") {
    const order = await tx.order.findFirst({
      where: { id: attempt.orderId },
      select: { paymentStatus: true },
    });
    return {
      kind: "done",
      outcome: {
        kind: "already_processed",
        orderId: attempt.orderId,
        paid: attempt.settled && order?.paymentStatus === "paid",
      },
    };
  }
  if (attempt.status === "capturing") {
    return { kind: "done", outcome: { kind: "capturing", orderId: attempt.orderId } };
  }

  if (c.authorizedAt && !attempt.authorizedAt) {
    attempt = await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: { authorizedAt: c.authorizedAt },
    });
  }

  const reason = await checkAcceptable(tx, c, attempt);
  if (reason) {
    if (c.stage === "authorized") {
      return { kind: "release", attemptId: attempt.id, orderId: attempt.orderId, reason };
    }
    await markNeedsResolutionTx(tx, c, attempt, reason, now);
    return {
      kind: "done",
      outcome: { kind: "needs_resolution", orderId: attempt.orderId, reason },
    };
  }

  if (c.stage === "authorized") {
    // Step 1 ends here: committed as "capturing" before the provider call.
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "capturing", captureStartedAt: now },
    });
    return { kind: "capture", attemptId: attempt.id, orderId: attempt.orderId };
  }

  await settleTx(tx, c, attempt, now);
  return {
    kind: "done",
    outcome: { kind: "settled", orderId: attempt.orderId },
    settledOrderId: attempt.orderId,
  };
}

async function finishCaptureTx(
  tx: Prisma.TransactionClient,
  c: Pick<PaymentConfirmation, "tenantId" | "provider" | "ref" | "source">,
  attemptId: string,
  taken: CaptureTaken,
): Promise<{ outcome: SettleOutcome; settledOrderId?: string }> {
  const now = new Date();
  const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) return { outcome: { kind: "unknown_attempt" } };
  if (attempt.status === "succeeded") {
    return {
      outcome: { kind: "already_processed", orderId: attempt.orderId, paid: attempt.settled },
    };
  }
  if (attempt.status !== "capturing") {
    log.warn("payment.finish_unexpected_status", { attemptId, status: attempt.status });
  }
  const full = { ...c, amountCents: taken.amountCents, currency: taken.currency };

  if (!taken.captured) {
    await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "failed" } });
    await failOrderIfWaitingTx(tx, attempt.orderId, attempt.ref);
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
    return { outcome: { kind: "capture_failed", orderId: attempt.orderId } };
  }

  // Money moved. It is only put to the order if the provider took exactly
  // what we asked for and the order still wants it (it may have been
  // cancelled while the capture ran); otherwise it is recorded for refund.
  const reason =
    taken.amountCents !== attempt.amountCents ||
    taken.currency.toUpperCase() !== attempt.currency.toUpperCase()
      ? ("amount_mismatch" as const)
      : await orderStillAccepts(tx, attempt);
  if (reason) {
    await markNeedsResolutionTx(tx, full, attempt, reason, now);
    return { outcome: { kind: "needs_resolution", orderId: attempt.orderId, reason } };
  }
  await settleTx(tx, full, attempt, now);
  return {
    outcome: { kind: "settled", orderId: attempt.orderId },
    settledOrderId: attempt.orderId,
  };
}

interface AttemptRow {
  id: string;
  tenantId: string;
  venueId: string;
  orderId: string;
  orderLabel: string | null;
  provider: string;
  ref: string;
  amountCents: number;
  currency: string;
  status: string;
  authorizedAt: Date | null;
  createdAt: Date;
}

/** Null when the payment may be taken and the order sent to the kitchen. */
async function checkAcceptable(
  tx: Prisma.TransactionClient,
  c: PaymentConfirmation,
  attempt: AttemptRow,
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
  const orderReason = await orderStillAccepts(tx, attempt);
  if (orderReason) return orderReason;
  if (attempt.status !== "open") return "attempt_closed";
  // Money not yet taken is only taken for the order's CURRENT payment: a
  // reservation or approval the guest left behind by switching method is
  // released, never captured behind their back.
  if (c.stage === "authorized") {
    const current = await tx.order.findFirst({
      where: { id: attempt.orderId },
      select: { paymentRef: true },
    });
    if (current?.paymentRef !== attempt.ref) return "superseded";
  }
  // Judged on when the guest AUTHORIZED, never on when we processed it: a
  // payment made in time is not discarded because our server was down.
  // Without a provider timestamp the attempt's own start is the floor.
  const authorizedAt = c.authorizedAt ?? attempt.authorizedAt ?? attempt.createdAt;
  if (authorizedAt.getTime() - attempt.createdAt.getTime() > AUTO_ACCEPT_WINDOW_MS) return "late";
  return null;
}

/** Can the order take THIS attempt's money now? (Row-locks the order.) */
async function orderStillAccepts(
  tx: Prisma.TransactionClient,
  attempt: Pick<AttemptRow, "id" | "orderId" | "amountCents" | "currency">,
): Promise<DeclineReason | null> {
  // Row lock: a guest cancel or an owner edit running at the same moment
  // waits for this decision.
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
  // Another attempt of this order being captured or already settled:
  // never take a second payment (Stripe and PayPal at once).
  const rival = await tx.paymentAttempt.findFirst({
    where: {
      orderId: attempt.orderId,
      id: { not: attempt.id },
      OR: [{ status: "capturing" }, { settled: true }],
    },
    select: { id: true },
  });
  if (rival) return "double_payment";
  return null;
}

async function settleTx(
  tx: Prisma.TransactionClient,
  c: Pick<PaymentConfirmation, "tenantId" | "provider" | "ref" | "source">,
  attempt: AttemptRow,
  now: Date,
): Promise<void> {
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
  const authorizedAt = attempt.authorizedAt;
  const delayMin = authorizedAt ? Math.round((now.getTime() - authorizedAt.getTime()) / 60_000) : 0;
  const delayNote =
    delayMin > 10
      ? ` (the guest paid ${String(delayMin)} min earlier; it was confirmed late — check with the guest)`
      : "";
  await recordOrderEventTx(tx, {
    tenantId: c.tenantId,
    venueId: attempt.venueId,
    orderId: attempt.orderId,
    orderLabel: attempt.orderLabel,
    kind: superseded ? "payment.superseded_paid" : "payment.paid",
    actor: c.provider,
    summary:
      (superseded
        ? `Paid on an earlier ${c.provider === "stripe" ? "card page" : "PayPal page"} · ${c.ref}`
        : "Payment confirmed — order is paid") + delayNote,
    payload: {
      ref: c.ref,
      amountCents: attempt.amountCents,
      source: c.source,
      authorizedAt: authorizedAt?.toISOString() ?? null,
    },
  });
  log.info("payment.settled", { orderId: attempt.orderId, ref: c.ref, source: c.source });
}

async function recordReleaseTx(
  tx: Prisma.TransactionClient,
  c: PaymentConfirmation,
  attemptId: string,
  reason: DeclineReason,
): Promise<void> {
  const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) return;
  await tx.paymentAttempt.updateMany({
    where: { id: attempt.id, status: "open" },
    data: { status: "cancelled" },
  });
  const failed = await failOrderIfWaitingTx(tx, attempt.orderId, attempt.ref);
  await recordOrderEventTx(tx, {
    tenantId: c.tenantId,
    venueId: attempt.venueId,
    orderId: attempt.orderId,
    orderLabel: attempt.orderLabel,
    kind: "payment.not_captured",
    actor: c.provider,
    summary: `Not charged — ${DECLINE_TEXT[reason]}; the reserved amount was released${
      failed ? ". Payment marked failed" : ""
    } · ${c.ref}`,
    payload: { reason, ref: c.ref, amountCents: c.amountCents, source: c.source },
  });
  log.info("payment.declined", { orderId: attempt.orderId, ref: c.ref, reason });
}

/** A cancelled order keeps its state; only an order still waiting on
 *  exactly this attempt is told its payment did not go through. */
async function failOrderIfWaitingTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  ref: string,
): Promise<boolean> {
  const failed = await tx.order.updateMany({
    where: { id: orderId, paymentRef: ref, paymentStatus: "pending", status: { not: "cancelled" } },
    data: { paymentStatus: "failed" },
  });
  return failed.count > 0;
}

async function markNeedsResolutionTx(
  tx: Prisma.TransactionClient,
  c: Pick<
    PaymentConfirmation,
    "tenantId" | "provider" | "ref" | "source" | "amountCents" | "currency"
  >,
  attempt: AttemptRow,
  reason: DeclineReason,
  now: Date,
): Promise<void> {
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
}

/** After commit: the new-order mails, pushes, points and payment method. */
export async function runSettlementEffects(tenantId: string, orderId: string): Promise<void> {
  const { runOrderPaidEffects } = await import("./connect-service");
  await runOrderPaidEffects(tenantId, orderId);
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
  c: Pick<
    PaymentConfirmation,
    "tenantId" | "provider" | "ref" | "source" | "amountCents" | "currency"
  >,
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
