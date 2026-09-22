import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { customerProfileUpdateData, type CustomerProfilePatch } from "./customer-auth";
import { TERMINAL_STATUSES, canTransition, isOrderStatus } from "./order-status";
import { OFFER_GRACE_MINUTES, effectiveItemPrice } from "./offer-pricing";
import { paypalAvailable } from "./paypal";
import { getOperatorSettings } from "./operator-settings";
import { stripeDirectChargeAvailable } from "./stripe";
import { asTenant, asUser } from "./tenant";
import { signReceiptToken } from "./receipt-token";
import { resolveTenantAccess } from "./plan-state";
import { currentOpenState, openState, todayLocalTimeToDate } from "./opening-hours";
import { parseOpeningHours } from "./opening-hours-schema";
import { parseLoyaltyConfig } from "./loyalty-config";
import { isLocaleCode } from "./locales";
import { displayPhone, parseContactConfig, telHref } from "./contact-config";
import { attachVoucherToOrder, claimArmedVoucher } from "./loyalty-service";
import { attachGiftCardToOrder, claimGiftCardForOrder } from "./gift-card-service";
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

/**
 * The same, for an order a GIFT CARD settled in full.
 *
 * Kept distinct from `VOUCHER_PROVIDER` rather than folded into it,
 * because the two are not the same event to anyone downstream: a reward
 * costs the venue food it gave away, a gift card is food already paid
 * for months ago. VAT falls due on the gift card at this moment and
 * never falls due on the reward at all, so the accountant's report has
 * to be able to tell the two apart from the order row alone.
 */
