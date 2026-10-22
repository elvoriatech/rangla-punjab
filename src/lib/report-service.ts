import { asUser } from "./tenant";

/**
 * Restaurant financial & operations report (ported from the platform's
 * report engine, fitted to this white-label build).
 *
 * Every figure comes from the SNAPSHOTS on the order (item price × qty
 * frozen at placement) — re-running January's report after a price change
 * must give the same numbers. There is NO commission and NO platform fee
 * in this deployment, so the report has none; the money split that
 * matters here is cash-at-counter vs Stripe vs PayPal.
 *
 * VAT: German standard 19% extracted from gross (prices are displayed
 * gross; VAT is included, never added on top). One statutory rate,
 * computed in one place below.
 */

import { vatFromGross } from "./vat";
export { VAT_RATE_BPS, vatFromGross } from "./vat";

export type ReportGranularity = "daily" | "weekly" | "monthly";

export interface ReportRange {
  from: Date;
  to: Date;
}

/** How an order was paid. "stripe" is a plain card; Apple Pay and Google Pay
 *  are told apart from the Stripe payment's own method (owner, 2026-10-11). */
export type PaymentMethod = "cash" | "stripe" | "apple_pay" | "google_pay" | "paypal" | "voucher";

/**
 * The report's payment filter: one method, or "online" for everything that
 * was not cash. "all" (or absent) is the unfiltered report.
 */
export type ReportPayFilter = "all" | "online" | PaymentMethod;

export const PAY_FILTERS: readonly ReportPayFilter[] = [
  "all",
  "cash",
  "online",
  "paypal",
  "apple_pay",
  "google_pay",
  "stripe",
];

export function parsePayFilter(raw: string | null | undefined): ReportPayFilter {
  return (PAY_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as ReportPayFilter) : "all";
}

export const PAY_FILTER_LABELS: Record<ReportPayFilter, string> = {
  all: "Alle",
  cash: "Bar",
  online: "Online (alle)",
  paypal: "PayPal",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  stripe: "Karte",
  voucher: "Gutschein",
};

export function matchesPayFilter(method: PaymentMethod, filter: ReportPayFilter): boolean {
  if (filter === "all") return true;
  if (filter === "online") return method !== "cash";
  return method === filter;
}

export interface ReportOrderRow {
  orderId: string;
  orderNumber: number;
  /** "B" (cash) / "O" (online); null on older orders. */
  orderSeries: string | null;
  placedAt: Date;
  status: string;
  paymentStatus: string;
  orderType: string;
  paymentMethod: PaymentMethod;
  netCents: number;
  vatCents: number;
  totalCents: number;
  /** False for refunded and unfulfilled-unpaid orders; excluded from totals. */
  countsAsRevenue: boolean;
}

export interface PeriodRow {
  key: string;
  label: string;
  orders: number;
  grossCents: number;
  vatCents: number;
}

export interface SplitRow {
  key: string;
  label: string;
  orders: number;
  totalCents: number;
  /** Share of gross revenue, 0-100, one decimal. */
  sharePct: number;
}

export interface TopItemRow {
  name: string;
  quantity: number;
  grossCents: number;
}

export interface ReportSummary {
  orders: number;
  grossCents: number;
  netCents: number;
  vatCents: number;
  avgOrderCents: number;
}

export interface VenueReport {
  venue: { id: string; name: string; currency: string; timezone: string };
  range: ReportRange;
  /** Which payments this report covers ("all" unless the owner filtered). */
  payFilter: ReportPayFilter;
  granularity: ReportGranularity;
  summary: ReportSummary;
  orders: ReportOrderRow[];
  periods: PeriodRow[];
  byPaymentMethod: SplitRow[];
  byOrderType: SplitRow[];
  topItems: TopItemRow[];
  refunds: { count: number; totalCents: number };
}

