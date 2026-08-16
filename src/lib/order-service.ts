import { z } from "zod";
import { canTransition, isOrderStatus } from "./order-status";
import { OFFER_GRACE_MINUTES, effectiveItemPrice } from "./offer-pricing";
import { paypalAvailable } from "./paypal";
import { Prisma } from "@prisma/client";
import { asTenant, asUser } from "./tenant";
import { signReceiptToken } from "./receipt-token";
import { resolveTenantAccess } from "./plan-state";
import { openState, parseOpeningHours, todayLocalTimeToDate } from "./opening-hours";
import {
  deliveryQuote,
  effectiveOrdering,
  orderTypeAllowed,
  parseOrderingConfig,
  type OrderType,
} from "./ordering-config";

/**
 * Guest self-ordering. No session, no payment — the venue's public slug
 * resolves the tenant, the items are validated against the PUBLISHED menu
 * version, and every price is read from the database. The client sends
 * only (itemId, quantity); a tampered payload can change what is ordered,
 * never what it costs.
 */

export const placeOrderSchema = z
  .object({
    items: z
      .array(
        z.object({
          itemId: z.string().min(1).max(64),
          quantity: z.number().int().min(1).max(50),
        }),
      )
      .min(1)
      .max(50),
    orderType: z.enum(["dine_in", "takeaway", "delivery"]).default("dine_in"),
    // Venue-local "HH:MM" for today (pickup/delivery). Absent = ASAP.
    requestedTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    tableNumber: z.string().trim().max(20).optional(),
    customerName: z.string().trim().max(80).optional(),
    customerPhone: z.string().trim().max(30).optional(),
    address: z
      .object({
        street: z.string().trim().min(3).max(120),
        zip: z.string().trim().min(3).max(10),
        // Optional: guests no longer type the city — it's derived from
        // the venue's delivery-area row for the selected ZIP.
        city: z.string().trim().max(80).optional(),
        note: z.string().trim().max(200).optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Takeaway/delivery orders need a person to hand the food to; the
    // phone is the "it's ready" / no-show channel. Dine-in needs neither.
    if (data.orderType !== "dine_in") {
      if (!data.customerName) {
        ctx.addIssue({ code: "custom", path: ["customerName"], message: "required" });
      }
      if (!data.customerPhone) {
        ctx.addIssue({ code: "custom", path: ["customerPhone"], message: "required" });
      }
    }
    if (data.orderType === "delivery" && !data.address) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "required" });
    }
  });

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

export interface PlacedOrder {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  currency: string;
  receiptToken: string;
}

export type PlaceOrderResult =
  | { ok: true; value: PlacedOrder }
  | {
      ok: false;
      error:
        | "invalid"
        | "unknown_items"
        | "not_published"
        | "type_not_available"
        | "outside_delivery_area"
        | "below_delivery_minimum"
        | "invalid_time";
    };

