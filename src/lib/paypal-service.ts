import { recordForOrder } from "./order-events";
import { asTenant } from "./tenant";
import { verifyReceiptToken } from "./receipt-token";
import { siteUrl } from "./site-url";
import { payPalOnFor, payPalProviderFor } from "./paypal";
import { getPayPalKeysForTenant } from "./tenant-payment-keys";
import { isStaleCapture, releaseSupersededStripePayment } from "./connect-service";
import {
  closeAttempt,
  createPaymentAttemptTx,
  findAttempt,
  finishCapture,
  settleConfirmedPayment,
  type SettleOutcome,
} from "./payment-settlement";
import { orderLabel } from "./order-label";
import { createLogger } from "./logger";

const log = createLogger();

export type PayPalPayResult =
  | { ok: true; url: string }
  | {
      ok: false;
      error: "invalid_token" | "not_found" | "already_paid" | "not_available" | "processing";
    };

/**
 * Start a PayPal payment for one order — the PayPal sibling of
 * `createOrderPayment`: token-authorized, priced from the stored order,
 * nothing from the client trusted. The approve URL goes back to the
 * guest; PayPal returns them to /api/paypal/return, which captures.
 */
export async function createPayPalOrderPayment(
  tenantId: string,
  orderId: string,
  token: string,
  /** Sanitized app deep link (see app-return.ts) to carry through the
   *  round trip so the settled page can offer "Back to the app". */
  appReturnUrl?: string | null,
): Promise<PayPalPayResult> {
  const verified = verifyReceiptToken(token);
  if (!verified || verified.orderId !== orderId || verified.tenantId !== tenantId) {
    return { ok: false, error: "invalid_token" };
  }
  // The restaurant's own PayPal app wins over the deployment-wide keys.
  const keys = await getPayPalKeysForTenant(tenantId);
  // PayPal switched off in Billing: no new PayPal payment may start.
  if (!payPalOnFor(keys)) return { ok: false, error: "not_available" };
  // A card page opened earlier must not stay payable next to PayPal.
  const released = await releaseSupersededStripePayment(tenantId, orderId);
  if (released === "paid") return { ok: false, error: "already_paid" };
  if (released === "processing") return { ok: false, error: "processing" };
  const provider = payPalProviderFor(keys);
  return asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        venueId: true,
        orderNumber: true,
        orderSeries: true,
        totalCents: true,
        currency: true,
        paymentStatus: true,
        venue: { select: { name: true } },
      },
    });
    if (!order) return { ok: false, error: "not_found" as const };
    if (order.paymentStatus === "paid") return { ok: false, error: "already_paid" as const };

    const appParam = appReturnUrl ? `&app=${encodeURIComponent(appReturnUrl)}` : "";
    const payPage = `${siteUrl()}/pay/${order.id}?token=${encodeURIComponent(token)}${appParam}`;
    const returnUrl = `${siteUrl()}/api/paypal/return?orderId=${encodeURIComponent(order.id)}&t=${encodeURIComponent(token)}${appParam}`;
    const approval = await provider.createOrderApproval({
      tenantId,
      orderId: order.id,
      amountCents: order.totalCents,
      currency: order.currency,
      label: `${order.venue.name} — Bestellung #${String(order.orderNumber)}`,
      returnUrl,
      cancelUrl: `${payPage}&status=cancelled`,
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "pending",
        paymentRef: approval.ref,
        paymentProvider: "paypal",
        applicationFeeCents: 0,
      },
    });
    await createPaymentAttemptTx(tx, {
      tenantId,
      venueId: order.venueId,
      orderId: order.id,
      orderLabel: orderLabel(order),
      provider: "paypal",
      ref: approval.ref,
      amountCents: order.totalCents,
      currency: order.currency,
    });
    log.info("payment.paypal_created", { orderId, tenantId, mode: provider.mode });
    void recordForOrder(tenantId, orderId, {
      kind: "payment.started",
      actor: "guest",
      summary: `PayPal page · ${approval.ref}`,
      payload: { provider: "paypal", ref: approval.ref, mode: provider.mode },
    });
    return { ok: true as const, url: approval.url };
  });
}

/**
 * The return leg: PayPal sent the guest back after approval (or PayPal's
 * webhook says the guest approved) — capture and settle, if the order is
 * still on this PayPal payment. Idempotent end to end.
 */
