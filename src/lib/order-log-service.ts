import { Prisma } from "@prisma/client";
import { asUser } from "./tenant";

/**
 * Reading the order log (`order-events.ts`) for the dashboard's "Order log"
 * page: a list of orders with their latest state, and one order's full
 * history with the raw JSON of every step.
 */

export type OrderLogFilter = "all" | "payment_open" | "payment_failed" | "deleted";

export const ORDER_LOG_FILTERS: readonly OrderLogFilter[] = [
  "all",
  "payment_open",
  "payment_failed",
  "deleted",
];

export function parseOrderLogFilter(raw: string | undefined): OrderLogFilter {
  return (ORDER_LOG_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as OrderLogFilter)
    : "all";
}

const RAIL_WORD: Record<string, string> = { card: "Card", paypal: "PayPal", cash: "Cash" };

/**
 * What the order was actually paid with, not only what the guest picked at
 * checkout: O-6 was chosen as "card" and the log said "Card" while its
 * payment then ran on PayPal. Same rail → the plain key ("card"); a switch
 * → "PayPal (chose Card)".
 */
function paymentLabel(provider: unknown, intended: string | null): string {
  const actual = provider === "stripe" ? "card" : provider === "paypal" ? "paypal" : null;
  const chosen = intended ?? "cash";
  if (!actual || actual === chosen) return chosen;
  return `${RAIL_WORD[actual] ?? actual} (chose ${RAIL_WORD[chosen] ?? chosen})`;
}

export interface OrderLogRow {
  orderId: string;
  label: string;
  /** When the first event of the order was recorded. */
  firstAt: Date;
  lastAt: Date;
  guest: string | null;
  orderType: string | null;
  payment: string | null;
  channel: string | null;
  totalCents: number | null;
  /** The order as it is NOW: null when it was deleted. */
  status: string | null;
  paymentStatus: string | null;
  deleted: boolean;
  failed: boolean;
}

export interface OrderLogEvent {
  id: string;
  kind: string;
  actor: string;
  summary: string | null;
  payload: unknown;
  createdAt: Date;
}

export interface OrderLogDetail {
  row: OrderLogRow;
  events: OrderLogEvent[];
  /** The guest's details and dishes: from the live order, or — once it
   *  was deleted — from the copy the log kept. */
  guest: {
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    table: string | null;
    locale: string | null;
  };
  items: { quantity: number; name: string; priceCents: number }[];
  paymentRef: string | null;
  paymentProvider: string | null;
}

type EventRow = {
  id: string;
  order_id: string;
  order_label: string | null;
  kind: string;
  actor: string;
  summary: string | null;
  payload: unknown;
  createdAt: Date;
};

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The guest's order as it arrived (the `order.placed` payload). */
function receivedOf(events: EventRow[]): Record<string, unknown> {
  const placed = events.find((e) => e.kind === "order.placed");
  return asRecord(asRecord(placed?.payload).received);
}

/**
 * Orders with log entries in [from, to), newest first, optionally matching
 * `q` anywhere in their label or raw JSON (name, phone, email, Stripe ref…).
 */
