import Link from "next/link";
import type { CSSProperties } from "react";
import { guestSteps, isCancelledStatus, stepIndex } from "@/lib/order-status";
import { postOrderCopy } from "@/lib/i18n/post-order";
import { dirFor } from "@/lib/locales";
import type { UiLocale } from "@/lib/locales";

/**
 * The tracker itself: pure render, no data access, so the page above it is
 * just "authorize → load → resolve locale" and this can be unit-tested in
 * all five languages without a database.
 *
 * Zero JS: the step rail, the ticks and the live refresh are all markup.
 * Everything directional uses logical utilities (`start-*`, `text-start`),
 * so the Arabic render is the same layout mirrored rather than a second
 * stylesheet.
 */
export interface TrackerOrder {
  orderNumber: number;
  status: string;
  orderType: string;
  paymentStatus: string;
  /** "voucher" when a loyalty reward settled the bill; null = at the till. */
  paymentProvider?: string | null;
  /** Reward applied to this order (0 = none). `totalCents` is net of it. */
  discountCents?: number;
  /** What that reward cost in points. 0/absent on an order placed before
   *  the column existed — the line then omits the points. */
  discountPoints?: number;
  /** Cents a gift card paid (0/absent = none). Its own line under the
   *  reward: one order can carry both. `totalCents` is net of it too. */
  giftCardDiscountCents?: number;
  /** Last four characters of that card's code, for the masked label. */
  giftCardLast4?: string | null;
  /** When a delivery order left the kitchen. Absent on anything never
   *  dispatched, and on orders older than the column — the step then
   *  renders without a time rather than with a made-up one. */
  outForDeliveryAt?: Date | null;
  totalCents: number;
  currency: string;
  createdAt: Date;
  tableNumber: string | null;
  timezone: string;
  items: { name: string; quantity: number; priceCents: number }[];
}