export async function placeOrder(
  context: { tenantId: string; venueId: string; publishedVersionId: string | null },
  raw: unknown,
  opts?: { customerId?: string | null },
): Promise<PlaceOrderResult> {
  const parsed = placeOrderSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!context.publishedVersionId) return { ok: false, error: "not_published" };
  const input = parsed.data;

  // Collapse duplicate lines (two "add" taps of the same dish) into one.
  const wanted = new Map<string, number>();
  for (const line of input.items) {
    wanted.set(line.itemId, Math.min(50, (wanted.get(line.itemId) ?? 0) + line.quantity));
  }

  return asTenant(context.tenantId, async (tx) => {
    // Entitlement + owner-switch gate. Server-side on purpose: the
    // client renders only allowed modes, but a forged POST must hit the
    // same wall (same philosophy as recomputing prices below).
    const [tenant, subscription, venue] = await Promise.all([
      tx.tenant.findFirstOrThrow({
        select: {
          plan: true,
          entitlementOverrides: true,
          createdAt: true,
          status: true,
          deletedAt: true,
        },
      }),
      tx.subscription.findFirst({
        where: { deletedAt: null },
        select: { planCode: true, status: true, trialEnd: true, currentPeriodEnd: true },
      }),
      tx.venue.findFirstOrThrow({
        where: { id: context.venueId },
        select: { ordering: true, hours: true, timezone: true },
      }),
    ]);
    const access = resolveTenantAccess(tenant, subscription);
    const mode = effectiveOrdering(access.entitlements, parseOrderingConfig(venue.ordering));
    const orderType: OrderType = input.orderType;
    if (!orderTypeAllowed(mode, orderType)) {
      return { ok: false, error: "type_not_available" as const };
    }
    // Requested fulfilment time: venue-local HH:MM for today, only for
    // pickup/delivery, never in the past, and inside opening hours when
    // the venue has them configured. Client offers only valid slots; a
    // forged or stale time hits this wall.
    let requestedFor: Date | null = null;
    if (input.requestedTime && orderType !== "dine_in") {
      const hours = parseOpeningHours(venue.hours);
      const at = todayLocalTimeToDate(venue.timezone, input.requestedTime, new Date(), hours);
      if (!at) return { ok: false, error: "invalid_time" as const };
      if (hours.configured) {
        const state = openState(hours, venue.timezone, at);
        if (!(state.configured && state.open)) {
          return { ok: false, error: "invalid_time" as const };
        }
      }
      requestedFor = at;
    }

    // Per-area validation happens after totals are known (fee and
    // minimum depend on the guest's ZIP row) — see deliveryQuote below.

    const items = await tx.item.findMany({
      where: {
        id: { in: [...wanted.keys()] },
        deletedAt: null,
        isAvailable: true,
        category: { menuVersionId: context.publishedVersionId! },
      },
      select: {
        id: true,
        name: true,
        priceCents: true,
        offerPriceCents: true,
        offerStartsAt: true,
        offerEndsAt: true,
        offerWeekly: true,
        currency: true,
      },
    });
    // Every requested id must resolve to an orderable published item —
    // a partial order surprises the guest at the till, so reject instead.
    if (items.length !== wanted.size) return { ok: false, error: "unknown_items" as const };

    // Offer pricing with the guest-favouring grace: the edge-cached menu can
    // be up to ~5 min stale, so an offer active at ANY instant in the last
    // OFFER_GRACE_MINUTES is honoured — the guest never pays more than the
    // page showed; the worst case is the ordinary base price.
    const venueTz = (
      await tx.venue.findFirstOrThrow({
        where: { id: context.venueId },
        select: { timezone: true },
      })
    ).timezone;
    const nowInstant = new Date();
    const graceInstant = new Date(nowInstant.getTime() - OFFER_GRACE_MINUTES * 60_000);
    const priceOf = (item: (typeof items)[number]): { unit: number; base: number | null } => {
      const now = effectiveItemPrice(item, venueTz, nowInstant);
      const grace = effectiveItemPrice(item, venueTz, graceInstant);
      const unit = Math.min(now.unitPriceCents, grace.unitPriceCents);
      return { unit, base: unit < item.priceCents ? item.priceCents : null };
    };

    const currency = items[0]!.currency;
    const itemsCents = items.reduce(
      (sum, item) => sum + priceOf(item).unit * wanted.get(item.id)!,
      0,
    );
    // Delivery pricing is derived SERVER-SIDE from the guest's ZIP: the
    // matching area row sets fee + minimum (free-delivery threshold can
    // zero the fee); a ZIP outside the configured areas is rejected.
    let feeCents = 0;
    if (orderType === "delivery") {
      const quote = deliveryQuote(mode, input.address!.zip, itemsCents);
      if (!quote) return { ok: false, error: "outside_delivery_area" as const };
      if (itemsCents < quote.minCents) {
        return { ok: false, error: "below_delivery_minimum" as const };
      }
      feeCents = quote.feeCents;
      // The area row is the authority on the locality: patch it into the
      // stored address so kitchen tickets and receipts always show the
      // restaurant's own name for the area, whatever the client sent.
      if (quote.locality) input.address!.city = quote.locality;
    }
    const totalCents = itemsCents + feeCents;
    const customerId = opts?.customerId ?? null;

    // Per-venue running receipt number. The unique index backstops the
    // read-then-write race; on collision we recompute and try again.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const max = await tx.order.aggregate({
        where: { venueId: context.venueId },
        _max: { orderNumber: true },
      });
      const orderNumber = (max._max.orderNumber ?? 0) + 1;
      try {
        const order = await tx.order.create({
          data: {
            tenantId: context.tenantId,
            venueId: context.venueId,
            orderNumber,
            orderType,
            customerId,
            tableNumber: orderType === "dine_in" ? input.tableNumber || null : null,
            customerName: orderType === "dine_in" ? null : input.customerName || null,
            customerPhone: orderType === "dine_in" ? null : input.customerPhone || null,
            deliveryAddress: orderType === "delivery" && input.address ? input.address : undefined,
            requestedFor,
            totalCents,
            currency,
            items: {
              create: [
                ...items.map((item) => {
                  const priced = priceOf(item);
                  return {
                    tenantId: context.tenantId,
                    itemId: item.id,
                    name: item.name,
                    priceCents: priced.unit,
                    basePriceCents: priced.base,
                    quantity: wanted.get(item.id)!,
                  };
                }),
                // Delivery fee rides as a snapshot line (itemId null) so
                // receipt + kitchen totals always add up line-by-line.
                ...(feeCents > 0
                  ? [
                      {
                        tenantId: context.tenantId,
                        itemId: null,
                        name: "Delivery fee",
                        priceCents: feeCents,
                        quantity: 1,
                      },
                    ]
                  : []),
              ],
            },
          },
          select: { id: true },
        });
        return {
          ok: true as const,
          value: {
            orderId: order.id,
            orderNumber,
            totalCents,
            currency,
            receiptToken: signReceiptToken(order.id, context.tenantId),
          },
        };
      } catch (err) {
        const isUniqueRace =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
        if (!isUniqueRace || attempt === 2) throw err;
      }
    }
    // Unreachable — the loop either returns or throws.
    return { ok: false, error: "invalid" as const };
  });
}

