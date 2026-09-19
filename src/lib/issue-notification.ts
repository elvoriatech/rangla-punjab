import { sendEmail } from "./email";
import { createLogger } from "./logger";
import { uiLocale } from "./locales";
import { captureException } from "./observability";
import { parseOrderingConfig } from "./ordering-config";
import { siteUrl } from "./site-url";
import { asTenant } from "./tenant";
import { NewIssueEmail, newIssueSubject } from "@/emails/new-issue-email";

const log = createLogger();

/**
 * Tell the owner a guest has reported a problem — on the first message
 * and on every follow-up, because "they replied and are still waiting" is
 * exactly as urgent as the original complaint. Restaurant replies never
 * trigger this; the owner does not need mail about their own words.
 *
 * Same contract and the same posture as `sendNewOrderNotification`:
 * recipients come from the venue's ordering settings, none configured ⇒
 * nothing sent and no error, and one email per address rather than a
 * shared To: so one bounce cannot take the others down. The caller
 * (`postGuestIssueMessage`) fires it and forgets it — a mail outage must
 * never turn a guest's complaint into an error page.
 */
export async function sendNewIssueNotification(
  tenantId: string,
  issueId: string,
): Promise<{ sent: number; reason?: string }> {
  try {
    const context = await loadIssue(tenantId, issueId);
    if (!context) return { sent: 0, reason: "not_found" };
    if (context.recipients.length === 0) return { sent: 0, reason: "no_recipients" };

    // The owner reads this one, so it follows the venue's own language.
    const locale = uiLocale(context.locale);
    const issueUrl = `${siteUrl()}/dashboard/orders/${context.orderId}/issue`;
    const subject = newIssueSubject(context.issue.orderNumber, locale);
    const results = await Promise.allSettled(
      context.recipients.map((to) =>
        sendEmail({ to, subject, react: NewIssueEmail({ issue: context.issue, locale, issueUrl }) }),
      ),
    );
    let sent = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") sent += 1;
      else {
        captureException(r.reason, {
          issueId,
          tenantId,
          to: context.recipients[i],
          where: "issue-notification",
        });
      }
    });
    if (sent > 0) {
      log.info("issue.notified", { issueId, tenantId, sent, of: context.recipients.length });
    }
    if (sent < context.recipients.length) {
      log.warn("issue.notify_failed", {
        issueId,
        tenantId,
        failed: context.recipients.length - sent,
      });
    }
    return sent > 0 ? { sent } : { sent: 0, reason: "error" };
  } catch (err) {
    captureException(err, { issueId, tenantId, where: "issue-notification" });
    log.warn("issue.notify_failed", { issueId, tenantId });
    return { sent: 0, reason: "error" };
  }
}

/**
 * Everything the template needs, in one tenant-scoped read: the thread's
 * order, the venue's branding + language, the alert addresses, and the
 * LATEST GUEST message — which is the one this alert is about. Reading it
 * back here rather than taking it as an argument keeps the "what was
 * actually saved" question answered by the database.
 */
async function loadIssue(
  tenantId: string,
  issueId: string,
): Promise<{
  orderId: string;
  issue: Parameters<typeof NewIssueEmail>[0]["issue"];
  recipients: string[];
  locale: string;
} | null> {
  return asTenant(tenantId, async (tx) => {
    const row = await tx.orderIssue.findFirst({
      where: { id: issueId },
      select: {
        orderId: true,
        order: {
          select: {
            orderNumber: true,
            customerName: true,
            customerPhone: true,
            createdAt: true,
          },
        },
        venue: {
          select: { name: true, branding: true, ordering: true, defaultLocale: true },
        },
        messages: {
          where: { author: "guest" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, photoKey: true, createdAt: true },
        },
      },
    });
    if (!row) return null;
    const message = row.messages[0];
    if (!message) return null;

    const branding = row.venue.branding as {
      logoKey?: unknown;
      bannerKey?: unknown;
      primaryColor?: unknown;
    } | null;
    const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

    return {
      orderId: row.orderId,
      issue: {
        orderNumber: row.order.orderNumber,
        orderPlacedAt: row.order.createdAt,
        customerName: row.order.customerName,
        customerPhone: row.order.customerPhone,
        message: {
          body: message.body,
          hasPhoto: message.photoKey !== null,
          createdAt: message.createdAt,
        },
        venue: {
          name: row.venue.name,
          logoKey: str(branding?.logoKey),
          bannerKey: str(branding?.bannerKey),
          primaryColor: str(branding?.primaryColor),
        },
      },
      recipients: parseOrderingConfig(row.venue.ordering).notifyEmails,
      locale: row.venue.defaultLocale,
    };
  });
}
