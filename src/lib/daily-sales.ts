import { orderDeleteBlock } from "./order-delete-service";
import { orderLabel } from "./order-label";
import {
  countsAsRevenue,
  matchesPayFilter,
  paymentMethodOf,
  type PaymentMethod,
  type ReportPayFilter,
} from "./report-service";
import { asUser } from "./tenant";

/**
 * One day's sales for the restaurant app (owner, 2026-10-11: "daily sales
 * — the cash orders, the online orders, filter by type"). The same rules
 * as the dashboard's Reports page — what counts as revenue, which payment
 * an order had — read for a single calendar day in the venue's time zone.
 *
 * The cash and online totals always cover the whole day; the payment
 * filter narrows only the list (and its own total), so "Bar" on the
 * filter never makes the online tile read zero.
 */

export interface DailySalesOrder {
  id: string;
  orderNumber: number;
  orderLabel: string;
  placedAt: string;
  status: string;
  orderType: string;
  paymentMethod: PaymentMethod;
  totalCents: number;
  customerName: string | null;
  tableNumber: string | null;
  countsAsRevenue: boolean;
  /** The owner may delete it: a cancelled order nobody paid for. */
  deletable: boolean;
}

export interface DailySales {
  date: string;
  currency: string;
  totals: {
    orders: number;
    grossCents: number;
    cashOrders: number;
    cashCents: number;
    onlineOrders: number;
    onlineCents: number;
  };
  byPaymentMethod: { key: PaymentMethod; orders: number; totalCents: number }[];
  /** The filtered list's own revenue. */
  filtered: { orders: number; totalCents: number };
  orders: DailySalesOrder[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** How far `timeZone` is ahead of UTC at `at`, in ms. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Midnight to midnight of `day` (YYYY-MM-DD) in `timeZone`. */
export function dayBounds(day: string, timeZone: string): { from: Date; to: Date } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const start = (yy: number, mm: number, dd: number): Date => {
    const guess = new Date(Date.UTC(yy, mm - 1, dd));
    // Two passes settle the offset across a DST switch.
    let t = guess.getTime() - zoneOffsetMs(guess, timeZone);
    t = guess.getTime() - zoneOffsetMs(new Date(t), timeZone);
    return new Date(t);
  };
  return { from: start(y, m, d), to: new Date(start(y, m, d + 1).getTime() - 1) };
}

/** Today's date (YYYY-MM-DD) in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function parseSalesDay(raw: string | null | undefined, timeZone: string): string {
  if (raw && ISO_DAY.test(raw) && !Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) return raw;
  return todayIn(timeZone);
}

export async function getDailySales(
  userId: string,
  venueId: string,
  dayRaw: string | null | undefined,
  payFilter: ReportPayFilter = "all",
): Promise<DailySales | null> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: { currency: true, timezone: true },
    });
    if (!venue) return null;
    const timeZone = venue.timezone || "Europe/Berlin";
    const date = parseSalesDay(dayRaw, timeZone);
    const { from, to } = dayBounds(date, timeZone);

    const rows = await tx.order.findMany({
      where: { venueId, createdAt: { gte: from, lte: to } },
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
        customerName: true,
        tableNumber: true,
        giftCardDiscountCents: true,
      },
    });

    const all: DailySalesOrder[] = rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      orderLabel: orderLabel(o),
      placedAt: o.createdAt.toISOString(),
      status: o.status,
      orderType: o.orderType,
      paymentMethod: paymentMethodOf(o.paymentStatus, o.paymentProvider, o.paymentMethod),
      totalCents: o.totalCents,
      customerName: o.customerName,
      tableNumber: o.tableNumber,
      countsAsRevenue: countsAsRevenue(o.paymentStatus, o.status),
      deletable: orderDeleteBlock(o) === null,
    }));

    const revenue = all.filter((o) => o.countsAsRevenue);
    const sum = (list: DailySalesOrder[]): number => list.reduce((s, o) => s + o.totalCents, 0);
    const cash = revenue.filter((o) => o.paymentMethod === "cash");
    const online = revenue.filter((o) => o.paymentMethod !== "cash");

    const methods = new Map<PaymentMethod, { orders: number; totalCents: number }>();
    for (const o of revenue) {
      const row = methods.get(o.paymentMethod) ?? { orders: 0, totalCents: 0 };
      row.orders += 1;
      row.totalCents += o.totalCents;
      methods.set(o.paymentMethod, row);
    }

    const orders = all.filter((o) => matchesPayFilter(o.paymentMethod, payFilter));
    const filteredRevenue = orders.filter((o) => o.countsAsRevenue);

    return {
      date,
      currency: venue.currency,
      totals: {
        orders: revenue.length,
        grossCents: sum(revenue),
        cashOrders: cash.length,
        cashCents: sum(cash),
        onlineOrders: online.length,
        onlineCents: sum(online),
      },
      byPaymentMethod: [...methods.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.totalCents - a.totalCents),
      filtered: { orders: filteredRevenue.length, totalCents: sum(filteredRevenue) },
      orders,
    };
  });
}
