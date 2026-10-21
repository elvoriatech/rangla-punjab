import Link from "next/link";
import { formatPrice } from "@/lib/public-menu";
import {
  getOrderLog,
  listOrderLog,
  ORDER_LOG_FILTERS,
  parseOrderLogFilter,
  type OrderLogFilter,
  type OrderLogRow,
} from "@/lib/order-log-service";
import { purgeOldOrderEvents } from "@/lib/order-events";
import { requirePermission } from "@/lib/team-access";
import { getVenueForUser } from "@/lib/venue-service";
import { redirect } from "next/navigation";

/**
 * The order log (owner, 2026-10-14): every order with what came in and
 * what happened to it, second by second, with the raw JSON of each step —
 * kept 6 months, never editable. Recorded by `order-events.ts`.
 */

export const dynamic = "force-dynamic";

const TZ = "Europe/Berlin";
const TIME = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: TZ,
});
const STAMP = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: TZ,
});
/** Exact, with milliseconds, for the raw view. */
const exact = (d: Date): string =>
  `${STAMP.format(d)}.${String(d.getUTCMilliseconds()).padStart(3, "0")}`;

const FILTER_LABEL: Record<OrderLogFilter, string> = {
  all: "All",
  payment_open: "Payment open",
  payment_failed: "Payment failed",
  deleted: "Deleted",
};

const TYPE_LABEL: Record<string, string> = {
  delivery: "Delivery",
  takeaway: "Pickup",
  dine_in: "Dine-in",
};
const PAY_LABEL: Record<string, string> = { card: "Card", paypal: "PayPal", cash: "Cash" };

/** Event kinds in plain words, and how the dot is coloured. */
const KIND: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "plain" }> = {
  "order.placed": { label: "Order received", tone: "ok" },
  "payment.started": { label: "Sent to payment", tone: "plain" },
  "payment.paid": { label: "Paid", tone: "ok" },
  "payment.failed": { label: "Payment failed", tone: "bad" },
  "payment.switched_to_cash": { label: "Switched to cash", tone: "warn" },
  "payment.too_late": { label: "Too late — not charged", tone: "bad" },
  "payment.superseded_paid": { label: "Paid on an earlier payment page", tone: "warn" },
  "payment.not_captured": { label: "Not charged — reservation released", tone: "warn" },
  "payment.needs_resolution": { label: "Needs action — money received", tone: "bad" },
  "payment.resolved": { label: "Payment handled", tone: "ok" },
  "stripe.webhook": { label: "Stripe message", tone: "plain" },
  "paypal.webhook": { label: "PayPal message", tone: "plain" },
  "paypal.capture": { label: "PayPal capture", tone: "plain" },
  "order.accepted": { label: "Accepted", tone: "ok" },
  "order.status": { label: "Status changed", tone: "plain" },
  "order.cancelled": { label: "Cancelled", tone: "bad" },
  "order.dispatched": { label: "Out for delivery", tone: "ok" },
  "order.delivered": { label: "Delivered", tone: "ok" },
  "order.printed": { label: "Printed", tone: "plain" },
  "order.deleted": { label: "Deleted", tone: "bad" },
};
/** Inline colours, not utility classes: this page's one-offs must not
 *  grow the stylesheet the public menu also loads (its CSS budget). */
const DOT: Record<string, string> = {
  ok: "#3f7030",
  warn: "#d29a1e",
  bad: "#991b1b",
  plain: "#c9b8a2",
};

/** "2026-10-14" today in the restaurant's time zone. */
function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** Midnight-to-midnight of a Berlin calendar day (DST-safe enough for a
 *  day filter: the offset is taken at noon of that day). */
