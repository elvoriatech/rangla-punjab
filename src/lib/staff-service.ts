import { getKitchenOrder, listRecentOrders, type KitchenOrder } from "./order-service";
import { ORDER_STATUSES, canTransition } from "./order-status";
import { asUser } from "./tenant";

/**
 * The orders board the restaurant sees inside the guest app.
 *
 * Everything here is a projection of what the dashboard already reads —
 * same service functions, same RLS-scoped queries — reshaped into wire
 * types (ISO strings, integer cents, a precomputed `allowedNext`) so the
 * React Native side never has to reimplement `order-status.ts` to know
 * which buttons to draw.
 */

export interface StaffOrderItem {
  name: string;
  quantity: number;
  priceCents: number;
}

export interface StaffOrderAddress {
  street: string | null;
  zip: string | null;
  city: string | null;
  note: string | null;
}

export interface StaffOrder {
  id: string;
  orderNumber: number;
  status: string;
  /** Every status this order may legally move to, in lifecycle order.
   *  Empty on a finished order. The client renders one button per entry
   *  rather than deriving the chain itself. */
  allowedNext: string[];
  orderType: string;
  tableNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: StaffOrderAddress | null;
  requestedFor: string | null;
  createdAt: string;
  updatedAt: string;
  paymentStatus: string;
  paymentProvider: string | null;
  totalCents: number;
  discountCents: number;
  currency: string;
  items: StaffOrderItem[];
}

/** The stored address is a sparse JSON blob; the wire shape always
 *  carries all four keys so the app can render them unconditionally. */
function toAddress(address: KitchenOrder["deliveryAddress"]): StaffOrderAddress | null {
  if (!address) return null;
  return {
    street: address.street ?? null,
    zip: address.zip ?? null,
    city: address.city ?? null,
    note: address.note ?? null,
  };
}

export function toStaffOrder(order: KitchenOrder): StaffOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    allowedNext: ORDER_STATUSES.filter((to) => canTransition(order.status, to, order.orderType)),
    orderType: order.orderType,
    tableNumber: order.tableNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: toAddress(order.deliveryAddress),
    requestedFor: order.requestedFor ? order.requestedFor.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    paymentStatus: order.paymentStatus,
    paymentProvider: order.paymentProvider,
    totalCents: order.totalCents,
    discountCents: order.discountCents,
    currency: order.currency,
    items: order.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      priceCents: i.priceCents,
    })),
  };
}

/** How much history the board carries behind the live orders. */
const CLOSED_LIMIT = 50;

/**
 * The board's payload: every open order, plus the 50 most recently
 * placed finished ones so the day's history is scrollable. The two are
 * fetched separately on purpose — a busy service must never let closed
 * orders push a live one out of the window.
 *
 * `since` turns the call into a polling delta: only rows written at or
 * after that instant come back.
 */
export async function listStaffOrders(userId: string, since?: Date): Promise<StaffOrder[]> {
  const open = await listRecentOrders(userId, 100, { scope: "open", updatedSince: since });
  const closed = await listRecentOrders(userId, CLOSED_LIMIT, {
    scope: "closed",
    updatedSince: since,
  });
  return [...open, ...closed]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toStaffOrder);
}

/** One order, reshaped — what the status endpoint answers with. */
export async function getStaffOrder(userId: string, orderId: string): Promise<StaffOrder | null> {
  const order = await getKitchenOrder(userId, orderId);
  return order ? toStaffOrder(order) : null;
}

export interface StaffSummary {
  /** Orders the kitchen still owes work on. */
  openOrders: number;
  /** Online payments started but not settled — money to chase. */
  unpaidOnline: number;
  /** Reservations still awaiting a confirm/decline. */
  pendingReservations: number;
}

export async function getStaffSummary(userId: string): Promise<StaffSummary> {
  return asUser(userId, async (tx) => {
    // Sequential, not Promise.all: these share one interactive-transaction
    // connection, and serialising them keeps that explicit.
    const openOrders = await tx.order.count({ where: { status: { not: "done" } } });
    const unpaidOnline = await tx.order.count({ where: { paymentStatus: "pending" } });
    const pendingReservations = await tx.reservation.count({
      where: { deletedAt: null, status: "requested" },
    });
    return { openOrders, unpaidOnline, pendingReservations };
  });
}