export interface OrderFulfilment {
  orderType: string;
  customerName: string | null;
  customerPhone: string | null;
  requestedFor: Date | null;
  deliveryAddress: { street?: string; zip?: string; city?: string; note?: string } | null;
}

export interface ReceiptOrder extends OrderFulfilment {
  id: string;
  orderNumber: number;
  tableNumber: string | null;
  paymentStatus: string;
  totalCents: number;
  currency: string;
  createdAt: Date;
  venue: { name: string; slug: string; logoKey: string | null };
  items: { name: string; priceCents: number; quantity: number }[];
}

/** Load one order for its receipt. Caller must have verified the token. */
export async function getOrderForReceipt(
  tenantId: string,
  orderId: string,
): Promise<ReceiptOrder | null> {
  return asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        tableNumber: true,
        orderType: true,
        customerName: true,
        customerPhone: true,
        requestedFor: true,
        deliveryAddress: true,
        paymentStatus: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        venue: { select: { name: true, slug: true, branding: true } },
        items: {
          select: { name: true, priceCents: true, quantity: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!order) return null;
    const branding = order.venue.branding as { logoKey?: unknown } | null;
    return {
      ...order,
      deliveryAddress: order.deliveryAddress as ReceiptOrder["deliveryAddress"],
      venue: {
        name: order.venue.name,
        slug: order.venue.slug,
        logoKey: typeof branding?.logoKey === "string" ? branding.logoKey : null,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Kitchen view                                                        */
/* ------------------------------------------------------------------ */

export interface KitchenOrder extends OrderFulfilment {
  id: string;
  orderNumber: number;
  tableNumber: string | null;
  status: string;
  paymentStatus: string;
  totalCents: number;
  currency: string;
  createdAt: Date;
  items: { name: string; priceCents: number; quantity: number }[];
}

/** Narrow Prisma's JsonValue to the address shape we stored. */
function withAddress<T extends { deliveryAddress: unknown }>(
  order: T,
): T & { deliveryAddress: KitchenOrder["deliveryAddress"] } {
  return { ...order, deliveryAddress: order.deliveryAddress as KitchenOrder["deliveryAddress"] };
}

/** Newest orders for the kitchen screen. Any member of the tenant
 *  (owner or staff) can read them. */
export async function listRecentOrders(userId: string, limit = 50): Promise<KitchenOrder[]> {
  const rows = await asUser(userId, (tx) =>
    tx.order.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
      select: {
        id: true,
        orderNumber: true,
        tableNumber: true,
        orderType: true,
        customerName: true,
        customerPhone: true,
        requestedFor: true,
        deliveryAddress: true,
        status: true,
        paymentStatus: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        items: {
          select: { name: true, priceCents: true, quantity: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  );
  return rows.map(withAddress);
}

/** One order for the printable ticket. Same tenant scoping as the list. */
export async function getKitchenOrder(
  userId: string,
  orderId: string,
): Promise<KitchenOrder | null> {
  const row = await asUser(userId, (tx) =>
    tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        tableNumber: true,
        orderType: true,
        customerName: true,
        customerPhone: true,
        requestedFor: true,
        deliveryAddress: true,
        status: true,
        paymentStatus: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        items: {
          select: { name: true, priceCents: true, quantity: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  );
  return row ? withAddress(row) : null;
}

/** Kitchen ticked an order off. Idempotent — marking twice is fine. */
export async function markOrderDone(userId: string, orderId: string): Promise<{ ok: boolean }> {
  return asUser(userId, async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: orderId },
      data: { status: "done" },
    });
    return { ok: updated.count > 0 };
  });
}

/**
 * Advance an order along the lifecycle. The pure `canTransition` is the
 * authority; the optimistic `status: current` guard makes two staff
 * tapping at once resolve to one winner instead of a lost update.
 */
export async function advanceOrderStatus(
  userId: string,
  orderId: string,
  to: string,
): Promise<{ ok: boolean }> {
  if (!isOrderStatus(to)) return { ok: false };
  return asUser(userId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: { status: true, orderType: true },
    });
    if (!order || !canTransition(order.status, to, order.orderType)) return { ok: false };
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: to },
    });
    return { ok: updated.count > 0 };
  });
}