function dayRange(day: string): { from: Date; to: Date } {
  const noon = new Date(`${day}T12:00:00Z`);
  const local = new Date(noon.toLocaleString("en-US", { timeZone: TZ }));
  const offsetMs = local.getTime() - noon.getTime();
  const from = new Date(new Date(`${day}T00:00:00Z`).getTime() - offsetMs);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

function statusPill(row: OrderLogRow): { text: string; cls: string } {
  if (row.deleted) return { text: "Deleted", cls: "bg-ink/10 text-muted" };
  if (row.failed && row.paymentStatus !== "paid")
    return { text: "Payment failed", cls: "bg-red-900/10 text-red-900" };
  if (row.paymentStatus === "pending")
    return { text: "Payment open", cls: "bg-orange/15 text-orange-dark" };
  if (row.status === "done") return { text: "Done", cls: "bg-ink/10 text-ink" };
  if (row.status === "cancelled") return { text: "Cancelled", cls: "bg-ink/10 text-muted" };
  return { text: row.status ?? "—", cls: "bg-ink/10 text-ink" };
}

export default async function OrderLogPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; q?: string; f?: string; id?: string }>;
}): Promise<React.ReactElement> {
  const userId = await requirePermission("orders");
  const venue = await getVenueForUser(userId);
  if (!venue.ok) redirect("/dashboard");
  // Retention: anything older than 6 months goes (the only delete there is).
  await purgeOldOrderEvents(venue.value.tenantId);

  const sp = await searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : todayIso();
  const q = (sp.q ?? "").trim().slice(0, 100);
  const filter = parseOrderLogFilter(sp.f);
  const { from, to } = dayRange(day);
  const rows = await listOrderLog(userId, { from, to, q, filter });
  const selectedId = sp.id ?? rows[0]?.orderId ?? null;
  const detail = selectedId ? await getOrderLog(userId, selectedId) : null;
  const currency = venue.value.currency ?? "EUR";
  const money = (c: number | null): string => (c == null ? "—" : formatPrice(c, currency, "de"));

  const qs = (over: Record<string, string | null>): string => {
    const p = new URLSearchParams();
    const merged = { day, q, f: filter === "all" ? "" : filter, id: selectedId ?? "", ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/dashboard/order-log?${p.toString()}`;
  };

  return (
    <main className="px-6 py-10 text-ink lg:px-10">
      {/* The two-column split, scoped to this page (see DOT). */}
      <style>{`@media (min-width:1024px){.order-log-grid{grid-template-columns:minmax(0,400px) minmax(0,1fr)}}`}</style>
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">Trace</p>
      <h1 className="font-serif text-4xl leading-tight">Order log</h1>
      <p className="mt-2 text-sm text-muted">
        Every order with everything that came in and everything that happened to it, to the second —
        kept for 6 months. Entries cannot be edited or deleted.
      </p>

      {/* Search + day + filters. A plain GET form: works without JS. */}
      <form
        action="/dashboard/order-log"
        method="get"
        className="mt-6 flex flex-wrap items-center gap-2"
      >
        <label className="sr-only" htmlFor="olq">
          Search
        </label>
        <input
          id="olq"
          name="q"
          defaultValue={q}
          placeholder="No., name, phone, email, Stripe/PayPal reference … (searches 6 months)"
          className="flex-1 border border-ink/20 bg-card px-3 py-2 text-sm"
          style={{ minWidth: 280 }}
        />
        <label className="sr-only" htmlFor="olday">
          Day
        </label>
        <input
          id="olday"
          type="date"
          name="day"
          defaultValue={day}
          className="border border-ink/20 bg-card px-2 py-2 text-sm"
        />
        {filter !== "all" ? <input type="hidden" name="f" value={filter} /> : null}
        <button
          type="submit"
          className="bg-orange px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-card hover:bg-orange-dark"
        >
          Show
        </button>
      </form>
      <nav aria-label="Filter" className="mt-3 flex flex-wrap gap-2">
        {ORDER_LOG_FILTERS.map((f) => (
          <Link
            key={f}
            href={qs({ f: f === "all" ? "" : f, id: "" })}
            aria-current={filter === f ? "true" : undefined}
            className={`rounded-2xl px-3 py-1.5 text-xs [border-bottom-right-radius:3px] ${
              filter === f
                ? "bg-ink font-semibold text-card"
                : "border border-ink/15 bg-card hover:border-orange"
            }`}
          >
            {FILTER_LABEL[f]}
          </Link>
        ))}
        {q ? (
          <Link
            href={qs({ q: "", id: "" })}
            className="px-2 py-1.5 text-xs text-orange-dark underline"
          >
            Clear search
          </Link>
        ) : null}
      </nav>

      <div className="order-log-grid mt-6 grid gap-5">
        {/* The list */}
        <section aria-label="Orders" className="border border-ink/15 bg-card">
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              {q ? "Nothing found for this search." : "No orders logged on this day."}
            </p>
          ) : (
            <ul>
              {rows.map((r, i) => {
                const pill = statusPill(r);
                const on = r.orderId === selectedId;
                return (
                  <li key={r.orderId} className={i === 0 ? "" : "border-t border-ink/10"}>
                    <Link
                      href={qs({ id: r.orderId })}
                      aria-current={on ? "true" : undefined}
                      className={`grid items-center gap-3 px-4 py-3 no-underline ${on ? "bg-orange/10" : ""}`}
                      style={{
                        gridTemplateColumns: "3.5rem minmax(0,1fr) auto",
                        ...(on ? { boxShadow: "inset 3px 0 0 #c4561d" } : {}),
                      }}
                    >
                      <span className="font-semibold tabular-nums">{r.label}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">
                          {[
                            r.guest,
                            r.orderType ? (TYPE_LABEL[r.orderType] ?? r.orderType) : null,
                            r.payment ? (PAY_LABEL[r.payment] ?? r.payment) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span className="block text-xs text-muted">
                          {STAMP.format(r.firstAt)}
                          {r.channel ? ` · ${r.channel === "app" ? "App" : "Website"}` : ""}
                        </span>
                      </span>
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${pill.cls}`}
                      >
                        {pill.text}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* The selected order */}
        <section aria-label="Order detail" className="border border-ink/15 bg-card px-5 py-5">
          {!detail ? (
            <p className="text-sm text-muted">Pick an order on the left.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-serif text-3xl leading-tight">
                    {detail.row.label} · {money(detail.row.totalCents)}
                  </h2>
                  <p className="text-xs text-muted">
                    ID {detail.row.orderId}
                    {detail.row.channel
                      ? ` · ${detail.row.channel === "app" ? "App" : "Website"}`
                      : ""}
                    {detail.guest.locale ? ` · ${detail.guest.locale}` : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusPill(detail.row).cls}`}
                >
                  {statusPill(detail.row).text}
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <Box title="Guest">
                  <p className="font-semibold">{detail.guest.name ?? "—"}</p>
                  {detail.guest.phone ? <p>{detail.guest.phone}</p> : null}
                  {detail.guest.email ? (
                    <p style={{ wordBreak: "break-all" }}>{detail.guest.email}</p>
                  ) : null}
                  {detail.guest.table ? <p>Table {detail.guest.table}</p> : null}
                </Box>
                <Box title="Order">
                  <p>
                    {detail.row.orderType
                      ? (TYPE_LABEL[detail.row.orderType] ?? detail.row.orderType)
                      : "—"}
                  </p>
                  {detail.guest.address ? <p>{detail.guest.address}</p> : null}
                  {detail.items.map((i, n) => (
                    <p key={n} className="text-sm">
                      {i.quantity}× {i.name}
                    </p>
                  ))}
                </Box>
                <Box title="Payment">
                  <p>
                    {detail.row.payment
                      ? (PAY_LABEL[detail.row.payment] ?? detail.row.payment)
                      : "—"}
                    {detail.row.paymentStatus ? ` · ${detail.row.paymentStatus}` : ""}
                  </p>
                  {detail.paymentRef ? (
                    <p className="text-xs" style={{ wordBreak: "break-all" }}>
                      {detail.paymentRef}{" "}
                      {detail.paymentProvider === "stripe" ? (
                        <a
                          href={`https://dashboard.stripe.com/search?query=${encodeURIComponent(detail.paymentRef)}`}
                          target="_blank"
                          rel="noopener"
                          className="font-semibold text-orange-dark underline"
                        >
                          open in Stripe ↗
                        </a>
                      ) : null}
                    </p>
                  ) : null}
                </Box>
              </div>

              <h3 className="mt-6 text-xs uppercase tracking-[0.28em] text-gold-dark">History</h3>
              <ol
                className="mt-3"
                style={{
                  borderInlineStart: "2px solid rgba(29,20,16,.15)",
                  paddingInlineStart: 20,
                }}
              >
                {detail.events.map((e) => {
                  const k = KIND[e.kind] ?? { label: e.kind, tone: "plain" as const };
                  return (
                    <li key={e.id} className="relative py-2">
                      <span
                        aria-hidden="true"
                        className="absolute h-3 w-3 rounded-full"
                        style={{
                          insetInlineStart: -27,
                          top: 14,
                          background: DOT[k.tone],
                          border: "2px solid #fffdf8",
                        }}
                      />
                      <p className="text-sm">
                        <time
                          dateTime={e.createdAt.toISOString()}
                          className="tabular-nums text-muted"
                          style={{ marginInlineEnd: 8 }}
                        >
                          {TIME.format(e.createdAt)}
                        </time>
                        <span className="font-semibold">{k.label}</span>
                        {e.summary ? <span className="text-muted"> · {e.summary}</span> : null}
                        <span className="text-xs text-muted"> · {e.actor}</span>
                      </p>
                      {e.payload != null ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-semibold text-orange-dark">
                            Raw data · {exact(e.createdAt)}
                          </summary>
                          <pre
                            className="mt-1 rounded p-3 leading-snug"
                            style={{
                              maxHeight: "24rem",
                              overflow: "auto",
                              background: "#1f1a16",
                              color: "#e8dcc8",
                              fontSize: 11.5,
                            }}
                          >
                            {JSON.stringify(e.payload, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-5 border-t border-ink/10 pt-3 text-xs text-muted">
                🔒 Nobody can edit or delete these entries — not even by deleting the order. They
                are removed automatically after 6 months.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Box({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="border border-ink/10 px-3 py-2.5 text-sm"
      style={{ background: "rgba(255,255,255,.6)" }}
    >
      <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">{title}</p>
      {children}
    </div>
  );
}
