import { asTenant } from "./tenant";
import { verifyReceiptToken } from "./receipt-token";
import { siteUrl } from "./site-url";
import { payPalProviderFor } from "./paypal";
import { getPayPalKeysForTenant } from "./tenant-payment-keys";
import { markOrderPaid } from "./connect-service";
import { createLogger } from "./logger";

const log = createLogger();

export type PayPalPayResult =
  { ok: true; url: string } | { ok: false; error: "invalid_token" | "not_found" | "already_paid" };

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
  const provider = payPalProviderFor(await getPayPalKeysForTenant(tenantId));
  return asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
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
      orderId: order.id,
      amountCents: order.totalCents,
      currency: order.currency,
      label: `${order.venue.name} — Bestellung #${String(order.orderNumber).padStart(4, "0")}`,
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
    log.info("payment.paypal_created", { orderId, tenantId, mode: provider.mode });
    return { ok: true as const, url: approval.url };
  });
}

/**
 * The return leg: PayPal sent the guest back after approval — capture
 * and settle. Idempotent end to end: a second return finds the order
 * already paid and simply reports success.
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

  const capture = await payPalProviderFor(await getPayPalKeysForTenant(tenantId)).captureOrder(
    order.paymentRef,
  );
  if (!capture.paid) {
    log.warn("payment.paypal_capture_incomplete", { orderId, tenantId });
    return { paid: false };
  }
  await markOrderPaid(tenantId, orderId);
  return { paid: true };
}
