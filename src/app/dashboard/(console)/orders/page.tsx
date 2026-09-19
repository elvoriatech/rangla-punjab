import { redirect } from "next/navigation";
import { reconcilePendingPayments } from "@/lib/connect-service";
import { getSessionUserId } from "@/lib/auth";
import { resolveActiveTenantId } from "@/lib/tenant";
import { issueStatusByOrder, type IssueStatus } from "@/lib/issue-service";
import { fulfilmentLines } from "@/lib/ordering-config";
import { listRecentOrders, VOUCHER_PROVIDER } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";
import { advanceOrderAction } from "./actions";
import {
  advanceIcon,
  advanceLabel,
  isCancelledStatus,
  isOpenStatus,
  nextStatus,
  type OrderStatus,
} from "@/lib/order-status";
import { AutoRefresh } from "./auto-refresh";
import { NewOrderChime } from "../../../kitchen/new-order-chime";
import { AutoPrint } from "./auto-print";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SubmitButton } from "@/components/submit-button";

/**
 * Kitchen screen: newest orders first, big and scannable from arm's
 * length. Refreshes itself every 10 s; "Done" ticks an order off. Any
 * team member logged into the dashboard sees it — leave a tablet on
 * this page in the kitchen.
 */

/** Compact advance-button label for the order card's one-line action row —
 *  "Out for delivery" would wrap; the kitchen screen keeps the full words.
 *  The glyph comes from `advanceIcon` so the card's single status control
 *  and the kitchen board can never disagree about which icon a step wears. */
function advanceCompact(to: OrderStatus): string {
  const word =
    to === "preparing"
      ? "Prepare"
      : to === "ready"
        ? "Ready"
        : to === "out_for_delivery"
          ? "Out"
          : to === "done"
            ? "Done"
            : to;
  return `${advanceIcon(to)} ${word}`.trim();
}

/** Cool-toned treatment for an order the guest asked us to have ready
 *  LATER. It keeps its place in the list (sorting, chime, auto-print all
 *  ignore it) but reads as "not now" at arm's length. Indigo is used for
 *  nothing else on this screen — orange means "live", red means "problem",
 *  green means "paid" — so the tint carries no other meaning. */
const SCHEDULED_CARD =
  "border-y-2 border-e-2 border-s-4 border-y-[#3a5ba0]/35 border-e-[#3a5ba0]/35 border-s-[#3a5ba0] bg-[#3a5ba0]/[0.07]";
const SCHEDULED_TIME_LINE = "font-bold text-[#3a5ba0]";

/** Still in the future at render time. Once the slot passes, the order is
 *  simply due now and renders like every other card — no stale tint. */
function isScheduled(order: { requestedFor: Date | null }): boolean {
  return order.requestedFor !== null && order.requestedFor > new Date();
}

/** The complaint pill that rides on an order card. It stays after the
 *  order is done — a resolved problem is still part of that order's
 *  history, and the owner should be able to find the thread again. */
