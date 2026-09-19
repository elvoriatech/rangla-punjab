import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getOrderingSettings, getVenueForUser } from "@/lib/venue-service";
import { BRAND } from "@/lib/brand";
import { fulfilmentLines } from "@/lib/ordering-config";
import { listRecentOrders } from "@/lib/order-service";
import { advanceOrderAction } from "../dashboard/(console)/orders/actions";
import { advanceLabel, isOpenStatus, nextStatus } from "@/lib/order-status";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { AutoRefresh } from "../dashboard/(console)/orders/auto-refresh";
import { FullscreenButton } from "./fullscreen-button";
import { NewOrderChime } from "./new-order-chime";
import { NewOrderFlash } from "./new-order-flash";
import { ServedDrawer } from "./served-drawer";
import { WakeLock } from "./wake-lock";

/**
 * Kitchen display (KDS): a dark, high-contrast board meant to run full
 * screen on a wall tablet. Deliberately outside the dashboard shell — no
 * rail, no admin chrome, just tickets. Ages color-shift as orders wait
 * (amber past 10 minutes, red past 20) so the pass can triage at a
 * glance. Refreshes every 7 seconds.
 */

export const metadata = { title: `Kitchen — ${BRAND.name}` };

/** Whole minutes an order has been waiting. Server component — computed
 *  fresh on every 7 s refresh, so it never goes stale on screen. */
function ageMinutes(createdAt: Date): number {
  return Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 60_000));
}

