import type { Prisma } from "@prisma/client";
import { createLogger } from "./logger";
import { asTenant } from "./tenant";

const log = createLogger();

/**
 * The order log (owner, 2026-10-14: "save all order history … keep the JSON
 * with exact timestamps, within 6 months we can see it any time").
 *
 * One row per thing that came in for an order or happened to it: the
 * guest's order exactly as it arrived, every payment step and provider
 * message, every status change, the print, the deletion. Rows are
 * append-only (the app role cannot update or delete them) and outlive the
 * order itself; `purge_order_events()` removes them after 6 months.
 *
 * Recording NEVER breaks the thing being recorded: every write is caught
 * and only logged — an order must not fail because its log line did.
 */

export type OrderEventKind =
  | "order.placed"
  | "payment.started"
  | "payment.paid"
  | "payment.failed"
  | "payment.method"
  | "payment.switched_to_cash"
  | "payment.too_late"
  | "payment.superseded_paid"
  | "payment.not_captured"
  | "payment.needs_resolution"
  | "stripe.webhook"
  | "paypal.webhook"
  | "paypal.capture"
  | "order.accepted"
  | "order.status"
  | "order.cancelled"
  | "order.dispatched"
  | "order.delivered"
  | "order.printed"
  | "order.deleted";

export interface OrderEventInput {
  orderId: string;
  venueId: string;
  tenantId: string;
  /** "O-5" — kept on the row because the order may be deleted later. */
  orderLabel?: string | null;
  kind: OrderEventKind;
  /** guest | restaurant | driver | stripe | paypal | system — with an
   *  email or id after a colon where one is known. */
  actor: string;
  summary?: string | null;
  payload?: unknown;
}

/** Keys whose values must never be stored, at any depth. */
const SECRET_KEY =
  /pass(word)?|secret|token|authori[sz]ation|cookie|api[_-]?key|cvc|cvv|card_?number|client_secret/i;

/** A JSON-safe copy of `value` with secrets blanked and size bounded. */
export function redactPayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 8) return "[…]";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactPayload(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactPayload(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function data(ev: OrderEventInput): Prisma.OrderEventUncheckedCreateInput {
  return {
    tenantId: ev.tenantId,
    venueId: ev.venueId,
    orderId: ev.orderId,
    orderLabel: ev.orderLabel ?? null,
    kind: ev.kind,
    actor: ev.actor.slice(0, 200),
    summary: ev.summary ? ev.summary.slice(0, 500) : null,
    payload:
      ev.payload === undefined
        ? undefined
        : (redactPayload(ev.payload) as Prisma.InputJsonValue | undefined),
  };
}

/**
 * Record inside a transaction that already has the tenant set. A failure
 * is swallowed with a SAVEPOINT so it cannot abort the caller's
 * transaction (Postgres aborts the whole transaction on any error).
 */
export async function recordOrderEventTx(
  tx: Prisma.TransactionClient,
  ev: OrderEventInput,
): Promise<void> {
  try {
    await tx.$executeRawUnsafe("SAVEPOINT order_event");
    await tx.orderEvent.create({ data: data(ev) });
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT order_event");
  } catch (err) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT order_event").catch(() => undefined);
    log.warn("order_event.failed", { kind: ev.kind, orderId: ev.orderId, err: String(err) });
  }
}

/** Record on its own (outside any transaction). Never throws. */
export async function recordOrderEvent(ev: OrderEventInput): Promise<void> {
  try {
    await asTenant(ev.tenantId, (tx) => tx.orderEvent.create({ data: data(ev) }));
  } catch (err) {
    log.warn("order_event.failed", { kind: ev.kind, orderId: ev.orderId, err: String(err) });
  }
}

/**
 * Record for an order known only by id: looks up its venue and label in
 * the same tenant first. For call sites that hold just (tenantId, orderId).
 */
export async function recordForOrder(
  tenantId: string,
  orderId: string,
  ev: Omit<OrderEventInput, "tenantId" | "orderId" | "venueId" | "orderLabel">,
): Promise<void> {
  try {
    await asTenant(tenantId, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId },
        select: { venueId: true, orderNumber: true, orderSeries: true },
      });
      // A deleted order is gone from `orders` but not from its log: what
      // still happens to it (a late payment, a refund alert) is appended to
      // the same history, under the label it had.
      const ref = order
        ? {
            venueId: order.venueId,
            orderLabel: order.orderSeries
              ? `${order.orderSeries}-${order.orderNumber}`
              : String(order.orderNumber),
          }
        : await tx.orderEvent.findFirst({
            where: { orderId },
            orderBy: { createdAt: "desc" },
            select: { venueId: true, orderLabel: true },
          });
      if (!ref) return;
      await tx.orderEvent.create({
        data: data({ ...ev, tenantId, orderId, venueId: ref.venueId, orderLabel: ref.orderLabel }),
      });
    });
  } catch (err) {
    log.warn("order_event.failed", { kind: ev.kind, orderId, err: String(err) });
  }
}

/** Did this order ever exist here? True for a deleted order too — its
 *  log outlives it. */
export async function hasOrderHistory(tenantId: string, orderId: string): Promise<boolean> {
  try {
    const row = await asTenant(tenantId, (tx) =>
      tx.orderEvent.findFirst({ where: { orderId }, select: { id: true } }),
    );
    return row !== null;
  } catch {
    return false;
  }
}

/** Remove rows older than 6 months (the only delete there is). */
export async function purgeOldOrderEvents(tenantId: string): Promise<number> {
  try {
    return await asTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ n: number }[]>`SELECT purge_order_events() AS n`;
      return Number(rows[0]?.n ?? 0);
    });
  } catch (err) {
    log.warn("order_event.purge_failed", { err: String(err) });
    return 0;
  }
}

/** "restaurant:owner@example.com" — who on the restaurant's side did it. */
export async function staffActor(userId: string): Promise<string> {
  try {
    const { prisma } = await import("./db");
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return `restaurant:${user?.email ?? userId}`;
  } catch {
    return `restaurant:${userId}`;
  }
}