function IssuePill({
  orderId,
  status,
  className = "",
}: {
  orderId: string;
  status: IssueStatus;
  className?: string;
}): React.ReactElement {
  const tone =
    status === "open"
      ? "border-[#b3261e]/50 bg-[#b3261e]/10 text-[#b3261e]"
      : status === "answered"
        ? "border-orange/60 bg-orange/10 text-orange-dark"
        : "border-ink/20 bg-ink/5 text-muted";
  return (
    <a
      href={`/dashboard/orders/${orderId}/issue`}
      title="Open the complaint thread"
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] ${tone} ${className}`}
    >
      Problem · {status}
    </a>
  );
}

/** Compact current-status pill for the same row. */
function statusCompact(status: string): string {
  switch (status) {
    case "preparing":
      return "🍳 prep";
    case "ready":
      return "🔔 ready";
    case "out_for_delivery":
      return "🛵 out";
    case "cancelled":
      return "Cancelled";
    default:
      return status.replaceAll("_", " ");
  }
}

/** Cancelled + already paid online: there is no automatic refund (P7-17
 *  decision), so the one thing the owner must be told is that the money
 *  is still sitting with the provider and only they can send it back. */
function needsManualRefund(order: {
  status: string;
  paymentStatus: string;
  paymentProvider: string | null;
}): boolean {
  // A reward-settled order took no money, and `reverseOrderCredit` already
  // put the voucher back on the guest's account — nothing to refund.
  if (order.paymentProvider === VOUCHER_PROVIDER) return false;
  return isCancelledStatus(order.status) && order.paymentStatus === "paid";
}

const REFUND_WARNING = "Paid online — refund it in your Stripe / PayPal dashboard";

/** How the guest pays: "Paid · Card"/"Paid · PayPal" once settled online,
 *  "Paid · Reward" when a loyalty voucher covered the whole bill, "Cash"
 *  (settled at the restaurant) otherwise. */
function paymentBadge(order: { paymentStatus: string; paymentProvider: string | null }): string {
  const rail =
    order.paymentProvider === "paypal"
      ? "PayPal"
      : order.paymentProvider === "stripe"
        ? "Card"
        : order.paymentProvider === "voucher"
          ? "Reward"
          : null;
  if (order.paymentStatus === "paid") return rail ? `Paid · ${rail}` : "Paid";
  // An online attempt that never settled: the guest started Card/PayPal
  // but no webhook or return leg confirmed it. Surface it — it is the
  // one line the owner needs to spot a failed payment — instead of
  // quietly labelling it "Cash".
  if (order.paymentStatus === "pending" && rail) return `${rail} · not confirmed`;
  return "Cash";
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; size?: string }>;
}): Promise<React.ReactElement> {
  const base = `/dashboard`;
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  // Open orders always show in full; the completed list paginates.
  // listRecentOrders caps at 100 — history beyond that ages out of this
  // screen (it's a working surface, not an archive).
  // Belt to the webhook's braces: any recent card payment Stripe says
  // succeeded but the webhook never confirmed is settled before the list
  // renders, so "Card · not confirmed" only ever means "really not paid".
  // Failure here must not take the page down.
  await reconcilePendingPayments(userId).catch(() => 0);
  const orders = await listRecentOrders(userId, 100);
  const open = orders.filter((o) => isOpenStatus(o.status));
  const done = orders.filter((o) => !isOpenStatus(o.status));

  // One lookup for the whole screen — both lists read their pills out of
  // this map rather than asking per card.
  const tenantId = await resolveActiveTenantId(userId);
  const issues = tenantId
    ? await issueStatusByOrder(
        tenantId,
        orders.map((o) => o.id),
      )
    : new Map<string, IssueStatus>();
  // `orders` is newest-first, so the first unresolved one is the freshest
  // complaint — that's where the header line points.
  const unresolved = orders.filter((o) => {
    const status = issues.get(o.id);
    return status !== undefined && status !== "resolved";
  });

  const { page: pageParam, size: sizeParam } = await searchParams;
  const SIZES = [10, 25, 50] as const;
  const size = SIZES.includes(Number(sizeParam) as (typeof SIZES)[number]) ? Number(sizeParam) : 10;
  const totalPages = Math.max(1, Math.ceil(done.length / size));
  const page = Math.min(Math.max(1, Number(pageParam) || 1), totalPages);
  const visibleDone = done.slice((page - 1) * size, page * size);
  const pageHref = (p: number, s: number): string => `${base}/orders?page=${p}&size=${s}`;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12 text-ink lg:px-10">
      <AutoRefresh seconds={10} />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">Front of house</p>
          <h1 className="font-serif text-4xl leading-tight">Orders</h1>
          {unresolved.length > 0 ? (
            <p className="mt-2 text-sm">
              <a
                href={`/dashboard/orders/${unresolved[0].id}/issue`}
                className="font-medium text-[#b3261e] underline underline-offset-4 hover:text-ink"
              >
                {unresolved.length} unresolved{" "}
                {unresolved.length === 1 ? "complaint" : "complaints"} →
              </a>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <NewOrderChime openCount={open.length} />
          <p className="text-xs text-muted">
            Updates every 10 seconds. For the cooks&apos; wall screen, use{" "}
            <a
              href={`/kitchen`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              Kitchen ↗
            </a>
            .
          </p>
          <AutoPrint
            printBase={`/print/order`}
            open={open.map((o) => ({
              id: o.id,
              orderNumber: o.orderNumber,
              paymentStatus: o.paymentStatus,
            }))}
          />
        </div>
      </div>

      <section aria-label="Open orders" className="mt-8">
        <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Open ({open.length})</h2>
        {open.length === 0 ? (
          <p className="mt-4 border border-ink/15 bg-card px-6 py-8 text-center text-sm text-muted">
            No open orders. New ones appear here the moment a guest sends them.
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {open.map((order) => (
              <li
                key={order.id}
                className={`flex flex-col px-5 py-4 ${
                  isScheduled(order) ? SCHEDULED_CARD : "border-2 border-orange/60 bg-card"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-serif text-2xl">
                    #{String(order.orderNumber).padStart(4, "0")}
                    <span
                      className={
                        order.paymentStatus === "paid"
                          ? "ml-2 rounded bg-[#3f7030]/15 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-[#3f7030]"
                          : "ml-2 rounded bg-ink/10 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-muted"
                      }
                    >
                      {paymentBadge(order)}
                    </span>
                    {fulfilmentLines(order)[0] ? (
                      <span
                        className={`ml-3 text-lg ${
                          isScheduled(order) ? SCHEDULED_TIME_LINE : "text-orange-dark"
                        }`}
                      >
                        {fulfilmentLines(order)[0]}
                      </span>
                    ) : null}
                  </p>
                  {/* Cancel lives up here, deliberately as text and not a
                      button: the owner asked for no extra buttons on the
                      card, and a destructive action should never look like
                      the thing a thumb reaches for. Same server action. */}
                  <span className="flex items-baseline gap-3 whitespace-nowrap text-sm tabular-nums text-muted">
                    {new Intl.DateTimeFormat("de-DE", {
                      timeStyle: "short",
                      timeZone: "Europe/Berlin",
                    }).format(order.createdAt)}
                    <form action={advanceOrderAction} className="inline">
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="to" value="cancelled" />
                      <ConfirmSubmit
                        message={`Cancel order #${String(order.orderNumber).padStart(4, "0")}? The guest is told it was called off, and this cannot be undone.`}
                        pendingLabel="Cancelling…"
                        title="Cancel this order"
                        className="text-[11px] text-muted underline-offset-2 hover:text-[#b3261e] hover:underline"
                      >
                        Cancel order
                      </ConfirmSubmit>
                    </form>
                  </span>
                </div>
                <ul className="mt-3 flex-1 space-y-1 text-sm">
                  {order.items.map((item, i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <span className="font-bold tabular-nums">{item.quantity}×</span>
                      <span className="flex-1">{item.name}</span>
                    </li>
                  ))}
                </ul>
                {/* Total gets its own line under the items, where a bill's
                    total belongs. It used to ride in the action row, but in
                    the 2-column grid that row overflows and the price was the
                    thing that broke out — orphaned between items and buttons. */}
                <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-ink/15 pt-3">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted">Total</span>
                  <span className="whitespace-nowrap text-right text-sm font-bold tabular-nums">
                    {order.discountCents > 0 ? (
                      <span className="mr-2 text-xs font-normal text-orange-dark">
                        −{formatPrice(order.discountCents, order.currency, "de")} reward
                      </span>
                    ) : null}
                    {formatPrice(order.totalCents, order.currency, "de")}
                  </span>
                </div>
                {/* Action row: issue pill, View, Print, and exactly ONE
                    status button — the one that advances the order, wearing
                    the icon of the step it moves to. No status pill beside
                    it (the icon is the status) and no Cancel button (that
                    moved to the header as a text link). */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-3">
                  {issues.get(order.id) ? (
                    <IssuePill orderId={order.id} status={issues.get(order.id)!} />
                  ) : null}
                  <a
                    href={`/print/order/${order.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="whitespace-nowrap border border-ink/20 px-3 py-2 text-xs uppercase tracking-[0.14em] text-muted hover:border-ink/50 hover:text-ink"
                  >
                    View
                  </a>
                  <a
                    href={`/print/order/${order.id}?auto=1`}
                    target="_blank"
                    rel="noreferrer"
                    className="whitespace-nowrap border border-ink/20 px-3 py-2 text-xs uppercase tracking-[0.14em] text-muted hover:border-ink/50 hover:text-ink"
                  >
                    🖨 Print
                  </a>
                  {nextStatus(order.status, order.orderType) ? (
                    <form action={advanceOrderAction} className="shrink-0">
                      <input type="hidden" name="orderId" value={order.id} />
                      <input
                        type="hidden"
                        name="to"
                        value={nextStatus(order.status, order.orderType)!}
                      />
                      <SubmitButton
                        pendingLabel="Updating…"
                        title={advanceLabel(nextStatus(order.status, order.orderType)!)}
                        className="whitespace-nowrap bg-orange px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-card hover:bg-orange-dark"
                      >
                        {advanceCompact(nextStatus(order.status, order.orderType)!)}
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 ? (
        <section aria-label="Completed orders" className="mt-12">
          <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Completed</h2>
          <ul className="mt-4 divide-y divide-ink/10 border border-ink/15 bg-card">
            {visibleDone.map((order) => (
              <li
                key={order.id}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)_max-content] items-baseline gap-x-3 gap-y-0.5 px-5 py-3 text-sm text-muted sm:grid-cols-[3.5rem_minmax(0,1fr)_11rem_max-content]"
              >
                <span className="tabular-nums">#{String(order.orderNumber).padStart(4, "0")}</span>
                <span className="truncate">
                  {fulfilmentLines(order)[0] ?? ""}
                  <span
                    className={
                      order.paymentStatus === "paid"
                        ? "ml-2 text-[10px] font-bold uppercase tracking-wider text-[#3f7030]"
                        : "ml-2 text-[10px] font-bold uppercase tracking-wider text-muted"
                    }
                  >
                    {paymentBadge(order)}
                  </span>
                  {isCancelledStatus(order.status) ? (
                    <span className="ms-2 whitespace-nowrap rounded-full border border-ink/20 bg-ink/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted">
                      {statusCompact(order.status)}
                    </span>
                  ) : null}
                  {issues.get(order.id) ? (
                    <IssuePill
                      orderId={order.id}
                      status={issues.get(order.id)!}
                      className="ms-2 inline-block"
                    />
                  ) : null}
                </span>
                <span className="col-start-2 whitespace-nowrap tabular-nums sm:col-start-3 sm:text-right">
                  {(() => {
                    const n = order.items.reduce((sum, i) => sum + i.quantity, 0);
                    return `${n} ${n === 1 ? "item" : "items"}`;
                  })()}{" "}
                  · {formatPrice(order.totalCents, order.currency, "de")}
                  {order.discountCents > 0 ? (
                    <span className="text-orange-dark">
                      {" "}
                      · −{formatPrice(order.discountCents, order.currency, "de")} reward
                    </span>
                  ) : null}
                </span>
                <span className="col-start-3 row-start-1 flex items-center gap-3 justify-self-end sm:col-start-4">
                  <span className="tabular-nums">
                    {new Intl.DateTimeFormat("de-DE", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "Europe/Berlin",
                    }).format(order.createdAt)}
                  </span>
                  <a
                    href={`/print/order/${order.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-ink"
                  >
                    View
                  </a>
                  <a
                    href={`/print/order/${order.id}?auto=1`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-ink"
                  >
                    Print
                  </a>
                </span>
                {/* Its own row rather than another badge: this is the only
                    line on the screen that asks the owner to go and DO
                    something in a different system. */}
                {needsManualRefund(order) ? (
                  <span className="col-span-full text-xs font-medium text-[#b3261e]">
                    ⚠ {REFUND_WARNING}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <nav
            aria-label="Completed orders pages"
            className="flex flex-wrap items-center justify-between gap-3 border border-t-0 border-ink/15 bg-card px-5 py-3 text-xs text-muted"
          >
            <span>
              {(page - 1) * size + 1}–{Math.min(page * size, done.length)} of {done.length} orders
            </span>
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                Rows:
                {SIZES.map((s) => (
                  <a
                    key={s}
                    href={pageHref(1, s)}
                    aria-current={s === size ? "true" : undefined}
                    className={
                      s === size
                        ? "rounded border border-orange/60 px-1.5 py-0.5 text-orange-dark"
                        : "px-1 underline-offset-2 hover:text-ink hover:underline"
                    }
                  >
                    {s}
                  </a>
                ))}
              </span>
              <span className="flex items-center gap-2">
                {page > 1 ? (
                  <a href={pageHref(page - 1, size)} className="hover:text-ink">
                    ← Prev
                  </a>
                ) : (
                  <span className="opacity-40">← Prev</span>
                )}
                <span className="tabular-nums">
                  Page {page} / {totalPages}
                </span>
                {page < totalPages ? (
                  <a href={pageHref(page + 1, size)} className="hover:text-ink">
                    Next →
                  </a>
                ) : (
                  <span className="opacity-40">Next →</span>
                )}
              </span>
            </span>
          </nav>
        </section>
      ) : null}
    </main>
  );
}
