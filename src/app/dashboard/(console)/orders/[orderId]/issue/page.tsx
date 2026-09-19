import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getSessionUserId } from "@/lib/auth";
import { getStaffIssueByOrder } from "@/lib/issue-service";
import { ORDER_TYPE_LABELS, type OrderType } from "@/lib/ordering-config";
import { formatPrice } from "@/lib/public-menu";
import { SubmitButton } from "@/components/submit-button";
import { replyIssueAction, resolveIssueAction } from "../../actions";

/**
 * One complaint, end to end: what the guest said, what we answered, and
 * the two things the owner can do about it — reply, or mark it resolved.
 * Reached from the pill on the orders card and from the "new problem"
 * email, so it stands on its own without the list around it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Problem reported", robots: { index: false } };

const STATUS_PILL: Record<string, string> = {
  open: "border-orange/60 bg-orange/10 text-orange-dark",
  answered: "border-ink/25 bg-ink/5 text-muted",
  resolved: "border-[#3f7030]/40 bg-[#3f7030]/10 text-[#3f7030]",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open — waiting for you",
  answered: "Answered",
  resolved: "Resolved",
};

const dateTime = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

export default async function OrderIssuePage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const { orderId } = await params;

  // Membership-scoped: another tenant's order is simply not found.
  const issue = await getStaffIssueByOrder(userId, orderId);
  if (!issue) notFound();

  const orderTypeLabel =
    ORDER_TYPE_LABELS[issue.orderType as OrderType] ?? issue.orderType.replaceAll("_", " ");

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-ink lg:px-10">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">
        <Link href="/dashboard/orders" className="underline underline-offset-2 hover:text-ink">
          ← Orders
        </Link>
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-4xl leading-tight">
          Problem on #{String(issue.orderNumber).padStart(4, "0")}
        </h1>
        <span
          className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em] ${
            STATUS_PILL[issue.status] ?? STATUS_PILL.answered
          }`}
        >
          {STATUS_LABEL[issue.status] ?? issue.status}
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 border border-ink/15 bg-card px-6 py-5 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted">Guest</dt>
          <dd className="font-medium">{issue.customerName ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Phone</dt>
          <dd className="font-medium">
            {issue.customerPhone ? (
              // One tap from the complaint to the call that settles it.
              <a
                href={`tel:${issue.customerPhone.replace(/[^\d+]/g, "")}`}
                className="underline underline-offset-2"
              >
                {issue.customerPhone}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Order</dt>
          <dd className="font-medium">
            {orderTypeLabel} · {formatPrice(issue.orderTotalCents, issue.currency, "de")}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Placed</dt>
          <dd className="font-medium tabular-nums">
            {dateTime.format(new Date(issue.orderCreatedAt))}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <a
            href={`/print/order/${issue.orderId}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs uppercase tracking-[0.14em] text-muted underline underline-offset-2 hover:text-ink"
          >
            View the order ↗
          </a>
        </div>
      </dl>

      <section aria-label="Conversation" className="mt-8">
        <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Conversation</h2>
        <ol className="mt-4 space-y-3">
          {issue.messages.map((message) => {
            const fromGuest = message.author === "guest";
            return (
              <li
                key={message.id}
                className={`border px-5 py-4 text-sm ${
                  fromGuest ? "border-orange/50 bg-orange/5" : "border-ink/15 bg-card"
                }`}
              >
                <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
                  <span className="font-bold uppercase tracking-[0.14em]">
                    {fromGuest ? "Guest" : "You"}
                  </span>
                  <time dateTime={message.createdAt} className="tabular-nums">
                    {dateTime.format(new Date(message.createdAt))}
                  </time>
                </p>
                <p className="mt-2 whitespace-pre-wrap">{message.body}</p>
                {message.hasPhoto ? (
                  // Token-gated route, never /img: the dashboard session
                  // cookie is what authorizes this one.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/v1/orders/${issue.orderId}/issue/photo/${message.id}`}
                    alt={`Photo sent by the ${fromGuest ? "guest" : "restaurant"}`}
                    loading="lazy"
                    className="mt-3 max-h-80 rounded border border-ink/15 object-contain"
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-label="Reply" className="mt-8 border border-ink/15 bg-card px-6 py-5">
        <form action={replyIssueAction}>
          <input type="hidden" name="issueId" value={issue.id} />
          <input type="hidden" name="orderId" value={issue.orderId} />
          <label htmlFor="issue-reply" className="block text-sm font-medium">
            Your reply
            <span className="mt-0.5 block text-xs text-muted">
              The guest sees this on their order page — and gets no email, so keep it here or call
              them.
            </span>
          </label>
          <textarea
            id="issue-reply"
            name="body"
            rows={4}
            required
            maxLength={2000}
            placeholder="Sorry about that — here's what we'll do…"
            className="mt-2 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <SubmitButton
            pendingLabel="Sending…"
            className="mt-3 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
          >
            Send reply
          </SubmitButton>
        </form>

        {issue.status !== "resolved" ? (
          <form action={resolveIssueAction} className="mt-4 border-t border-ink/10 pt-4">
            <input type="hidden" name="issueId" value={issue.id} />
            <input type="hidden" name="orderId" value={issue.orderId} />
            <p className="text-xs text-muted">
              Settled it? Marking it resolved closes the thread for the guest and clears it from
              your complaints count.
            </p>
            <SubmitButton
              pendingLabel="Closing…"
              className="mt-2 border border-ink/25 px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-muted hover:border-ink/50 hover:text-ink"
            >
              Mark resolved
            </SubmitButton>
          </form>
        ) : (
          <p className="mt-4 border-t border-ink/10 pt-4 text-xs text-muted">
            Resolved
            {issue.resolvedAt ? ` on ${dateTime.format(new Date(issue.resolvedAt))}` : ""}. You can
            still write here; the guest can only read.
          </p>
        )}
      </section>
    </main>
  );
}