export async function finalizePayPalReturn(
  tenantId: string,
  orderId: string,
): Promise<{ paid: boolean }> {
  const order = await asTenant(tenantId, (tx) =>
    tx.order.findFirst({
      where: { id: orderId },
      select: { paymentStatus: true, paymentRef: true, paymentProvider: true },
    }),
  );
  if (!order || order.paymentProvider !== "paypal" || !order.paymentRef) return { paid: false };
  if (order.paymentStatus === "paid") return { paid: true };
  const outcome = await processPayPalOrderPayment(tenantId, order.paymentRef, {
    orderId,
    source: "capture",
  });
  log.info("payment.paypal_finalized", { orderId, tenantId, outcome: outcome.kind });
  return {
    paid: outcome.kind === "settled" || (outcome.kind === "already_processed" && outcome.paid),
  };
}

export type PayPalProcessResult =
  SettleOutcome | { kind: "not_ready"; status: string } | { kind: "unreadable" };

/**
 * Look at a PayPal order AS PAYPAL SEES IT NOW and act — the PayPal sibling
 * of processStripeOrderPayment, used by the return leg, the webhook and the
 * reconciler. APPROVED = the guest approved, nothing moved yet: the same
 * checks as for a card run (right order and amount, order still wanted and
 * unpaid, approved within the 45-minute window), and only then is it
 * captured; otherwise it is left to lapse, so the guest is never charged.
 * COMPLETED = captured (e.g. our write failed after a capture): recorded.
 */
export async function processPayPalOrderPayment(
  tenantId: string,
  ref: string,
  opts: { orderId?: string | null; source: "webhook" | "reconcile" | "capture" },
): Promise<PayPalProcessResult> {
  const provider = payPalProviderFor(await getPayPalKeysForTenant(tenantId));
  const state = await provider.getOrderState(ref);
  if (!state) return { kind: "unreadable" };
  const attempt = await findAttempt(tenantId, "paypal", ref);
  const orderId = attempt?.orderId ?? opts.orderId ?? null;

  const capture = async () => {
    const taken = await provider.captureOrder(ref);
    if (orderId) {
      void recordForOrder(tenantId, orderId, {
        kind: "paypal.capture",
        actor: "paypal",
        summary: taken.paid ? "PayPal capture completed" : "PayPal capture not completed",
        payload: taken,
      });
    }
    return { captured: taken.paid, amountCents: taken.amountCents, currency: taken.currency };
  };

  // Left "capturing" by a crash (or still running elsewhere): once stale,
  // finish it with what PayPal reports now.
  if (attempt?.status === "capturing") {
    if (!isStaleCapture(attempt.captureStartedAt)) {
      return { kind: "capturing", orderId: attempt.orderId };
    }
    const taken =
      state.status === "COMPLETED"
        ? {
            captured: state.capture.paid,
            amountCents: state.capture.amountCents,
            currency: state.capture.currency,
          }
        : state.status === "APPROVED"
          ? await capture()
          : { captured: false, amountCents: 0, currency: "" };
    return finishCapture(
      { tenantId, provider: "paypal", ref, source: opts.source },
      attempt.id,
      attempt.orderId,
      taken,
    );
  }

  const base = {
    tenantId,
    provider: "paypal" as const,
    ref,
    orderId,
    authorizedAt: state.approvedAt,
    source: opts.source,
  };
  if (state.status === "COMPLETED") {
    return settleConfirmedPayment({
      ...base,
      stage: "captured",
      amountCents: state.capture.paid ? state.capture.amountCents : null,
      currency: state.capture.paid ? state.capture.currency : null,
    });
  }
  if (state.status === "APPROVED") {
    return settleConfirmedPayment({
      ...base,
      stage: "authorized",
      // We created the PayPal order with the attempt's amount and PayPal
      // does not let it change; the capture's own amount is checked again.
      amountCents: attempt?.amountCents ?? null,
      currency: attempt?.currency ?? null,
      capture,
      // An approval that is never captured simply lapses at PayPal.
      release: async () => true,
    });
  }
  if (state.status === "VOIDED") await closeAttempt(tenantId, "paypal", ref, "cancelled");
  return { kind: "not_ready", status: state.status };
}
