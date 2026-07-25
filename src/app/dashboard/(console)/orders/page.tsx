import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { fulfilmentLines } from "@/lib/ordering-config";
import { listRecentOrders } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";
import { markDoneAction } from "./actions";
import { AutoRefresh } from "./auto-refresh";
import { NewOrderChime } from "../../../kitchen/new-order-chime";
import { AutoPrint } from "./auto-print";

/**
 * Kitchen screen: newest orders first, big and scannable from arm's
 * length. Refreshes itself every 10 s; "Done" ticks an order off. Any
 * team member logged into the dashboard sees it — leave a tablet on
 * this page in the kitchen.
 */

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
  const open = orders.filter((o) => o.status === "placed");
  const done = orders.filter((o) => o.status !== "placed");

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
              <li key={order.id} className="border-2 border-orange/60 bg-card px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-serif text-2xl">
                    #{String(order.orderNumber).padStart(4, "0")}
                    {order.paymentStatus === "paid" ? (
                      <span className="ml-2 rounded bg-[#3f7030]/15 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-[#3f7030]">
                        Paid
                      </span>
                    ) : null}
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
                <ul className="mt-3 space-y-1 text-sm">
                  {order.items.map((item, i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <span className="font-bold tabular-nums">{item.quantity}×</span>
                      <span className="flex-1">{item.name}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-bold tabular-nums">
                    {formatPrice(order.totalCents, order.currency, "de")}
                  </p>
                  <div className="flex items-center gap-2">
                    <a
                      href={`/print/order/${order.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="border border-ink/20 px-3.5 py-2 text-xs uppercase tracking-[0.14em] text-muted hover:border-ink/50 hover:text-ink"
                    >
                      View
                    </a>
                    <a
                      href={`/print/order/${order.id}?auto=1`}
                      target="_blank"
                      rel="noreferrer"
                      className="border border-ink/20 px-3.5 py-2 text-xs uppercase tracking-[0.14em] text-muted hover:border-ink/50 hover:text-ink"
                    >
                      🖨 Print
                    </a>
                    <form action={markDoneAction}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <button
                        type="submit"
                        className="bg-orange px-5 py-2 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
                      >
                        Done
                      </button>
                    </form>
                  </div>
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
                  {order.paymentStatus === "paid" ? (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#3f7030]">
                      Paid
                    </span>
                  ) : null}
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