export interface OrderTracking {
  id: string;
  orderNumber: number;
  status: string;
  orderType: string;
  paymentStatus: string;
  totalCents: number;
  currency: string;
  requestedFor: Date | null;
  createdAt: Date;
  tableNumber: string | null;
  items: { name: string; quantity: number; priceCents: number; basePriceCents: number | null }[];
  venue: { timezone: string; branding: unknown };
}

/** Token-authorized guest read — powers the tracking page and the v1 API. */
export async function getOrderTracking(
  tenantId: string,
  orderId: string,
): Promise<OrderTracking | null> {
  return asTenant(tenantId, async (tx) =>
    tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        orderType: true,
        paymentStatus: true,
        totalCents: true,
        currency: true,
        requestedFor: true,
        createdAt: true,
        tableNumber: true,
        items: {
          select: { name: true, quantity: true, priceCents: true, basePriceCents: true },
          orderBy: { createdAt: "asc" },
        },
        venue: { select: { timezone: true, branding: true } },
      },
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Owner analytics                                                     */
/* ------------------------------------------------------------------ */

export interface OrderStats {
  today: { orders: number; revenueCents: number };
  month: { orders: number; revenueCents: number };
  /** Highest-revenue day of the current month, or null with no sales. */
  bestDay: { date: string; orders: number; revenueCents: number } | null;
}

/**
 * Today / current-month totals + the month's best day, bucketed in the
 * venue's timezone (a 00:30 order belongs to the evening's business day
 * as the guest experienced it — we keep it simple and bucket by civil
 * date). One indexed query over ~45 days, aggregated in JS so timezone
 * day-boundaries never have to be expressed in SQL.
 */
export async function getOrderStats(
  userId: string,
  timeZone = "Europe/Berlin",
): Promise<OrderStats> {
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const rows = await asUser(userId, (tx) =>
    tx.order.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, totalCents: true },
    }),
  );

  // en-CA gives ISO-style yyyy-mm-dd, stable for keys and sorting.
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" });
  const todayKey = dayKey.format(new Date());
  const monthKey = todayKey.slice(0, 7);

  const byDay = new Map<string, { orders: number; revenueCents: number }>();
  for (const row of rows) {
    const key = dayKey.format(row.createdAt);
    if (!key.startsWith(monthKey)) continue;
    const bucket = byDay.get(key) ?? { orders: 0, revenueCents: 0 };
    bucket.orders += 1;
    bucket.revenueCents += row.totalCents;
    byDay.set(key, bucket);
  }

  const month = { orders: 0, revenueCents: 0 };
  let bestDay: OrderStats["bestDay"] = null;
  for (const [date, bucket] of byDay) {
    month.orders += bucket.orders;
    month.revenueCents += bucket.revenueCents;
    if (!bestDay || bucket.revenueCents > bestDay.revenueCents) {
      bestDay = { date, ...bucket };
    }
  }

  return {
    today: byDay.get(todayKey) ?? { orders: 0, revenueCents: 0 },
    month,
    bestDay,
  };
}