export function OrderTrackerCard({
  order,
  locale,
  themeStyle,
  pauseRefresh = false,
  reviewUrl = null,
  reviewPrompted = false,
  cashCancel = null,
}: {
  order: TrackerOrder;
  locale: UiLocale;
  themeStyle: CSSProperties;
  /** The guest is writing a complaint below: a 15-second meta refresh
   *  would wipe the half-typed message, so the page asks for it to be
   *  left out while the composer is open. */
  pauseRefresh?: boolean;
  /** Our tracked redirect to Google's write-a-review form, when the
   *  owner has a Place ID saved and the rating switched on. Null hides
   *  the ask — and it is only ever DRAWN on a finished order, because
   *  asking a guest to rate food that hasn't arrived is asking about a
   *  promise. */
  reviewUrl?: string | null;
  /** This guest has already followed the link once. Asking a second time
   *  is nagging, so the card simply stops drawing the button; the link
   *  above stays valid for anyone who reaches it another way. */
  reviewPrompted?: boolean;
  /** The guest's cancel window on a CASH order (`cash-cancel.ts`): when it
   *  closes, and the form plumbing. Null = no button. `closed` = a cancel
   *  that came back too late, shown as a note. */
  cashCancel?: {
    until: Date | null;
    closed: boolean;
    orderId: string;
    token: string;
    action: (form: FormData) => Promise<void>;
  } | null;
}): React.ReactElement {
  const t = postOrderCopy(locale);
  const steps = guestSteps(order.orderType);
  const current = stepIndex(order.status, order.orderType);
  const isDone = order.status === "done";
  // A cancelled order is finished too — there is nothing left to refresh
  // towards, and the rail is replaced by the banner below (P7-17).
  const cancelled = isCancelledStatus(order.status);
  const live = !isDone && !cancelled && !pauseRefresh;
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: order.currency });
  const time = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: order.timezone || "Europe/Berlin",
  });
  /** Time only: the guest already knows what day their dinner is. */
  const clock = new Intl.DateTimeFormat(locale, {
    timeStyle: "short",
    timeZone: order.timezone || "Europe/Berlin",
  });

  return (
    <main
      style={themeStyle}
      dir={dirFor(locale)}
      className="flex min-h-screen flex-col items-center bg-[var(--menu-bg)] px-4 py-10 text-[var(--menu-text)]"
    >
      {/* meta refresh: live without JavaScript */}
      {live ? <meta httpEquiv="refresh" content="15" /> : null}
      <div className="w-full max-w-md rounded-2xl border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] p-6 text-[var(--menu-surface-text,var(--menu-text))] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.5)]">
        {/* Arabic is cursive — `uppercase`/`letter-spacing` only damage it. */}
        <p className="text-center text-xs uppercase tracking-[0.28em] rtl:normal-case rtl:tracking-normal text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
          {t.trackTitle}
        </p>
        <h1 className="mt-2 text-center font-serif text-3xl">
          {t.orderHeading(String(order.orderNumber).padStart(4, "0"))}
        </h1>
        <p className="mt-1 text-center text-sm text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
          {time.format(order.createdAt)}
          {order.tableNumber ? t.tableSuffix(order.tableNumber) : ""}
        </p>

        {/* A cancelled order never walked the chain, so it gets a banner
            rather than a rail — a half-lit rail reads as "still coming",
            which is the one thing this guest must not believe. `role`
            alert-free on purpose: this is a server render of a page the
            guest just opened, not a live interruption. */}
        {cancelled ? (
          <div
            className="mt-8 rounded-xl border p-4 text-center"
            style={{
              borderColor: "color-mix(in oklab, var(--menu-danger) 45%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--menu-danger) 10%, transparent)",
            }}
          >
            <p className="text-base font-semibold" style={{ color: "var(--menu-danger)" }}>
              {t.cancelledTitle}
            </p>
            <p className="mt-2 text-sm text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
              {t.cancelledBody}
            </p>
          </div>
        ) : (
          <ol className="mt-8 space-y-0">
            {steps.map((step, i) => {
              const reached = i <= current;
              const isCurrent = i === current && !isDone;
              return (
                <li key={step.key} className="relative flex gap-4 pb-8 last:pb-0">
                  {i < steps.length - 1 ? (
                    <span
                      aria-hidden="true"
                      /* Logical inset: the rail runs under the bullets on
                       whichever side the text starts. */
                      className="absolute start-[15px] top-8 h-[calc(100%-2rem)] w-0.5"
                      style={{
                        backgroundColor:
                          reached && i < current
                            ? "var(--menu-positive)"
                            : "color-mix(in oklab, var(--menu-surface-text, var(--menu-text)) 22%, transparent)",
                      }}
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold"
                    style={
                      reached
                        ? {
                            backgroundColor: isCurrent
                              ? "var(--menu-surface-accent, var(--menu-accent))"
                              : "var(--menu-positive)",
                            borderColor: isCurrent
                              ? "var(--menu-surface-accent, var(--menu-accent))"
                              : "var(--menu-positive)",
                            color: "var(--menu-surface, #fff)",
                          }
                        : {
                            borderColor:
                              "color-mix(in oklab, var(--menu-surface-text, var(--menu-text)) 28%, transparent)",
                            color: "var(--menu-surface-text-soft, var(--menu-text-soft))",
                          }
                    }
                  >
                    {reached && !isCurrent ? "✓" : i + 1}
                  </span>
                  {/* One language, full size. The old build stacked a small
                    English line under every German one — a stand-in for
                    translation, not a design. */}
                  <span
                    className={`pt-1 text-start text-sm font-semibold ${reached ? "" : "opacity-60"}`}
                  >
                    {t.steps[step.label]}
                    {/* The one step whose MOMENT the guest cares about:
                        "on the way" is the point they start listening for
                        the doorbell. Only ever drawn when we actually
                        recorded it. */}
                    {step.key === "out_for_delivery" && reached && order.outForDeliveryAt ? (
                      <span className="ms-2 font-normal text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                        {clock.format(order.outForDeliveryAt)}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-8 rounded-xl bg-[var(--menu-surface-text,var(--menu-text))]/6 px-4 py-3 text-sm">
          <ul className="mb-2 space-y-1 border-b border-[var(--menu-surface-text,var(--menu-text))]/12 pb-2">
            {order.items.map((line, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="min-w-6 font-bold text-[var(--menu-surface-accent,var(--menu-accent))]">
                  {line.quantity}×
                </span>
                <span className="flex-1 truncate">{line.name}</span>
                <span className="tabular-nums text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                  {money.format((line.priceCents * line.quantity) / 100)}
                </span>
              </li>
            ))}
          </ul>
          {order.discountCents ? (
            <div className="mb-1 flex justify-between text-[var(--menu-surface-accent,var(--menu-accent))]">
              <span>
                {order.discountPoints ? t.rewardPoints(String(order.discountPoints)) : t.reward}
              </span>
              <span className="tabular-nums">−{money.format(order.discountCents / 100)}</span>
            </div>
          ) : null}
          {order.giftCardDiscountCents ? (
            <div className="mb-1 flex justify-between text-[var(--menu-surface-accent,var(--menu-accent))]">
              <span>{order.giftCardLast4 ? t.giftCardCode(order.giftCardLast4) : t.giftCard}</span>
              <span className="tabular-nums">
                −{money.format(order.giftCardDiscountCents / 100)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span>{t.total}</span>
            <span className="font-semibold tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))]">
              {money.format(order.totalCents / 100)}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
            <span>{t.payment}</span>
            <span>
              {order.paymentStatus !== "paid"
                ? t.payAtRestaurant
                : order.paymentProvider === "voucher"
                  ? t.paidWithReward
                  : order.paymentProvider === "gift_card"
                    ? // `paidWithGiftCard` carries no tick of its own — the
                      // PDF catalogue it shares a shape with cannot encode
                      // one — so this surface adds it to match its neighbour.
                      `✓ ${t.paidWithGiftCard}`
                    : t.paidOnline}
            </span>
          </div>
        </div>

        {/* "How was it? Rate us on Google" — the one ask that only makes
            sense at the end. `done` and not cancelled: a cancelled order
            has no experience to rate, and an order still on its way has
            not happened yet. Already tapped once (`reviewPrompted`) and
            it is gone for good: we cannot know whether a review was
            written, but we do know we already asked. Zero JS, one
            outbound link, and the new-tab warning is there for anyone
            who can't see one open. */}
        {isDone && !cancelled && reviewUrl && !reviewPrompted ? (
          <div className="mt-6 rounded-xl border border-[var(--menu-surface-accent,var(--menu-accent))]/30 p-4 text-center">
            <p className="text-sm font-semibold">{t.review.title}</p>
            <a
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded-lg border border-[var(--menu-surface-accent,var(--menu-accent))] px-4 py-2.5 text-sm font-semibold text-[var(--menu-surface-accent,var(--menu-accent))] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--menu-surface-accent,var(--menu-accent))]"
            >
              {t.review.cta}
              <span className="sr-only"> ({t.review.newTab})</span>
            </a>
          </div>
        ) : null}

        {/* The promise and the meta tag travel together — a paused page
            must not claim it refreshes itself. */}
        {/* Cash orders: the guest's own way out, only inside the venue's
            window. The page's 15-second refresh hides it once the time is
            up; the server re-checks the deadline on submit. A <details>
            is the confirm step — works with no JavaScript at all. */}
        {cashCancel?.until && !cancelled ? (
          <details className="mt-5 rounded-xl border border-[var(--menu-surface-text,var(--menu-text))]/20 p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center rounded-lg px-3 text-sm font-semibold text-red-800 underline-offset-4 hover:underline dark:text-red-300">
              {t.cashCancel}
            </summary>
            <p className="mt-2 text-center text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
              {t.cashCancelUntil.replace(
                "{time}",
                new Intl.DateTimeFormat(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: order.timezone || "Europe/Berlin",
                }).format(cashCancel.until),
              )}
            </p>
            <form action={cashCancel.action} className="mt-3">
              <input type="hidden" name="orderId" value={cashCancel.orderId} />
              <input type="hidden" name="token" value={cashCancel.token} />
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className="flex min-h-11 w-full items-center justify-center rounded-lg bg-red-800 px-4 text-sm font-semibold text-white hover:bg-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
              >
                {t.cashCancelConfirm}
              </button>
            </form>
          </details>
        ) : null}
        {cashCancel?.closed && !cancelled ? (
          <p
            role="status"
            className="mt-4 text-center text-sm text-[var(--menu-surface-text,var(--menu-text))]"
          >
            {t.cashCancelClosed}
          </p>
        ) : null}

        {live ? (
          <p className="mt-4 text-center text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
            {t.autoRefresh}
          </p>
        ) : null}
        {/* The way on, as a real button (owner, 2026-09-22): the guest's
            next move after ordering is usually "one more drink", and a
            12 px underlined line at the foot of the card went unseen. */}
        <Link
          href="/"
          className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--menu-surface-accent,var(--menu-accent))] px-4 py-3 text-base font-semibold text-[var(--menu-text)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--menu-surface-accent,var(--menu-accent))]"
        >
          {t.backToMenu}
        </Link>
      </div>
    </main>
  );
}
