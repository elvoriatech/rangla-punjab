import { z } from "zod";
import { customerProfileUpdateData, type CustomerProfilePatch } from "./customer-auth";
import { canTransition, isOrderStatus } from "./order-status";
import { OFFER_GRACE_MINUTES, effectiveItemPrice } from "./offer-pricing";
import { paypalAvailable } from "./paypal";
import { stripeDirectChargeAvailable } from "./stripe";
import { asTenant, asUser } from "./tenant";
import { signReceiptToken } from "./receipt-token";
import { resolveTenantAccess } from "./plan-state";
import { openState, parseOpeningHours, todayLocalTimeToDate } from "./opening-hours";
import { parseLoyaltyConfig } from "./loyalty-config";
import { attachVoucherToOrder, claimArmedVoucher } from "./loyalty-service";
import {
  deliveryQuote,
  DELIVERY_FEE_LINE_NAME,
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

/**
 * `orders.payment_provider` for an order a loyalty reward settled in
 * full. It sits beside "stripe" and "paypal" because it answers the same
 * question — how the money arrived — and every surface that reads the
 * provider (kitchen ticket, receipt, dashboard badge) has to be able to
 * say "nothing to collect" without inventing a payment that never
 * happened.
 */
export const VOUCHER_PROVIDER = "voucher";

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
    /**
     * Idempotency key for THIS submit attempt, minted by the client and
     * reused on every retry of the same basket.
     *
     * A lost response is indistinguishable from a failure at the client:
     * the order may already be committed. Without a key the guest's
     * second tap creates a second real order and the kitchen cooks the
     * food twice. With one, the retry returns the first order.
     *
     * Optional so existing callers and seeds keep working; the client
     * must mint a FRESH key whenever the basket changes, or it would be
     * handed back the previous order.
     */
    clientRequestId: z.string().min(8).max(200).optional(),
    // Venue-local "HH:MM" for today (pickup/delivery). Absent = ASAP.
    requestedTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    tableNumber: z.string().trim().max(20).optional(),
    customerName: z.string().trim().max(80).optional(),
    customerPhone: z.string().trim().max(30).optional(),
    /** Optional, any order type: the receipt is emailed here. "" = none. */
    customerEmail: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().email().max(120).optional(),
    ),
    /**
     * How the guest said they will pay, so the server knows whether the
     * receipt email goes out now (cash) or once the online payment
     * settles (card / paypal — sent from markOrderPaid). Not stored; an
     * absent value means cash.
     */
    intendedPayment: z.enum(["cash", "card", "paypal"]).optional(),
    /**
     * "Spend the reward I armed in the app on this order."
     *
     * Redemption is pull-only on purpose: the guest arms a voucher in the
     * app, and only a request that ASKS for it consumes one. The website
     * never sends this flag, so a web order can never quietly eat the free
     * meal the guest was keeping for a takeaway.
     *
     * Advisory, not a promise: if nothing armable is on the account by the
     * time this lands (spent on another device, expired overnight), the
     * order is placed at full price rather than refused. The app's preview
     * comes from `/api/v1/me/loyalty`; the server is the authority.
     */
    redeemVoucher: z.boolean().optional(),
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
  /** What the guest owes: the basket AFTER any reward discount. Always
   *  equal to `chargedCents` — it keeps its name so clients written
   *  before redemption existed keep charging the right amount. */
  totalCents: number;
  currency: string;
  receiptToken: string;
  /** The reward applied to this order, 0 when none was. */
  discountCents: number;
  /** Explicit alias of `totalCents`: what Stripe / PayPal / the till
   *  collect. Named so the app never has to guess which of the two
   *  numbers the payment sheet should use. */
  chargedCents: number;
  /** The reward covered the whole bill: the order is already `paid`
   *  (provider `voucher`), the kitchen has it, and no payment step is
   *  needed — the app must NOT open a payment sheet. */
  paidByVoucher: boolean;
  /**
   * True when this response replayed an order an earlier attempt with
   * the same `clientRequestId` had already created. Callers can treat it
   * exactly like a fresh success — it exists so the API can report 200
   * instead of 201, and so tests can assert no duplicate was written.
   */
  replayed?: boolean;
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
    const [tenant, venue] = await Promise.all([
      tx.tenant.findFirstOrThrow({
        select: {
          plan: true,
          entitlementOverrides: true,
          createdAt: true,
          status: true,
          deletedAt: true,
        },
      }),
      tx.venue.findFirstOrThrow({
        where: { id: context.venueId },
        select: { ordering: true, hours: true, timezone: true },
      }),
    ]);
    const access = resolveTenantAccess(tenant);
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
    // What the basket is worth before any reward is applied.
    const grossCents = itemsCents + feeCents;
    const customerId = opts?.customerId ?? null;

    // Per-venue running receipt number. Serialised with a
    // transaction-scoped advisory lock: two guests checking out at the
    // same second both read the same MAX(order_number) and the second
    // INSERT hit the (venue_id, order_number) unique index.
    //
    // This used to be a 3-attempt retry on P2002, which cannot work
    // inside a transaction — Postgres aborts the whole transaction on
    // the failed INSERT, so the retry's next statement came back 25P02
    // ("current transaction is aborted") and fell straight through to a
    // 500. Measured before this fix: 6 of 8 simultaneous orders failed.
    //
    // The lock is keyed on the venue, so branches never block each
    // other, and Postgres releases it at COMMIT or ROLLBACK — there is
    // no unlock to leak. Contention is one restaurant's checkout rate,
    // where serialising costs nothing.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${context.venueId})::bigint)`;

    // Replay check. Safe to do as a plain read because the advisory
    // lock above already serialises this venue: a concurrent retry with
    // the same key is waiting on the lock, not racing us. The unique
    // index on (venue_id, client_request_id) is the backstop if a future
    // caller ever skips the lock.
    const clientRequestId = input.clientRequestId ?? null;
    if (clientRequestId) {
      const existing = await tx.order.findFirst({
        where: { venueId: context.venueId, clientRequestId },
        select: {
          id: true,
          orderNumber: true,
          totalCents: true,
          currency: true,
          discountCents: true,
          paymentProvider: true,
        },
      });
      if (existing) {
        // The STORED totals win, not the ones just recomputed — the
        // guest is owed exactly the order that was created. That matters
        // doubly with a reward: re-running the claim would spend a
        // second voucher for one basket.
        return {
          ok: true as const,
          value: {
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            totalCents: existing.totalCents,
            currency: existing.currency,
            receiptToken: signReceiptToken(existing.id, context.tenantId),
            discountCents: existing.discountCents,
            chargedCents: existing.totalCents,
            paidByVoucher: existing.paymentProvider === VOUCHER_PROVIDER,
            replayed: true as const,
          },
        };
      }
    }

    // Reward redemption. Deliberately AFTER the advisory lock and the
    // replay check: the lock serialises this venue's checkouts, so the
    // claim below cannot interleave with another order of the guest's,
    // and a retry of a submit that already succeeded never reaches it.
    const claim =
      input.redeemVoucher && customerId
        ? await claimArmedVoucher(tx, customerId, grossCents)
        : null;
    const discountCents = claim?.discountCents ?? 0;
    // The CHARGED total. Line items keep their own prices — the receipt
    // shows the reward as its own row rather than quietly repricing the
    // food, because the kitchen and the tax record both need the real
    // menu prices.
    const totalCents = grossCents - discountCents;
    // A reward that covers the whole bill leaves nothing to collect, so
    // the order is born settled: the kitchen ticket and the receipt go
    // out at once, exactly as they do for an order paid online, and no
    // payment sheet is ever opened for €0.00.
    const paidByVoucher = discountCents > 0 && totalCents === 0;

    const max = await tx.order.aggregate({
      where: { venueId: context.venueId },
      _max: { orderNumber: true },
    });
    const orderNumber = (max._max.orderNumber ?? 0) + 1;
    const order = await tx.order.create({
      data: {
        tenantId: context.tenantId,
        venueId: context.venueId,
        orderNumber,
        clientRequestId,
        orderType,
        customerId,
        tableNumber: orderType === "dine_in" ? input.tableNumber || null : null,
        customerName: orderType === "dine_in" ? null : input.customerName || null,
        customerPhone: orderType === "dine_in" ? null : input.customerPhone || null,
        customerEmail: input.customerEmail?.toLowerCase() || null,
        deliveryAddress: orderType === "delivery" && input.address ? input.address : undefined,
        requestedFor,
        totalCents,
        discountCents,
        voucherId: claim?.voucherId ?? null,
        ...(paidByVoucher ? { paymentStatus: "paid", paymentProvider: VOUCHER_PROVIDER } : {}),
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
                    name: DELIVERY_FEE_LINE_NAME,
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

    // The voucher was claimed before the order existed; now it can point
    // at the order it paid for (and the history line can name it).
    if (claim && customerId) {
      await attachVoucherToOrder(tx, context.tenantId, customerId, claim, order.id);
    }

    // Back-fill the signed-in guest's profile from what they just typed,
    // so the next checkout prefills itself. "Last used" semantics: a
    // newer value overwrites an older one. Only ever ADDITIVE — a
    // dine-in order carries no name, phone or address, and must not
    // wipe the ones an earlier delivery stored. Same transaction as the
    // order: no order, no back-fill.
    if (customerId) {
      const patch: CustomerProfilePatch = {};
      if (orderType !== "dine_in") {
        if (input.customerName?.trim()) patch.name = input.customerName;
        if (input.customerPhone?.trim()) patch.phone = input.customerPhone;
      }
      if (orderType === "delivery" && input.address) patch.lastDeliveryAddress = input.address;
      if (Object.keys(patch).length) {
        await tx.customer.updateMany({
          where: { id: customerId, deletedAt: null },
          data: customerProfileUpdateData(patch),
        });
      }
    }

    return {
      ok: true as const,
      value: {
        orderId: order.id,
        orderNumber,
        totalCents,
        currency,
        receiptToken: signReceiptToken(order.id, context.tenantId),
        discountCents,
        chargedCents: totalCents,
        paidByVoucher,
      },
    };
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
  customerEmail: string | null;
  paymentStatus: string;
  paymentProvider: string | null;
  /** Loyalty reward applied to this order (0 = none). The item lines keep
   *  their menu prices, so every receipt surface shows this as its own
   *  "Reward −€20.00" row between the lines and the total. */
  discountCents: number;
  /** The CHARGED total: already net of `discountCents`. */
  totalCents: number;
  currency: string;
  createdAt: Date;
  venue: {
    name: string;
    slug: string;
    logoKey: string | null;
    /** Optional: the emails' header banner + band colour (Settings → branding). */
    bannerKey?: string | null;
    primaryColor?: string | null;
    defaultLocale: string;
  };
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
        customerEmail: true,
        requestedFor: true,
        deliveryAddress: true,
        paymentStatus: true,
        paymentProvider: true,
        discountCents: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        venue: { select: { name: true, slug: true, branding: true, defaultLocale: true } },
        items: {
          select: { name: true, priceCents: true, quantity: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!order) return null;
    const branding = order.venue.branding as {
      logoKey?: unknown;
      bannerKey?: unknown;
      primaryColor?: unknown;
    } | null;
    const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
    return {
      ...order,
      deliveryAddress: order.deliveryAddress as ReceiptOrder["deliveryAddress"],
      venue: {
        name: order.venue.name,
        slug: order.venue.slug,
        logoKey: str(branding?.logoKey),
        bannerKey: str(branding?.bannerKey),
        primaryColor: str(branding?.primaryColor),
        defaultLocale: order.venue.defaultLocale,
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
  /** "stripe" | "paypal" when paid online, "voucher" when a reward
   *  covered it in full; null = settled at the restaurant. */
  paymentProvider: string | null;
  /** Loyalty reward applied (0 = none); `totalCents` is already net of it. */
  discountCents: number;
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
        paymentProvider: true,
        discountCents: true,
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
        paymentProvider: true,
        discountCents: true,
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

/**
 * Statuses that give earned loyalty points back.
 *
 * `cancelled` is NOT part of the forward-only lifecycle today (see
 * `order-status.ts`: placed → preparing → ready → [out_for_delivery] →
 * done), so `advanceOrderStatus` refuses it before this set is ever
 * consulted. It is declared here anyway so that adding a cancel
 * transition is a one-line change to `ORDER_STATUSES` rather than someone
 * remembering, months later, that a money path also owes the guest their
 * points back. `reverseOrderCredit` is a public, tested entry point in
 * the meantime.
 */
const REVERSING_STATUSES: ReadonlySet<string> = new Set(["cancelled"]);
export async function advanceOrderStatus(
  userId: string,
  orderId: string,
  to: string,
): Promise<{ ok: boolean }> {
  if (!isOrderStatus(to)) return { ok: false };
  const moved = await asUser(userId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: { status: true, orderType: true, tenantId: true, paymentStatus: true },
    });
    if (!order || !canTransition(order.status, to, order.orderType)) return null;
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: to },
    });
    return updated.count > 0
      ? { tenantId: order.tenantId, paymentStatus: order.paymentStatus }
      : null;
  });
  if (!moved) return { ok: false };

  // Loyalty (round one). A CASH order has no settlement webhook, so the
  // kitchen ticking it "done" is the moment it is worth points; online
  // orders were already credited by markOrderPaid and the ledger's unique
  // index makes a second attempt a no-op either way. Fire-and-forget: a
  // loyalty hiccup must never block the kitchen board.
  if (to === "done" && moved.paymentStatus !== "paid") {
    const { creditOrderIfEligible } = await import("./loyalty-service");
    void creditOrderIfEligible(moved.tenantId, orderId).catch(() => undefined);
  } else if (REVERSING_STATUSES.has(to)) {
    const { reverseOrderCredit } = await import("./loyalty-service");
    void reverseOrderCredit(moved.tenantId, orderId).catch(() => undefined);
  }
  return { ok: true };
}