/* ------------------------------------------------------------------ */
/* Public ordering modes                                               */
/* ------------------------------------------------------------------ */

export interface PublicVenueAccess {
  /** False once a lapsed tenant's grace period has run out — the menu
   *  page then 404s instead of rendering a stale menu. */
  menuVisible: boolean;
  modes: import("./ordering-config").EffectiveOrdering;
  /** Guests can pay online by card: Connect charges enabled (or own keys). */
  onlinePayment: boolean;
  /** Guests can pay with PayPal (restaurant's own account; fake in dev). */
  paypalPayment: boolean;
}

/** Effective guest-facing access (plan/trial state ∧ owner switches),
 *  resolved under the tenant GUC. The drawer renders only these; the
 *  POST path re-derives them anyway. */
export async function getPublicVenueAccess(
  tenantId: string,
  venueId: string,
): Promise<PublicVenueAccess> {
  return asTenant(tenantId, async (tx) => {
    const [tenant, subscription, venue] = await Promise.all([
      tx.tenant.findFirstOrThrow({
        select: {
          plan: true,
          entitlementOverrides: true,
          createdAt: true,
          status: true,
          deletedAt: true,
          stripeChargesEnabled: true,
        },
      }),
      tx.subscription.findFirst({
        where: { deletedAt: null },
        select: { planCode: true, status: true, trialEnd: true, currentPeriodEnd: true },
      }),
      tx.venue.findFirstOrThrow({ where: { id: venueId }, select: { ordering: true } }),
    ]);
    const access = resolveTenantAccess(tenant, subscription);
    return {
      menuVisible: access.menuVisible,
      modes: effectiveOrdering(access.entitlements, parseOrderingConfig(venue.ordering)),
      // P2-3: online payment no longer requires a subscription — only that
      // the restaurant's connected account has charges enabled.
      onlinePayment: tenant.stripeChargesEnabled,
      paypalPayment: paypalAvailable(),
    };
  });
}
