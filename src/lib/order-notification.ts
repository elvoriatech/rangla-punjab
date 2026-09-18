import { sendEmail } from "./email";
import { createLogger } from "./logger";
import { captureException } from "./observability";
import { parseOrderingConfig } from "./ordering-config";
import { getOrderForReceipt } from "./order-service";
import { siteUrl } from "./site-url";
import { asTenant } from "./tenant";
import { NewOrderEmail, newOrderSubject } from "@/emails/new-order-email";

const log = createLogger();

/**
 * Tell the owner a new order is in. Same two triggers and the same
 * fire-and-forget contract as the guest receipt: cash orders on placement,
 * online orders once the money has moved (the kitchen prints on the same
 * rule, so the inbox and the printer agree). Recipients come from the
 * venue's ordering settings; none configured ⇒ nothing sent, no error.
 * One email per address rather than one To: with everyone on it, so a
 * shift lead's reply never exposes the office address to the guest-facing
 * side and one bounce never blocks the others.
 */
export async function sendNewOrderNotification(
  tenantId: string,
  orderId: string,
): Promise<{ sent: number; reason?: string }> {
  try {
    const [order, recipients] = await Promise.all([
      getOrderForReceipt(tenantId, orderId),
      notifyRecipients(tenantId, orderId),
    ]);
    if (!order) return { sent: 0, reason: "not_found" };
    if (recipients.length === 0) return { sent: 0, reason: "no_recipients" };

    const locale = order.venue.defaultLocale.startsWith("de") ? "de" : "en";
    const kitchenUrl = `${siteUrl()}/kitchen`;
    const subject = newOrderSubject(order, locale);
    const results = await Promise.allSettled(
      recipients.map((to) =>
        sendEmail({ to, subject, react: NewOrderEmail({ order, locale, kitchenUrl }) }),
      ),
    );
    let sent = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") sent += 1;
      else {
        captureException(r.reason, {
          orderId,
          tenantId,
          to: recipients[i],
          where: "order-notification",
        });
      }
    });
    if (sent > 0) log.info("order.notified", { orderId, tenantId, sent, of: recipients.length });
    if (sent < recipients.length) {
      log.warn("order.notify_failed", { orderId, tenantId, failed: recipients.length - sent });
    }
    return sent > 0 ? { sent } : { sent: 0, reason: "error" };
  } catch (err) {
    captureException(err, { orderId, tenantId, where: "order-notification" });
    log.warn("order.notify_failed", { orderId, tenantId });
    return { sent: 0, reason: "error" };
  }
}

/** The venue's configured alert addresses, read through the order so the
 *  tenant scope is the order's, never a caller-supplied venue id. */
async function notifyRecipients(tenantId: string, orderId: string): Promise<string[]> {
  return asTenant(tenantId, async (tx) => {
    const row = await tx.order.findFirst({
      where: { id: orderId },
      select: { venue: { select: { ordering: true } } },
    });
    return row ? parseOrderingConfig(row.venue.ordering).notifyEmails : [];
  });
}