export async function listOrderLog(
  userId: string,
  opts: { from: Date; to: Date; q?: string; filter: OrderLogFilter; limit?: number },
): Promise<OrderLogRow[]> {
  const q = opts.q?.trim() ?? "";
  return asUser(userId, async (tx) => {
    // The orders in the window (or matching the search), by latest event.
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const ids = await tx.$queryRaw<{ order_id: string; last_at: Date }[]>(
      q
        ? Prisma.sql`SELECT order_id, max("createdAt") AS last_at FROM order_events
            WHERE order_label ILIKE ${like} OR order_id = ${q} OR payload::text ILIKE ${like}
            GROUP BY order_id ORDER BY last_at DESC LIMIT ${opts.limit ?? 200}`
        : Prisma.sql`SELECT order_id, max("createdAt") AS last_at FROM order_events
            WHERE "createdAt" >= ${opts.from} AND "createdAt" < ${opts.to}
            GROUP BY order_id ORDER BY last_at DESC LIMIT ${opts.limit ?? 200}`,
    );
    if (ids.length === 0) return [];
    const orderIds = ids.map((r) => r.order_id);
    const [events, orders] = await Promise.all([
      tx.$queryRaw<
        EventRow[]
      >`SELECT id, order_id, order_label, kind, actor, summary, payload, "createdAt"
        FROM order_events WHERE order_id IN (${Prisma.join(orderIds)}) ORDER BY "createdAt" ASC`,
      tx.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          paymentProvider: true,
          totalCents: true,
          customerName: true,
          tableNumber: true,
        },
      }),
    ]);
    const live = new Map(orders.map((o) => [o.id, o]));
    const byOrder = new Map<string, EventRow[]>();
    for (const e of events) byOrder.set(e.order_id, [...(byOrder.get(e.order_id) ?? []), e]);

    const rows = orderIds.map((id): OrderLogRow => {
      const evs = byOrder.get(id) ?? [];
      const rec = receivedOf(evs);
      const order = live.get(id);
      const placed = evs.find((e) => e.kind === "order.placed");
      const computed = asRecord(asRecord(placed?.payload).computed);
      const label = [...evs].reverse().find((e) => e.order_label)?.order_label ?? id.slice(0, 8);
      return {
        orderId: id,
        label,
        firstAt: evs[0]?.createdAt ?? new Date(0),
        lastAt: evs[evs.length - 1]?.createdAt ?? new Date(0),
        guest:
          order?.customerName ??
          str(rec.customerName) ??
          (order?.tableNumber ? `Table ${order.tableNumber}` : str(rec.tableNumber)),
        orderType: str(rec.orderType),
        payment: paymentLabel(order?.paymentProvider, str(rec.intendedPayment)),
        channel: str(asRecord(placed?.payload).channel),
        totalCents:
          order?.totalCents ??
          (typeof computed.totalCents === "number" ? computed.totalCents : null),
        status: order?.status ?? null,
        paymentStatus: order?.paymentStatus ?? null,
        deleted: !order && evs.some((e) => e.kind === "order.deleted"),
        failed: order?.paymentStatus === "failed" || evs.some((e) => e.kind === "payment.failed"),
      };
    });
    return rows.filter((r) =>
      opts.filter === "deleted"
        ? r.deleted
        : opts.filter === "payment_open"
          ? r.paymentStatus === "pending"
          : opts.filter === "payment_failed"
            ? r.failed
            : true,
    );
  });
}

/** One order's full history, oldest first. Null when it has no log. */
export async function getOrderLog(userId: string, orderId: string): Promise<OrderLogDetail | null> {
  return asUser(userId, async (tx) => {
    const events = await tx.$queryRaw<EventRow[]>`SELECT id, order_id, order_label, kind, actor,
      summary, payload, "createdAt" FROM order_events WHERE order_id = ${orderId}
      ORDER BY "createdAt" ASC`;
    if (events.length === 0) return null;
    const order = await tx.order.findFirst({
      where: { id: orderId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    const rec = receivedOf(events);
    const deletedEv = events.find((e) => e.kind === "order.deleted");
    const snap = asRecord(asRecord(deletedEv?.payload).order);
    const src = order ? (order as unknown as Record<string, unknown>) : snap;
    const addr = asRecord(src.deliveryAddress ?? rec.address);
    const addressLine = [
      str(addr.street),
      [str(addr.zip), str(addr.city)].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");
    const itemsSrc = (order?.items ?? (Array.isArray(snap.items) ? snap.items : [])) as {
      quantity: number;
      name: string;
      priceCents: number;
    }[];
    const placed = events.find((e) => e.kind === "order.placed");
    const computed = asRecord(asRecord(placed?.payload).computed);
    return {
      row: {
        orderId,
        label: [...events].reverse().find((e) => e.order_label)?.order_label ?? orderId.slice(0, 8),
        firstAt: events[0]!.createdAt,
        lastAt: events[events.length - 1]!.createdAt,
        guest: str(src.customerName) ?? str(rec.customerName),
        orderType: str(src.orderType) ?? str(rec.orderType),
        payment: paymentLabel(src.paymentProvider, str(rec.intendedPayment)),
        channel: str(asRecord(placed?.payload).channel),
        totalCents:
          order?.totalCents ??
          (typeof snap.totalCents === "number"
            ? snap.totalCents
            : typeof computed.totalCents === "number"
              ? computed.totalCents
              : null),
        status: order?.status ?? null,
        paymentStatus: order?.paymentStatus ?? null,
        deleted: !order && Boolean(deletedEv),
        failed:
          order?.paymentStatus === "failed" || events.some((e) => e.kind === "payment.failed"),
      },
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        actor: e.actor,
        summary: e.summary,
        payload: e.payload,
        createdAt: e.createdAt,
      })),
      guest: {
        name: str(src.customerName) ?? str(rec.customerName),
        phone: str(src.customerPhone) ?? str(rec.customerPhone),
        email: str(src.customerEmail) ?? str(rec.customerEmail),
        address: addressLine || null,
        table: str(src.tableNumber) ?? str(rec.tableNumber),
        locale: str(src.locale) ?? str(rec.locale),
      },
      items: itemsSrc.map((i) => ({
        quantity: i.quantity,
        name: i.name,
        priceCents: i.priceCents,
      })),
      paymentRef: str(src.paymentRef),
      paymentProvider: str(src.paymentProvider),
    };
  });
}