export interface OrderTracking {
  id: string;
  orderNumber: number;
  status: string;
  orderType: string;
  paymentStatus: string;
  /** "stripe" | "paypal" | "voucher" | null (settled at the restaurant). */
  paymentProvider: string | null;
  /** Loyalty reward applied (0 = none); `totalCents` is already net of it. */
  discountCents: number;
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
        paymentProvider: true,
        discountCents: true,
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
  /** Owner's loyalty switches. `enabled: false` is the default, and every
   *  guest surface treats that as "loyalty does not exist here". */
  loyalty: import("./loyalty-config").LoyaltyConfig;
}

/** Effective guest-facing access (plan/trial state ∧ owner switches),
 *  resolved under the tenant GUC. The drawer renders only these; the
 *  POST path re-derives them anyway. */
export async function getPublicVenueAccess(
  tenantId: string,
  venueId: string,
): Promise<PublicVenueAccess> {
  return asTenant(tenantId, async (tx) => {
    const [tenant, venue] = await Promise.all([
      tx.tenant.findFirstOrThrow({
        select: {
          plan: true,
          entitlementOverrides: true,
          createdAt: true,
          status: true,
          deletedAt: true,
          stripeChargesEnabled: true,
          stripeOwnEnabled: true,
          stripeOwnSecretEnc: true,
          paypalOwnEnabled: true,
          paypalClientIdEnc: true,
          paypalSecretEnc: true,
        },
      }),
      tx.venue.findFirstOrThrow({
        where: { id: venueId },
        select: { ordering: true, loyalty: true },
      }),
    ]);
    const access = resolveTenantAccess(tenant);
    // Single-restaurant build: card payment is offered whenever SOME Stripe
    // account can take a direct charge — keys pasted in Dashboard →
    // Payments, the deployment's STRIPE_* keys, or (legacy) a Connect
    // account with charges enabled. Same for PayPal with its own keys or
    // the PAYPAL_* env pair. Only a fake provider in production is hidden.
    const ownStripe = tenant.stripeOwnEnabled && Boolean(tenant.stripeOwnSecretEnc);
    const ownPayPal =
      tenant.paypalOwnEnabled && Boolean(tenant.paypalClientIdEnc && tenant.paypalSecretEnc);
    return {
      menuVisible: access.menuVisible,
      modes: effectiveOrdering(access.entitlements, parseOrderingConfig(venue.ordering)),
      onlinePayment:
        tenant.stripeChargesEnabled || ownStripe || (await stripeDirectChargeAvailable(false)),
      paypalPayment: paypalAvailable(ownPayPal),
      loyalty: parseLoyaltyConfig(venue.loyalty),
    };
  });
}