/** The breakdown granularity follows the length of the range. */
export function granularityFor(range: ReportRange): ReportGranularity {
  const days = Math.floor((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;
  if (days <= 7) return "daily";
  if (days <= 60) return "weekly";
  return "monthly";
}

/**
 * Did this order bring in money?
 * - Paid online: yes. Refunded: no. Fulfilled but not paid online: yes —
 *   that is a cash order. Placed but neither paid nor served: not yet.
 */
export function countsAsRevenue(paymentStatus: string, status: string): boolean {
  if (paymentStatus === "refunded") return false;
  if (paymentStatus === "paid") return true;
  return status === "done";
}

/** Cash vs Stripe vs PayPal, derived from the payment snapshot. */
export function paymentMethodOf(
  paymentStatus: string,
  paymentProvider: string | null,
  stripeMethod?: string | null,
): PaymentMethod {
  if (paymentStatus === "paid" || paymentStatus === "refunded") {
    if (paymentProvider === "paypal") return "paypal";
    if (paymentProvider === "voucher" || paymentProvider === "gift_card") return "voucher";
    if (stripeMethod === "apple_pay") return "apple_pay";
    if (stripeMethod === "google_pay") return "google_pay";
    return "stripe";
  }
  return "cash";
}

export const TYPE_LABELS: Record<string, string> = {
  dine_in: "Im Restaurant",
  takeaway: "Abholung",
  delivery: "Lieferung",
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Bar / im Restaurant",
  stripe: "Karte (Stripe)",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  paypal: "PayPal",
  voucher: "Gutschein / Geschenkkarte",
};

/**
 * Bucket key + label in the VENUE's timezone, not the server's — a report
 * run from anywhere for a Berlin restaurant must group by Berlin days.
 */
function bucketOf(
  at: Date,
  granularity: ReportGranularity,
  timezone: string,
): { key: string; label: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "01";
  const y = get("year");
  const m = get("month");
  const d = get("day");

  if (granularity === "monthly") return { key: `${y}-${m}`, label: `${m}.${y}` };
  if (granularity === "daily") return { key: `${y}-${m}-${d}`, label: `${d}.${m}.${y}` };

  // Weekly: ISO week of the venue-local date.
  const local = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const day = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() + 4 - day);
  const isoYear = local.getUTCFullYear();
  const week = Math.ceil(((local.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1) / 7);
  return { key: `${isoYear}-W${String(week).padStart(2, "0")}`, label: `KW ${week}, ${isoYear}` };
}

function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Build the venue's report for a date range. `asUser` resolves the
 * caller's tenant, so RLS makes reporting on anyone else impossible even
 * with a guessed venue id.
 */
export async function getVenueReport(
  userId: string,
  venueId: string,
  range: ReportRange,
  /** Only these orders — totals, periods, statement and CSV follow it. */
  payFilter: ReportPayFilter = "all",
): Promise<VenueReport | null> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: { id: true, name: true, currency: true, timezone: true },
    });
    if (!venue) return null;

    const rows = await tx.order.findMany({
      where: { venueId, createdAt: { gte: range.from, lte: range.to } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        orderSeries: true,
        createdAt: true,
        status: true,
        paymentStatus: true,
        paymentProvider: true,
        paymentMethod: true,
        orderType: true,
        totalCents: true,
        items: { select: { name: true, priceCents: true, quantity: true } },
      },
    });

    const granularity = granularityFor(range);
    const allOrders: ReportOrderRow[] = rows.map((o) => {
      const vat = vatFromGross(o.totalCents);
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        orderSeries: o.orderSeries,
        placedAt: o.createdAt,
        status: o.status,
        paymentStatus: o.paymentStatus,
        orderType: o.orderType,
        paymentMethod: paymentMethodOf(o.paymentStatus, o.paymentProvider, o.paymentMethod),
        netCents: o.totalCents - vat,
        vatCents: vat,
        totalCents: o.totalCents,
        countsAsRevenue: countsAsRevenue(o.paymentStatus, o.status),
      };
    });

    const orders = allOrders.filter((o) => matchesPayFilter(o.paymentMethod, payFilter));
    const revenue = orders.filter((o) => o.countsAsRevenue);
    const grossCents = revenue.reduce((s, o) => s + o.totalCents, 0);
    const vatCents = revenue.reduce((s, o) => s + o.vatCents, 0);
    const summary: ReportSummary = {
      orders: revenue.length,
      grossCents,
      netCents: grossCents - vatCents,
      vatCents,
      avgOrderCents: revenue.length > 0 ? Math.round(grossCents / revenue.length) : 0,
    };

    const periodMap = new Map<string, PeriodRow>();
    for (const o of revenue) {
      const { key, label } = bucketOf(o.placedAt, granularity, venue.timezone);
      const row = periodMap.get(key) ?? { key, label, orders: 0, grossCents: 0, vatCents: 0 };
      row.orders += 1;
      row.grossCents += o.totalCents;
      row.vatCents += o.vatCents;
      periodMap.set(key, row);
    }
    const periods = [...periodMap.values()].sort((a, b) => a.key.localeCompare(b.key));

    const splitBy = (
      pick: (o: ReportOrderRow) => string,
      label: (k: string) => string,
    ): SplitRow[] => {
      const m = new Map<string, { orders: number; totalCents: number }>();
      for (const o of revenue) {
        const k = pick(o);
        const cur = m.get(k) ?? { orders: 0, totalCents: 0 };
        cur.orders += 1;
        cur.totalCents += o.totalCents;
        m.set(k, cur);
      }
      return [...m.entries()]
        .sort((a, b) => b[1].totalCents - a[1].totalCents)
        .map(([key, v]) => ({
          key,
          label: label(key),
          orders: v.orders,
          totalCents: v.totalCents,
          sharePct: share(v.totalCents, summary.grossCents),
        }));
    };

    // Top dishes, from the item snapshots of revenue orders.
    const itemMap = new Map<string, TopItemRow>();
    const revenueIds = new Set(revenue.map((o) => o.orderId));
    for (const o of rows) {
      if (!revenueIds.has(o.id)) continue;
      for (const i of o.items) {
        const cur = itemMap.get(i.name) ?? { name: i.name, quantity: 0, grossCents: 0 };
        cur.quantity += i.quantity;
        cur.grossCents += i.priceCents * i.quantity;
        itemMap.set(i.name, cur);
      }
    }
    const topItems = [...itemMap.values()].sort((a, b) => b.grossCents - a.grossCents).slice(0, 10);

    const refundRows = orders.filter((o) => o.paymentStatus === "refunded");

    return {
      venue,
      range,
      payFilter,
      granularity,
      summary,
      orders,
      periods,
      byPaymentMethod: splitBy(
        (o) => o.paymentMethod,
        (k) => METHOD_LABELS[k as PaymentMethod] ?? k,
      ),
      byOrderType: splitBy(
        (o) => o.orderType,
        (k) => TYPE_LABELS[k] ?? k,
      ),
      topItems,
      refunds: {
        count: refundRows.length,
        totalCents: refundRows.reduce((s, o) => s + o.totalCents, 0),
      },
    };
  });
}

/** Range presets. `now` is injected so callers and tests agree on "today". */
export function presetRange(
  preset: "this_week" | "this_month" | "last_month",
  now: Date,
): ReportRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (preset === "this_month") {
    return {
      from: new Date(Date.UTC(y, m, 1, 0, 0, 0)),
      to: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)),
    };
  }
  if (preset === "last_month") {
    return {
      from: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)),
      to: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)),
    };
  }
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(y, m, now.getUTCDate() - (day - 1), 0, 0, 0));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { from: monday, to: sunday };
}
