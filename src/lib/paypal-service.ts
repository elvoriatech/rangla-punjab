import { recordForOrder } from "./order-events";
import { asTenant } from "./tenant";
import { verifyReceiptToken } from "./receipt-token";
import { siteUrl } from "./site-url";
import { payPalOnFor, payPalProviderFor } from "./paypal";
import { getPayPalKeysForTenant } from "./tenant-payment-keys";
import { releaseSupersededStripePayment } from "./connect-service";
import { createPaymentAttemptTx, settleConfirmedPayment } from "./payment-settlement";
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
 * webhook says the guest approved) — capture and settle. The approval is
 * a reservation: under the order's payment lock the same checks as for a
 * card run first (right order and amount, order still wanted and unpaid,
 * within the 45-minute window), and only then is the money captured. If a
 * check fails nothing is captured, so the guest is never charged. A card
 * payment that settled the order meanwhile moved it off PayPal, so this
 * can never capture on top of it. Idempotent end to end.
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
  const ref = order.paymentRef;
  const attempt = await asTenant(tenantId, (tx) =>
    tx.paymentAttempt.findUnique({
      where: { provider_ref: { provider: "paypal", ref } },
      select: { amountCents: true, currency: true },
    }),
  );
  const provider = payPalProviderFor(await getPayPalKeysForTenant(tenantId));
  const outcome = await settleConfirmedPayment({
    tenantId,
    provider: "paypal",
    ref,
    orderId,
    stage: "authorized",
    // The approval is for the amount we created the PayPal order with —
    // PayPal does not let it change; the capture's amount is checked too.
    amountCents: attempt?.amountCents ?? null,
    currency: attempt?.currency ?? null,
    capture: async () => {
      const capture = await provider.captureOrder(ref);
      void recordForOrder(tenantId, orderId, {
        kind: "paypal.capture",
        actor: "paypal",
        summary: capture.paid ? "PayPal capture completed" : "PayPal capture not completed",
        payload: capture,
      });
      return {
        captured: capture.paid,
        amountCents: capture.amountCents,
        currency: capture.currency,
      };
    },
    // An approval that is never captured simply lapses at PayPal.
    release: async () => true,
    source: "capture",
  });
  log.info("payment.paypal_finalized", { orderId, tenantId, outcome: outcome.kind });
  return {
    paid: outcome.kind === "settled" || (outcome.kind === "already_processed" && outcome.paid),
  };
}