export const GIFT_CARD_PROVIDER = "gift_card";

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
     * How the guest said they will pay. Cash (or absent) goes straight to
     * the kitchen and the receipt is mailed now; card / paypal is stored
     * as `paymentStatus: "pending"` with the chosen rail, held off the
     * kitchen, and mailed from markOrderPaid once the payment settles.
     */
    intendedPayment: z.enum(["cash", "card", "paypal"]).optional(),
    /** The language the guest is using ("de", "en", …). Unknown codes are
     *  dropped rather than refusing the order. */
    locale: z
      .string()
      .trim()
      .max(8)
      .optional()
      .transform((v) => (v && isLocaleCode(v) ? v : undefined)),
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
    /**
     * A gift card to spend on this order, as the guest typed or scanned
     * it. Any of our accepted spellings — dashed, lower case, with the
     * Crockford confusables, or a pasted share URL — because the cashier
     * and the guest both retype these by hand
     * (`normalizeGiftCardCode`).
     *
     * A gift card is a BEARER instrument, so this is deliberately NOT
     * restricted to cards the signed-in guest bought: a code handed over
     * at the table is exactly as valid as one in your own account, which
     * is the entire point of a gift. The card is validated server-side
     * against the same rules as counter redemption.
     *
     * Advisory like `redeemVoucher`: a card that turns out to be spent,
     * expired or unknown leaves the order at full price rather than
     * refusing it. The app compares `giftCardDiscountCents` in the reply
     * with what it showed and says so if they differ.
     */
    giftCardCode: z.string().trim().min(4).max(200).optional(),
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
  /** What the reward cost the guest, in points. 0 when no reward was
   *  used, and on orders placed before the column existed — the line then
   *  shows the amount without the points. */
  discountPoints: number;
  /** The gift card applied to this order, 0 when none was. Separate from
   *  `discountCents` because a guest can spend a reward AND a gift card
   *  on one basket, and each gets its own line on every receipt. */
  giftCardDiscountCents: number;
  /** Last four characters of the code spent, for the "Gift card ····1234"
   *  line. Null when no card was used. Never the whole code — that is a
   *  bearer instrument and has no business on a kitchen ticket. */
  giftCardLast4: string | null;
  /** Explicit alias of `totalCents`: what Stripe / PayPal / the till
   *  collect. Named so the app never has to guess which of the two
   *  numbers the payment sheet should use. */
  chargedCents: number;
  /** The reward covered the whole bill: the order is already `paid`
   *  (provider `voucher`), the kitchen has it, and no payment step is
   *  needed — the app must NOT open a payment sheet. */
  paidByVoucher: boolean;
  /** Same, for a gift card that covered everything: provider
   *  `gift_card`, nothing to collect, no payment sheet. */
  paidByGiftCard: boolean;
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
        | "invalid_time"
        | "venue_closed";
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
    // A closed restaurant cannot cook. The ONE thing it can still take is
    // a pickup/delivery order booked into a window that opens later today
    // — the kitchen will be there by then. Everything else (an ASAP order,
    // and any dine-in, which has no "later" at all: the door is locked) is
    // refused outright rather than landing on a printer nobody is reading.
    //
    // Unconfigured hours mean "the owner never told us", and that must
    // never lock a venue out of its own ordering: only a venue that has
    // actually saved hours can be closed by this rule.
    const hours = parseOpeningHours(venue.hours);
    const scheduled = Boolean(input.requestedTime) && orderType !== "dine_in";
    if (hours.configured && !scheduled) {
      const nowState = currentOpenState(hours, venue.timezone);
      if (nowState.configured && !nowState.open) {
        return { ok: false, error: "venue_closed" as const };
      }
    }

    // Requested fulfilment time: venue-local HH:MM for today, only for
    // pickup/delivery, never in the past, and inside opening hours when
    // the venue has them configured. Client offers only valid slots; a
    // forged or stale time hits this wall.
    let requestedFor: Date | null = null;
    if (scheduled) {
      const at = todayLocalTimeToDate(venue.timezone, input.requestedTime!, new Date(), hours);
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
          discountPoints: true,
          giftCardDiscountCents: true,
          giftCardLast4: true,
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
            discountPoints: existing.discountPoints,
            giftCardDiscountCents: existing.giftCardDiscountCents,
            giftCardLast4: existing.giftCardLast4,
            chargedCents: existing.totalCents,
            paidByVoucher: existing.paymentProvider === VOUCHER_PROVIDER,
            paidByGiftCard: existing.paymentProvider === GIFT_CARD_PROVIDER,
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

    // Gift card, claimed after the reward and capped by what is LEFT.
    //
    // Order matters and this is the deliberate choice: the reward is
    // spent first, the card covers the remainder. The alternative burns
    // more of a single-use card than it needs to on a basket a free
    // reward could have covered — and unlike the reward, whatever the
    // card does not spend is forfeited. Spending the perishable thing
    // last is the one ordering that never costs the guest money they
    // could have kept.
    //
    // The forfeit itself is real and stays: a €50 card on a €38 bill
    // loses €12. That is what SINGLE USE, FULL VALUE means, it is stated
    // on the card, and the cart makes the guest tick a box acknowledging
    // the exact amount before this code ever runs.
    const chargeableAfterVoucher = grossCents - discountCents;
    const giftClaim = input.giftCardCode
      ? await claimGiftCardForOrder(tx, input.giftCardCode, context.venueId, chargeableAfterVoucher)
      : null;
    const giftCardDiscountCents = giftClaim?.discountCents ?? 0;

    // The CHARGED total. Line items keep their own prices — the receipt
    // shows each discount as its own row rather than quietly repricing
    // the food, because the kitchen and the tax record both need the
    // real menu prices.
    const totalCents = grossCents - discountCents - giftCardDiscountCents;
    // A discount that covers the whole bill leaves nothing to collect, so
    // the order is born settled: the kitchen ticket and the receipt go
    // out at once, exactly as they do for an order paid online, and no
    // payment sheet is ever opened for €0.00. When both were used, the
    // provider names the gift card — it is the one the guest paid real
    // money for, and the one the accountant's VAT-at-redemption record
    // has to be able to find.
    const fullyCovered = totalCents === 0 && discountCents + giftCardDiscountCents > 0;
    const paidByGiftCard = fullyCovered && giftCardDiscountCents > 0;
    const paidByVoucher = fullyCovered && !paidByGiftCard;

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
        locale: input.locale ?? null,
        deliveryAddress: orderType === "delivery" && input.address ? input.address : undefined,
        requestedFor,
        totalCents,
        discountCents,
        voucherId: claim?.voucherId ?? null,
        // Copied off the voucher rather than looked up later: the reward
        // line names the points on every surface, and none of them has a
        // relation to join through (`voucherId` is a plain reference).
        discountPoints: claim?.pointsSpent ?? 0,
        giftCardDiscountCents,
        giftCardId: giftClaim?.giftCardId ?? null,
        // Denormalised for the same reason as `discountPoints` — see the
        // column comment. Four characters, never the code.
        giftCardLast4: giftClaim ? giftClaim.code.slice(-4) : null,
        ...(fullyCovered
          ? {
              paymentStatus: "paid",
              paymentProvider: paidByGiftCard ? GIFT_CARD_PROVIDER : VOUCHER_PROVIDER,
            }
          : input.intendedPayment === "card" || input.intendedPayment === "paypal"
            ? {
                // An ONLINE order is born awaiting payment and stays off the
                // kitchen board until the money is confirmed (owner rule,
                // 2026-09-21). The chosen rail is recorded now so the order
                // can never be mistaken for a cash order in the meantime;
                // starting the payment later overwrites it with the real ref.
                paymentStatus: "pending",
                paymentProvider: input.intendedPayment === "card" ? "stripe" : "paypal",
              }
            : {}),
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
    // Same for the gift card: claimed before the order existed, bound to
    // it now, so "Redeemed on order #31" can be shown to the buyer.
    if (giftClaim) {
      await attachGiftCardToOrder(tx, giftClaim, order.id);
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
        discountPoints: claim?.pointsSpent ?? 0,
        giftCardDiscountCents,
        giftCardLast4: giftClaim ? giftClaim.code.slice(-4) : null,
        chargedCents: totalCents,
        paidByVoucher,
        paidByGiftCard,
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
  /** Which venue sold this. Optional only so the hand-built fixtures that
   *  predate it still type-check; the loader always fills it. The receipt
   *  mailer uses it to ask whether this venue has a Google review link. */
  venueId?: string;
  orderNumber: number;
  tableNumber: string | null;
  customerEmail: string | null;
  /** The signed-in guest's own UI language, when this order has one.
   *  Outranks the venue default for the receipt email + PDF: a regular
   *  who set the app to French should be mailed in French. Null for an
   *  anonymous order, or a guest who never chose. */
  customerLocale?: string | null;
  /** The language the order was placed in (web cart / app). Outranks
   *  `customerLocale`: it is what the guest was actually reading. */
  locale?: string | null;
  /** Where the order e-mail's footer points: the venue's published
   *  address, phone and site. Optional for the hand-built fixtures. */
  venueFooter?: { address: string | null; phone: string | null; phoneHref: string | null };
  paymentStatus: string;
  paymentProvider: string | null;
  /** Loyalty reward applied to this order (0 = none). The item lines keep
   *  their menu prices, so every receipt surface shows this as its own
   *  "Reward −€20.00" row between the lines and the total. */
  discountCents: number;
  /** What the reward cost the guest, in points. 0 when no reward was
   *  used, and on orders placed before the column existed — the line then
   *  shows the amount without the points. */
  discountPoints: number;
  /** Gift card spent on this order (0 = none), and the last four
   *  characters of its code for the "Gift card ····1234" row. The item
   *  lines keep their menu prices, so this is its own row beside the
   *  reward rather than a reprice. */
  giftCardDiscountCents: number;
  giftCardLast4: string | null;
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
        venueId: true,
        orderNumber: true,
        tableNumber: true,
        orderType: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        locale: true,
        requestedFor: true,
        deliveryAddress: true,
        paymentStatus: true,
        paymentProvider: true,
        discountCents: true,
        discountPoints: true,
        giftCardDiscountCents: true,
        giftCardLast4: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        venue: {
          select: { name: true, slug: true, branding: true, defaultLocale: true, contact: true },
        },
        // Only the language — the receipt already carries the guest's
        // name, phone and address from the order row itself.
        customer: { select: { locale: true } },
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
      customerLocale: order.customer?.locale ?? null,
      venueFooter: (() => {
        const c = parseContactConfig(order.venue.contact);
        return {
          address: c.address,
          phone: c.landline ? displayPhone(c.landline) : null,
          phoneHref: c.landline ? telHref(c.landline) : null,
        };
      })(),
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
  /** What the reward cost the guest, in points. 0 when no reward was
   *  used, and on orders placed before the column existed — the line then
   *  shows the amount without the points. */
  discountPoints: number;
  /** Gift card spent on this order (0 = none), and the last four
   *  characters of its code for the "Gift card ····1234" row. The item
   *  lines keep their menu prices, so this is its own row beside the
   *  reward rather than a reprice. */
  giftCardDiscountCents: number;
  giftCardLast4: string | null;
  totalCents: number;
  currency: string;
  createdAt: Date;
  /** Last write to the row — what a polling client (the app's orders
   *  board) diffs on, since a status change never moves `createdAt`. */
  updatedAt: Date;
  /** When a delivery order left the kitchen, so the board can say
   *  "on the way since 19:42" rather than only "out for delivery". */
  outForDeliveryAt: Date | null;
  items: { name: string; priceCents: number; quantity: number }[];
}

/** Narrow Prisma's JsonValue to the address shape we stored. */
function withAddress<T extends { deliveryAddress: unknown }>(
  order: T,
): T & { deliveryAddress: KitchenOrder["deliveryAddress"] } {
  return { ...order, deliveryAddress: order.deliveryAddress as KitchenOrder["deliveryAddress"] };
}

/**
 * Which slice of the board a caller wants. `open` is everything the
 * kitchen still owes work on (`isOpenStatus`), `closed` is the archive.
 * The mobile orders board asks for the two separately so a long tail of
 * finished orders can never push a live one out of the window.
 */
export type OrderScope = "all" | "open" | "closed" | "awaiting_payment";

/**
 * Payment states of an ONLINE order that is not (yet) paid: `pending`
 * (waiting for the guest or the gateway) and `failed` (declined, the
 * guest may retry). Orders in these states are held off the kitchen.
 */
export const AWAITING_PAYMENT = ["pending", "failed"] as const;

export interface RecentOrdersOptions {
  /** Default "all" — the dashboard/kitchen behaviour this has always had. */
  scope?: OrderScope;
  /** Only rows written at or after this instant (polling delta). */
  updatedSince?: Date;
}

/** Newest orders for the kitchen screen. Any member of the tenant
 *  (owner or staff) can read them. */
export async function listRecentOrders(
  userId: string,
  limit = 50,
  options: RecentOrdersOptions = {},
): Promise<KitchenOrder[]> {
  // Both terminals close an order: a cancelled one belongs to the
  // archive, not to the board the kitchen is cooking from.
  const closed = [...TERMINAL_STATUSES];
  // Online orders reach the kitchen only once paid: an order still
  // awaiting (or having failed) its card / PayPal payment is not on the
  // board, not printed and not counted (owner rule, 2026-09-21). The
  // dashboard reads those separately via `scope: "awaiting_payment"`.
  const unpaidOnline: Prisma.OrderWhereInput = { paymentStatus: { in: [...AWAITING_PAYMENT] } };
  const where: Prisma.OrderWhereInput =
    options.scope === "awaiting_payment"
      ? { ...unpaidOnline, status: { notIn: closed } }
      : // Only OPEN unpaid-online orders are held back: once cancelled (or
        // otherwise closed) they belong in the archive like any other.
        { NOT: { ...unpaidOnline, status: { notIn: closed } } };
  if (options.scope === "open") where.status = { notIn: closed };
  else if (options.scope === "closed") where.status = { in: closed };
  if (options.updatedSince) where.updatedAt = { gte: options.updatedSince };

  const rows = await asUser(userId, (tx) =>
    tx.order.findMany({
      where,
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
        discountPoints: true,
        giftCardDiscountCents: true,
        giftCardLast4: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        outForDeliveryAt: true,
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
        discountPoints: true,
        giftCardDiscountCents: true,
        giftCardLast4: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        outForDeliveryAt: true,
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
 * Live since P7-17: `cancelled` is reachable from every open status, and
 * calling an order off has to undo what placing it moved — the redeemed
 * voucher goes back on the account and any points already credited are
 * reversed. `reverseOrderCredit` owns both halves and is idempotent, so
 * a double cancel (two staff, one tap each) costs nothing.
 *
 * The reverse ordering cannot happen: `done` is terminal, so nothing
 * that was credited BY THE KITCHEN ticking it off can later be
 * cancelled. An order paid online is credited earlier, by
 * `markOrderPaid`, while it is still open — that one really can be
 * cancelled, and its ledger line is what the reversal above undoes.
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
      data: {
        status: to,
        // Stamp the moment it left, once. Written in the SAME conditional
        // update as the transition, so the guard that makes the move
        // idempotent makes the timestamp idempotent too — whichever
        // surface moved it (board, dashboard, or a driver's scan) is the
        // one that dated it, and a later re-entry cannot overwrite it.
        ...(to === "out_for_delivery" ? { outForDeliveryAt: new Date() } : {}),
      },
    });
    return updated.count > 0
      ? { tenantId: order.tenantId, paymentStatus: order.paymentStatus }
      : null;
  });
  if (!moved) return { ok: false };

  // "Your order is on the way" — fire-and-forget, on the same terms as
  // every other guest mail here: a dead SMTP host must never block the
  // kitchen board. Sent only on a REAL transition (we are past the
  // `!moved` guard), so it goes out exactly once per order.
  if (to === "out_for_delivery") {
    const { sendOnTheWayEmail } = await import("./dispatch-service");
    void sendOnTheWayEmail(moved.tenantId, orderId).catch(() => undefined);
  }

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
  /** What the reward cost the guest, in points. 0 when no reward was
   *  used, and on orders placed before the column existed — the line then
   *  shows the amount without the points. */
  discountPoints: number;
  /** Gift card spent on this order (0 = none), and the last four
   *  characters of its code for the "Gift card ····1234" row. The item
   *  lines keep their menu prices, so this is its own row beside the
   *  reward rather than a reprice. */
  giftCardDiscountCents: number;
  giftCardLast4: string | null;
  totalCents: number;
  currency: string;
  requestedFor: Date | null;
  createdAt: Date;
  tableNumber: string | null;
  /** When this order's guest followed the "Rate us on Google" link. Null
   *  = never — which is what keeps the ask on screen. */
  reviewClickedAt: Date | null;
  /** When a delivery order left the kitchen. Null on anything never
   *  dispatched and on orders that predate the column — the tracker then
   *  shows the step without a time rather than inventing one. */
  outForDeliveryAt: Date | null;
  /** The account behind the order, when there is one, carrying its own
   *  copy of the same flag: a signed-in regular who already tapped the
   *  link on an earlier order must not be asked again on this one. Null
   *  for an anonymous QR guest, who has only the order's own flag. */
  customer: { reviewClickedAt: Date | null } | null;
  items: { name: string; quantity: number; priceCents: number; basePriceCents: number | null }[];
  /** The rating columns ride along so the "rate us on Google" ask costs
   *  no second query — they are exactly `VenueRatingRow`, which
   *  `reviewCallToAction()` turns into a link or a null. */
  venue: {
    timezone: string;
    branding: unknown;
    googlePlaceId: string | null;
    googleRating: unknown;
    googleRatingManual: unknown;
    googleRatingEnabled: boolean;
    /** The venue's ordering settings — for the cash cancel window. */
    ordering: unknown;
  };
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
        discountPoints: true,
        giftCardDiscountCents: true,
        giftCardLast4: true,
        totalCents: true,
        currency: true,
        requestedFor: true,
        createdAt: true,
        tableNumber: true,
        reviewClickedAt: true,
        outForDeliveryAt: true,
        customer: { select: { reviewClickedAt: true } },
        items: {
          select: { name: true, quantity: true, priceCents: true, basePriceCents: true },
          orderBy: { createdAt: "asc" },
        },
        venue: {
          select: {
            timezone: true,
            branding: true,
            googlePlaceId: true,
            googleRating: true,
            googleRatingManual: true,
            googleRatingEnabled: true,
            ordering: true,
          },
        },
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
    // The Billing "Enable" tick is the master switch for card payments in
    // own-keys mode: off hides the card option on the website and in the
    // app even when prod.env carries STRIPE_* keys (owner, 2026-09-21).
    // Connect mode has no such tick, so it is not gated by it.
    const { feeMode } = await getOperatorSettings();
    const cardSwitchOff = feeMode === "upfront" && !tenant.stripeOwnEnabled;
    return {
      menuVisible: access.menuVisible,
      modes: effectiveOrdering(access.entitlements, parseOrderingConfig(venue.ordering)),
      onlinePayment:
        !cardSwitchOff &&
        (tenant.stripeChargesEnabled || ownStripe || (await stripeDirectChargeAvailable(false))),
      // Billing's PayPal "Enable" is the master switch (2026-09-21): off
      // hides PayPal everywhere, even with PAYPAL_* keys in prod.env.
      paypalPayment:
        tenant.paypalOwnEnabled &&
        paypalAvailable(Boolean(tenant.paypalClientIdEnc && tenant.paypalSecretEnc)),
      loyalty: parseLoyaltyConfig(venue.loyalty),
    };
  });
}
