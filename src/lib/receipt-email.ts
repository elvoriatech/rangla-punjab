import { sendEmail } from "./email";
import { createLogger } from "./logger";
import { captureException } from "./observability";
import { getOrderForReceipt } from "./order-service";
import { signReceiptToken } from "./receipt-token";
import { siteUrl } from "./site-url";
import { uiLocale } from "./locales";
import { trackedReviewUrl, venueReviewLink } from "./google-rating";
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

    // The signed-in guest's own language when they have set one, else
    // the venue's — collapsed to a locale we have a catalogue for. It
    // picks the email copy AND rides the two links below, so the receipt
    // PDF and the tracker page open in the same language as the mail.
    // An anonymous order has no profile to ask, so it gets the venue's.
    const locale = uiLocale(order.locale ?? order.customerLocale ?? order.venue.defaultLocale);
    const token = signReceiptToken(order.id, tenantId);
    const base = siteUrl();
    const receiptUrl = `${base}/api/orders/${encodeURIComponent(order.id)}/receipt?token=${encodeURIComponent(token)}&locale=${locale}`;
    const trackUrl = `${base}/order-status/${encodeURIComponent(order.id)}?token=${encodeURIComponent(token)}&locale=${locale}`;

    // "Rate us on Google", under the receipt. The receipt goes out at
    // placement or payment time — before the food, let alone the
    // experience — so this stays a quiet secondary button rather than a
    // headline ask. Null (no Place ID, or the owner switched the rating
    // off) simply leaves it out.
    //
    // The link is our tracked redirect, which records the tap and then
    // forwards to Google. The "asked once" rule that hides the button on
    // the tracker, the account page and the app deliberately does NOT
    // apply here: an email is a fixed artefact sent before anyone has
    // tapped anything, it cannot learn about a later tap, and a receipt
    // that silently dropped its button would be the owner's ask made
    // worse rather than better. The button is always there when the
    // venue has a review URL; the redirect keeps the count honest either
    // way, because a second tap is a no-op.
    const review = order.venueId ? await venueReviewLink(tenantId, order.venueId) : null;

    await sendEmail({
      to: order.customerEmail,
      subject: receiptSubject(order, locale),
      react: ReceiptEmail({
        order,
        locale,
        receiptUrl,
        trackUrl,
        reviewUrl: review ? trackedReviewUrl(order.id, token) : null,
        siteBase: base,
      }),
    });
    log.info("receipt.emailed", { orderId, tenantId, paid: order.paymentStatus === "paid" });
    return { sent: true };
  } catch (err) {
    captureException(err, { orderId, tenantId, where: "receipt-email" });
    log.warn("receipt.email_failed", { orderId, tenantId });
    return { sent: false, reason: "error" };
  }
}
