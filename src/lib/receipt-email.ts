import { sendEmail } from "./email";
import { createLogger } from "./logger";
import { captureException } from "./observability";
import { getOrderForReceipt } from "./order-service";
import { signReceiptToken } from "./receipt-token";
import { siteUrl } from "./site-url";
import { uiLocale } from "./locales";
import { ReceiptEmail, receiptSubject } from "@/emails/receipt-email";

const log = createLogger();

/**
 * Mail the guest their receipt, if they left an email. Two triggers:
 * POST /api/orders for cash orders (right away) and markOrderPaid for
 * online ones (once the money moved). Both are fire-and-forget — this
 * never throws, it logs. Language follows the venue's default locale,
 * which is the same rule the PDF link on the confirmation screen uses.
 */
export async function sendReceiptEmailForOrder(
  tenantId: string,
  orderId: string,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const order = await getOrderForReceipt(tenantId, orderId);
    if (!order) return { sent: false, reason: "not_found" };
    if (!order.customerEmail) return { sent: false, reason: "no_email" };

    // Venue language, collapsed to a locale we have a catalogue for.
    const locale = uiLocale(order.venue.defaultLocale);
    const token = signReceiptToken(order.id, tenantId);
    const base = siteUrl();
    const receiptUrl = `${base}/api/orders/${encodeURIComponent(order.id)}/receipt?token=${encodeURIComponent(token)}&locale=${locale}`;
    const trackUrl = `${base}/order-status/${encodeURIComponent(order.id)}?token=${encodeURIComponent(token)}&locale=${locale}`;

    await sendEmail({
      to: order.customerEmail,
      subject: receiptSubject(order, locale),
      react: ReceiptEmail({ order, locale, receiptUrl, trackUrl }),
    });
    log.info("receipt.emailed", { orderId, tenantId, paid: order.paymentStatus === "paid" });
    return { sent: true };
  } catch (err) {
    captureException(err, { orderId, tenantId, where: "receipt-email" });
    log.warn("receipt.email_failed", { orderId, tenantId });
    return { sent: false, reason: "error" };
  }
}
