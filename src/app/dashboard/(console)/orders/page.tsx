import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { fulfilmentLines } from "@/lib/ordering-config";
import { listRecentOrders } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";
import { advanceOrderAction } from "./actions";
import { advanceLabel, isOpenStatus, nextStatus } from "@/lib/order-status";
import { AutoRefresh } from "./auto-refresh";
import { NewOrderChime } from "../../../kitchen/new-order-chime";
import { AutoPrint } from "./auto-print";

/**
 * Kitchen screen: newest orders first, big and scannable from arm's
 * length. Refreshes itself every 10 s; "Done" ticks an order off. Any
 * team member logged into the dashboard sees it — leave a tablet on
 * this page in the kitchen.
 */

/** Compact advance-button label for the order card's one-line action row —
 *  "Out for delivery" would wrap; the kitchen screen keeps the full words. */
function advanceCompact(to: string): string {
  switch (to) {
    case "preparing":
      return "🍳 Prepare";
    case "ready":
      return "🔔 Ready";
    case "out_for_delivery":
      return "🛵 Out";
    case "done":
      return "✓ Done";
    default:
      return to;
  }
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
    default:
      return status.replaceAll("_", " ");
  }
}

/** How the guest pays: "Paid · Card"/"Paid · PayPal" once settled online,
 *  "Cash" (settled at the restaurant) otherwise. */
function paymentBadge(order: { paymentStatus: string; paymentProvider: string | null }): string {
  if (order.paymentStatus !== "paid") return "Cash";
  if (order.paymentProvider === "paypal") return "Paid · PayPal";
  if (order.paymentProvider === "stripe") return "Paid · Card";
  return "Paid";
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
  const orders = await listRecentOrders(userId, 100);
  const open = orders.filter((o) => isOpenStatus(o.status));
  const done = orders.filter((o) => !isOpenStatus(o.status));

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
            open={open.map((o) => ({ id: o.id, orderNumber: o.orderNumber }))}
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
                className="flex flex-col border-2 border-orange/60 bg-card px-5 py-4"
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
                      <span className="ml-3 text-lg text-orange-dark">
                        {fulfilmentLines(order)[0]}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm tabular-nums text-muted">
                    {new Intl.DateTimeFormat("de-DE", {
                      timeStyle: "short",
                      timeZone: "Europe/Berlin",
                    }).format(order.createdAt)}
                  </p>
                </div>
                <ul className="mt-3 flex-1 space-y-1 text-sm">
                  {order.items.map((item, i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <span className="font-bold tabular-nums">{item.quantity}×</span>
                      <span className="flex-1">{item.name}</span>
                    </li>
                  ))}
                </ul>
                {/* Action row: pinned to the card's bottom edge (mt-auto on a
                    flex-col card) and locked to ONE line — buttons must sit in
                    the same place on every card regardless of item count. */}
                <div className="mt-auto flex items-center gap-2 pt-4">
                  <p className="mr-auto whitespace-nowrap text-sm font-bold tabular-nums">
                    {formatPrice(order.totalCents, order.currency, "de")}
                  </p>
                  {order.status !== "placed" ? (
                    <span
                      title={order.status.replaceAll("_", " ")}
                      className="whitespace-nowrap rounded-full border border-ink/15 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-muted"
                    >
                      {statusCompact(order.status)}
                    </span>
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
                      <button
                        type="submit"
                        title={advanceLabel(nextStatus(order.status, order.orderType)!)}
                        className="whitespace-nowrap bg-orange px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-card hover:bg-orange-dark"
                      >
                        {advanceCompact(nextStatus(order.status, order.orderType)!)}
                      </button>
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
                </span>
                <span className="col-start-2 whitespace-nowrap tabular-nums sm:col-start-3 sm:text-right">
                  {(() => {
                    const n = order.items.reduce((sum, i) => sum + i.quantity, 0);
                    return `${n} ${n === 1 ? "item" : "items"}`;
                  })()}{" "}
                  · {formatPrice(order.totalCents, order.currency, "de")}
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