export default async function KitchenPage(): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) notFound();
  const venueName = venueResult.value.name;
  const base = `/dashboard`;

  // Kitchen display is a Growth feature; during the trial it's open.
  const settings = await getOrderingSettings(userId);
  if (settings.ok && !settings.value.access.entitlements.kitchen) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#14100c] px-6 text-center text-white">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">Kitchen display</p>
        <h1 className="mt-3 font-serif text-3xl">Part of the Growth plan</h1>
        <p className="mt-3 max-w-md text-sm text-white/60">
          The full-screen kitchen board with auto-refresh, wake-lock, and served-today history comes
          with Growth. Your orders still arrive on the dashboard orders page.
        </p>
        <div className="mt-6 flex gap-3">
          <a
            href={`${base}/billing`}
            className="rounded-full bg-amber-300 px-5 py-2.5 text-sm font-semibold text-black hover:bg-amber-200"
          >
            See plans
          </a>
          <a
            href={`${base}/orders`}
            className="rounded-full border border-white/25 px-5 py-2.5 text-sm text-white/80 hover:border-white/60"
          >
            Open orders page
          </a>
        </div>
      </div>
    );
  }

  const orders = await listRecentOrders(userId);
  const open = orders.filter((o) => isOpenStatus(o.status));

  // Served today (venue timezone) — the kitchen's finished pile. Older
  // completed orders belong to the dashboard's history, not this board.
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    dateStyle: "short",
  });
  const todayKey = dayKey.format(new Date());
  const servedToday = orders.filter(
    (o) => o.status === "done" && dayKey.format(o.createdAt) === todayKey,
  );

  const time = new Intl.DateTimeFormat("de-DE", {
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
  const servedViews = servedToday.map((order) => ({
    id: order.id,
    number: `#${String(order.orderNumber).padStart(4, "0")}`,
    table: fulfilmentLines(order)[0] ?? null,
    time: time.format(order.createdAt),
    summary: order.items.map((i) => `${i.quantity}× ${i.name}`).join(" · "),
  }));

  return (
    <div className="flex min-h-screen flex-col bg-[#14100c] text-white">
      <AutoRefresh seconds={7} />
      <WakeLock />
      <ServedDrawer orders={servedViews} />
      <NewOrderFlash orderIds={open.map((o) => o.id)} />

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
        <div className="flex items-baseline gap-4">
          <h1 className="font-serif text-2xl italic text-white/90">{venueName}</h1>
          <span className="text-xs uppercase tracking-[0.28em] text-white/50">Kitchen display</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-white/60">{time.format(new Date())}</span>
          <NewOrderChime openCount={open.length} />
          <FullscreenButton />
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        {open.length === 0 ? (
          <div className="flex h-full min-h-[60vh] flex-col items-center justify-center text-center">
            <p className="font-serif text-4xl text-white/70">All caught up</p>
            <p className="mt-3 text-sm text-white/40">
              New orders appear here within seconds of a guest sending them.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {open.map((order) => {
              const ageMin = ageMinutes(order.createdAt);
              const urgency =
                ageMin >= 20
                  ? "border-red-500/80"
                  : ageMin >= 10
                    ? "border-amber-400/80"
                    : "border-white/15";
              return (
                <li
                  key={order.id}
                  data-order-id={order.id}
                  className={`flex flex-col rounded-lg border-2 ${urgency} bg-white/[0.06] p-5`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-serif text-3xl tabular-nums">
                      #{String(order.orderNumber).padStart(4, "0")}
                      <span
                        className={
                          order.paymentStatus === "paid"
                            ? "ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-300"
                            : "ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-white/60"
                        }
                      >
                        {order.paymentStatus === "paid"
                          ? order.paymentProvider === "paypal"
                            ? "Paid · PayPal"
                            : order.paymentProvider === "stripe"
                              ? "Paid · Card"
                              : "Paid"
                          : "Cash"}
                      </span>
                    </p>
                    <p className="text-sm tabular-nums text-white/50">
                      {time.format(order.createdAt)} ·{" "}
                      <span className={ageMin >= 10 ? "font-bold text-amber-300" : ""}>
                        {ageMin} min
                      </span>
                    </p>
                  </div>
                  {fulfilmentLines(order).map((line, i) => (
                    <p
                      key={line}
                      className={
                        i === 0
                          ? "mt-1 text-lg font-semibold text-amber-200"
                          : "text-sm text-amber-100/80"
                      }
                    >
                      {line}
                    </p>
                  ))}
                  <ul className="mt-4 flex-1 space-y-2">
                    {order.items.map((item, i) => (
                      <li key={i} className="flex items-baseline gap-3 text-lg leading-snug">
                        <span className="font-bold tabular-nums text-amber-100">
                          {item.quantity}×
                        </span>
                        <span className="flex-1 text-white/90">{item.name}</span>
                      </li>
                    ))}
                  </ul>
                  {/* mt-auto pins the action row to the card's bottom edge so
                      it sits at the same height on every card in the row. */}
                  <div className="mt-auto flex items-stretch gap-2 pt-5">
                    <form action={advanceOrderAction} className="flex-1">
                      <input type="hidden" name="orderId" value={order.id} />
                      <input
                        type="hidden"
                        name="to"
                        value={nextStatus(order.status, order.orderType) ?? "done"}
                      />
                      <button
                        type="submit"
                        className="w-full rounded-md bg-white/90 py-3 text-sm font-bold uppercase tracking-[0.18em] text-[#14100c] transition-colors hover:bg-white"
                      >
                        {advanceLabel(nextStatus(order.status, order.orderType) ?? "done")}
                        {order.status !== "placed" ? (
                          <span className="ml-2 font-normal normal-case text-[#14100c]/60">
                            (now: {order.status.replaceAll("_", " ")})
                          </span>
                        ) : null}
                      </button>
                    </form>
                    {/* Destructive, so: outlined not filled, narrow not wide,
                        and behind a confirm. On a wall tablet the advance
                        button is hit at a glance — this one must not be. */}
                    <form action={advanceOrderAction} className="shrink-0">
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="to" value="cancelled" />
                      <ConfirmSubmit
                        message={`Cancel order #${String(order.orderNumber).padStart(4, "0")}? The guest is told it was called off, and this cannot be undone.`}
                        pendingLabel="…"
                        title="Cancel this order"
                        className="h-full rounded-md border border-white/25 px-4 text-sm font-semibold uppercase tracking-[0.14em] text-white/60 transition-colors hover:border-red-400/70 hover:text-red-300"
                      >
                        {advanceLabel("cancelled")}
                      </ConfirmSubmit>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <footer className="border-t border-white/10 px-6 py-3 text-xs text-white/40">
        {open.length} open · {servedToday.length} served today · updates every 7 s ·{" "}
        <a href={`${base}/orders`} className="underline underline-offset-2 hover:text-white/70">
          back to dashboard
        </a>
      </footer>
    </div>
  );
}
