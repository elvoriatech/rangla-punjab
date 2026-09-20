import type { Prisma } from "@prisma/client";
import { asTenant } from "./tenant";
import { createLogger } from "./logger";
import { captureException } from "./observability";
import { foodValueCents } from "./ordering-config";
import { loyaltyActive, parseLoyaltyConfig, type LoyaltyConfig } from "./loyalty-config";
import { localDateTimeToInstant, venueDateISO } from "./opening-hours";
import { formatPrice } from "./public-menu";
import { siteUrl } from "./site-url";
import { uiLocale } from "./locales";

const log = createLogger();

/**
 * Loyalty: earning, the balance, the vouchers it converts into, and
 * (round two) spending one of those vouchers on an order.
 *
 * Redemption is deliberately pull-only: the guest ARMS a voucher in the
 * app, and the order-placement request has to ask for it
 * (`redeemVoucher: true`). The website never asks, so a web order can
 * never quietly eat the free meal the guest was saving for a takeaway.
 *
 * Two rules shape everything here:
 *
 *  1. The ledger is the truth. A balance is SUM(delta), never a stored
 *     counter, so a double-credit is impossible to hide and a reversal is
 *     just another row.
 *  2. Earning must never break settlement. `creditOrderIfEligible` is
 *     called from `markOrderPaid` and from the kitchen's "done" transition;
 *     both are money paths. Every call here is wrapped by the caller in a
 *     void/catch, and the congratulations email is fired outside the
 *     transaction so a dead mail server cannot roll back a payment.
 */

/** Terminal voucher states — an armed/available voucher is neither. */
const LIVE_VOUCHER_STATUSES = ["available", "armed"] as const;

/** A pathological config (rewardPoints 1, a big backfill) must not spin
 *  forever inside one transaction. Ten vouchers in one settlement is
 *  already far beyond anything a real venue configures. */
const MAX_VOUCHERS_PER_RUN = 10;

export interface LoyaltyVoucherView {
  id: string;
  valueCents: number;
  status: string;
  expiresAt: string;
  /** The order this voucher paid for, once it has been redeemed — so the
   *  app and the web account page can say "used on order #0031". Null for
   *  every non-redeemed voucher (and for a redeemed one whose order has
   *  since been deleted). */
  redeemedOrderNumber: number | null;
}

export interface LoyaltyHistoryEntry {
  id: string;
  delta: number;
  reason: string;
  /** The order the movement belongs to, or null (voucher / adjustment). */
  orderNumber: number | null;
  /**
   * What the voucher this movement is about was WORTH, for the two reasons
   * that have one: "voucher" (the points that bought it) and "redeem" (the
   * reward that was spent). Null for every other reason.
   *
   * Quoted from the voucher itself, never re-derived from the venue's
   * current `rewardValueCents` — an owner who raises the reward from €20 to
   * €25 must not rewrite what last month's history says the guest spent.
   */
  valueCents: number | null;
  createdAt: string;
}

/** Exactly the `loyalty` object `GET /api/v1/me/loyalty` answers with. */
export interface LoyaltySummary {
  enabled: boolean;
  balance: number;
  rewardPoints: number;
  rewardValueCents: number;
  minOrderCents: number;
  pointsPerOrder: number;
  vouchers: LoyaltyVoucherView[];
  history: LoyaltyHistoryEntry[];
}

/* ------------------------------------------------------------------ */
/* Config + expiry                                                     */
/* ------------------------------------------------------------------ */

/** The venue's loyalty switches, parsed. Re-exported so callers need one
 *  import rather than two. */
export function getLoyaltyConfig(venueLoyaltyJson: unknown): LoyaltyConfig {
  return parseLoyaltyConfig(venueLoyaltyJson);
}

/**
 * When a voucher minted `at` dies: 23:59:59 on the last day of the
 * calendar month, in the VENUE's timezone, plus `months` extra months
 * (1 = the end of next month, 12 = a year, …).
 *
 * `months` of 0 still computes "the end of this month" — the arithmetic
 * is unchanged, and the backfill script needs to be able to ask for any
 * number. It is the CONFIG that no longer offers 0 (see
 * `loyalty-config.ts`), because a reward earned on the 28th that died on
 * the 31st was the thing being fixed.
 *
 * Computed as "midnight on the 1st of the month after, minus one second"
 * so no month-length table is needed and DST is handled by the same
 * two-pass converter the reservation grid uses.
 */
export function voucherExpiry(timezone: string, months: number, at: Date = new Date()): Date {
  const parts = venueDateISO(timezone, at).split("-").map(Number);
  const y = parts[0] ?? at.getUTCFullYear();
  const m = parts[1] ?? 1;
  // Month index (0-based) of the month AFTER the last valid one.
  const exclusive = m - 1 + Math.max(0, Math.round(months)) + 1;
  const year = y + Math.floor(exclusive / 12);
  const month = (exclusive % 12) + 1;
  const firstOfNext = `${year}-${String(month).padStart(2, "0")}-01`;
  const boundary = localDateTimeToInstant(timezone, firstOfNext, "00:00");
  // `localDateTimeToInstant` only rejects malformed inputs, which we just
  // built — the fallback keeps the type honest without inventing a date.
  return new Date((boundary?.getTime() ?? at.getTime()) - 1000);
}

/* ------------------------------------------------------------------ */
/* Earning                                                             */
/* ------------------------------------------------------------------ */

export interface CreditResult {
  credited: boolean;
  points: number;
}

const NOT_CREDITED: CreditResult = { credited: false, points: 0 };

/** A voucher that was just minted, carried out of the transaction so the
 *  email can be sent without holding a DB connection open. */
interface MintedVoucher {
  voucherId: string;
  valueCents: number;
  expiresAt: Date;
  email: string;
  locale: string;
  currency: string;
  timezone: string;
  venue: {
    name: string;
    logoKey: string | null;
    bannerKey: string | null;
    primaryColor: string | null;
  };
}

/**
 * Credit one settled order, once.
 *
 * Refuses (silently, `{credited:false}`) when the order has no signed-in
 * customer, when loyalty is off or zeroed, or when the order's FOOD value
 * — total minus the delivery-fee line — is under `minOrderCents`. The
 * UNIQUE (order_id, reason) index is what makes a second call a no-op, so
 * the webhook, /pay/verify and the dashboard reconcile can all race.
 *
 * On a voucher-discounted order the threshold applies to what the guest
 * actually PAID: `orders.total_cents` is stored net of the discount, so
 * `foodValueCents` already yields the charged food value and a €24 order
 * that a €20 reward brought down to €4 earns nothing. Spending a reward
 * must not quietly earn most of the next one.
 */
export async function creditOrderIfEligible(
  tenantId: string,
  orderId: string,
): Promise<CreditResult> {
  const outcome = await asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        customerId: true,
        totalCents: true,
        currency: true,
        items: { select: { itemId: true, name: true, priceCents: true, quantity: true } },
        venue: {
          select: {
            name: true,
            loyalty: true,
            timezone: true,
            branding: true,
            defaultLocale: true,
          },
        },
      },
    });
    if (!order?.customerId) return { result: NOT_CREDITED, minted: [] as MintedVoucher[] };

    const config = parseLoyaltyConfig(order.venue.loyalty);
    if (!loyaltyActive(config)) return { result: NOT_CREDITED, minted: [] };
    if (foodValueCents(order) < config.minOrderCents) {
      return { result: NOT_CREDITED, minted: [] };
    }

    // Idempotent by construction: `skipDuplicates` turns the racing
    // second caller into a 0-row insert instead of a unique violation,
    // which inside an interactive transaction would poison every later
    // statement.
    const inserted = await tx.loyaltyLedger.createMany({
      data: [
        {
          tenantId,
          customerId: order.customerId,
          orderId: order.id,
          delta: config.pointsPerOrder,
          reason: "order",
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return { result: NOT_CREDITED, minted: [] };

    const minted = await convertBalanceToVouchers(tx, tenantId, order.customerId, config, {
      currency: order.currency,
      timezone: order.venue.timezone,
      defaultLocale: order.venue.defaultLocale,
      venueName: order.venue.name,
      branding: order.venue.branding,
    });
    return { result: { credited: true, points: config.pointsPerOrder }, minted };
  });

  if (outcome.result.credited) {
    log.info("loyalty.credited", { tenantId, orderId, points: outcome.result.points });
  }
  for (const voucher of outcome.minted) void sendRewardEmail(tenantId, voucher);
  return outcome.result;
}

/**
 * Give back the points a now-cancelled order earned. One reversal row per
 * order (UNIQUE (order_id, 'reversal')), so cancelling twice is a no-op.
 *
 * A voucher the cancelled order SPENT is handed straight back (unless the
 * calendar caught up with it meanwhile — then it goes to `expired` like
 * any other stale voucher). The food was never cooked; the guest keeps
 * their free meal.
 *
 * Vouchers already MINTED are deliberately left alone: the guest was told
 * they had a free meal, and clawing it back over a kitchen-side cancel
 * would be worse for the restaurant than the points are worth. The balance
 * simply carries the debt.
 */
export async function reverseOrderCredit(tenantId: string, orderId: string): Promise<CreditResult> {
  await restoreOrderVoucher(tenantId, orderId);
  const result = await asTenant(tenantId, async (tx) => {
    const earned = await tx.loyaltyLedger.findFirst({
      where: { orderId, reason: "order" },
      select: { customerId: true, delta: true },
    });
    if (!earned || earned.delta === 0) return NOT_CREDITED;
    const inserted = await tx.loyaltyLedger.createMany({
      data: [
        {
          tenantId,
          customerId: earned.customerId,
          orderId,
          delta: -earned.delta,
          reason: "reversal",
        },
      ],
      skipDuplicates: true,
    });
    return inserted.count === 0 ? NOT_CREDITED : { credited: true, points: -earned.delta };
  });
  if (result.credited) log.info("loyalty.reversed", { tenantId, orderId, points: result.points });
  return result;
}

/**
 * Spend whole multiples of `rewardPoints` from the balance, minting one
 * voucher each. Runs inside the caller's transaction so balance-read and
 * debit can never interleave with another settlement.
 */
async function convertBalanceToVouchers(
  tx: Prisma.TransactionClient,
  tenantId: string,
  customerId: string,
  config: LoyaltyConfig,
  venue: {
    currency: string;
    timezone: string;
    defaultLocale: string;
    venueName: string;
    branding: unknown;
  },
): Promise<MintedVoucher[]> {
  let balance = await balanceOf(tx, customerId);
  if (balance < config.rewardPoints) return [];

  const customer = await tx.customer.findFirst({
    where: { id: customerId },
    select: { email: true },
  });
  const brand = brandingOf(venue.branding);
  const minted: MintedVoucher[] = [];
  const expiresAt = voucherExpiry(venue.timezone, config.voucherExpiryMonths);

  while (balance >= config.rewardPoints && minted.length < MAX_VOUCHERS_PER_RUN) {
    const voucher = await tx.loyaltyVoucher.create({
      data: {
        tenantId,
        customerId,
        valueCents: config.rewardValueCents,
        pointsSpent: config.rewardPoints,
        status: "available",
        expiresAt,
      },
      select: { id: true },
    });
    await tx.loyaltyLedger.create({
      data: {
        tenantId,
        customerId,
        orderId: null,
        voucherId: voucher.id,
        delta: -config.rewardPoints,
        reason: "voucher",
      },
    });
    balance -= config.rewardPoints;
    if (customer?.email) {
      minted.push({
        voucherId: voucher.id,
        valueCents: config.rewardValueCents,
        expiresAt,
        email: customer.email,
        locale: venue.defaultLocale,
        currency: venue.currency,
        timezone: venue.timezone,
        venue: { name: venue.venueName, ...brand },
      });
    }
  }
  return minted;
}

async function balanceOf(tx: Prisma.TransactionClient, customerId: string): Promise<number> {
  const sum = await tx.loyaltyLedger.aggregate({
    where: { customerId },
    _sum: { delta: true },
  });
  return sum._sum.delta ?? 0;
}

function brandingOf(raw: unknown): {
  logoKey: string | null;
  bannerKey: string | null;
  primaryColor: string | null;
} {
  const b = (raw ?? {}) as { logoKey?: unknown; bannerKey?: unknown; primaryColor?: unknown };
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  return {
    logoKey: str(b.logoKey),
    bannerKey: str(b.bannerKey),
    primaryColor: str(b.primaryColor),
  };
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Everything the app's Account → Rewards screen and the web account card
 * render. Expires stale vouchers first — lazily, on read, so no cron owns
 * the guest's rewards.
 */
export async function getLoyaltySummary(
  tenantId: string,
  customerId: string,
): Promise<LoyaltySummary> {
  return asTenant(tenantId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { loyalty: true },
    });
    const config = parseLoyaltyConfig(venue?.loyalty);
    if (!config.enabled) return DISABLED_SUMMARY;

    await expireStaleVouchers(tx, customerId);

    const [balance, vouchers, history] = await Promise.all([
      balanceOf(tx, customerId),
      tx.loyaltyVoucher.findMany({
        where: { customerId },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          valueCents: true,
          status: true,
          expiresAt: true,
          redeemedOrderId: true,
        },
      }),
      tx.loyaltyLedger.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          delta: true,
          reason: true,
          voucherId: true,
          createdAt: true,
          order: { select: { orderNumber: true } },
        },
      }),
    ]);

    // `loyalty_vouchers.redeemed_order_id` is a plain reference, not an FK
    // (round one left the delete semantics open), so the order numbers are
    // resolved with one extra indexed read rather than a join.
    const redeemedIds = vouchers.map((v) => v.redeemedOrderId).filter((id): id is string => !!id);
    const orderNumbers = new Map<string, number>();
    if (redeemedIds.length > 0) {
      const orders = await tx.order.findMany({
        where: { id: { in: redeemedIds } },
        select: { id: true, orderNumber: true },
      });
      for (const o of orders) orderNumbers.set(o.id, o.orderNumber);
    }

    // A history line quotes the voucher's OWN value. The vouchers a
    // history page references are usually the ones already listed above,
    // so this resolves from that list first and only asks the database for
    // the stragglers (a voucher old enough to have aged out of the list).
    const voucherValues = new Map<string, number>(vouchers.map((v) => [v.id, v.valueCents]));
    const unknown = [
      ...new Set(
        history
          .map((h) => h.voucherId)
          .filter((id): id is string => !!id && !voucherValues.has(id)),
      ),
    ];
    if (unknown.length > 0) {
      const extra = await tx.loyaltyVoucher.findMany({
        where: { id: { in: unknown }, customerId },
        select: { id: true, valueCents: true },
      });
      for (const v of extra) voucherValues.set(v.id, v.valueCents);
    }

    return {
      enabled: true,
      balance,
      rewardPoints: config.rewardPoints,
      rewardValueCents: config.rewardValueCents,
      minOrderCents: config.minOrderCents,
      pointsPerOrder: config.pointsPerOrder,
      vouchers: vouchers.map((v) =>
        voucherView(v, v.redeemedOrderId ? (orderNumbers.get(v.redeemedOrderId) ?? null) : null),
      ),
      history: history.map((h) => ({
        id: h.id,
        delta: h.delta,
        reason: h.reason,
        orderNumber: h.order?.orderNumber ?? null,
        valueCents: h.voucherId ? (voucherValues.get(h.voucherId) ?? null) : null,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  });
}

/** Loyalty off: the same shape, zeroed, so clients need no second branch
 *  beyond `enabled`. Nothing about a disabled venue's numbers — not even
 *  the thresholds it would use — reaches a guest. */
export const DISABLED_SUMMARY: LoyaltySummary = {
  enabled: false,
  balance: 0,
  rewardPoints: 0,
  rewardValueCents: 0,
  minOrderCents: 0,
  pointsPerOrder: 0,
  vouchers: [],
  history: [],
};

function voucherView(
  v: {
    id: string;
    valueCents: number;
    status: string;
    expiresAt: Date;
  },
  redeemedOrderNumber: number | null = null,
): LoyaltyVoucherView {
  return {
    id: v.id,
    valueCents: v.valueCents,
    status: v.status,
    expiresAt: v.expiresAt.toISOString(),
    redeemedOrderNumber,
  };
}

async function expireStaleVouchers(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  await tx.loyaltyVoucher.updateMany({
    where: {
      customerId,
      status: { in: [...LIVE_VOUCHER_STATUSES] },
      expiresAt: { lt: new Date() },
    },
    data: { status: "expired", armedAt: null },
  });
}

/* ------------------------------------------------------------------ */
/* Arming                                                              */
/* ------------------------------------------------------------------ */

export type ArmVoucherResult =
  { ok: true; voucher: LoyaltyVoucherView } | { ok: false; error: "not_found" | "not_armable" };

/**
 * Toggle a voucher between "available" and "armed" — the guest saying
 * "use this one on my next order". Round one only records the intent;
 * round two reads it at checkout. Terminal vouchers (redeemed, expired,
 * revoked) refuse with `not_armable` rather than silently doing nothing.
 */
export async function setVoucherArmed(
  tenantId: string,
  customerId: string,
  voucherId: string,
  armed: boolean,
): Promise<ArmVoucherResult> {
  return asTenant(tenantId, async (tx) => {
    await expireStaleVouchers(tx, customerId);
    const voucher = await tx.loyaltyVoucher.findFirst({
      where: { id: voucherId, customerId },
      select: { id: true, status: true },
    });
    if (!voucher) return { ok: false as const, error: "not_found" as const };
    if (!(LIVE_VOUCHER_STATUSES as readonly string[]).includes(voucher.status)) {
      return { ok: false as const, error: "not_armable" as const };
    }
    const updated = await tx.loyaltyVoucher.update({
      where: { id: voucher.id },
      data: { status: armed ? "armed" : "available", armedAt: armed ? new Date() : null },
      select: { id: true, valueCents: true, status: true, expiresAt: true },
    });
    return { ok: true as const, voucher: voucherView(updated) };
  });
}

/* ------------------------------------------------------------------ */
/* Redemption (round two)                                              */
/* ------------------------------------------------------------------ */

/** A voucher this checkout has taken off the shelf, and what it is worth
 *  against THIS basket (never more than the basket itself). */
export interface VoucherClaim {
  voucherId: string;
  discountCents: number;
  /** What the voucher cost the guest in points, carried out of the claim
   *  so the order can copy it onto its own row — see
   *  `orders.discount_points`. Every surface that draws the reward line
   *  states the points, and re-reading the voucher on each of them was
   *  eight lookups for a number that stops changing the moment it is
   *  spent. */
  pointsSpent: number;
}

/**
 * Take the guest's armed voucher out of circulation for the order being
 * placed, inside the CALLER's transaction — `placeOrder` runs this after
 * its per-venue advisory lock, so the claim, the order row and the ledger
 * movement commit or roll back as one.
 *
 * The claim is a conditional `updateMany` on `status: "armed"`, so two
 * checkouts racing for the same voucher resolve to exactly one winner
 * (the loser sees `count === 0` and places an ordinary, undiscounted
 * order) — no double spend, no error thrown at a guest who did nothing
 * wrong.
 *
 * Deliberately does NOT consult the venue's loyalty switches: a voucher
 * the guest already earned is a promise the restaurant made, and turning
 * the programme off should stop new points, not confiscate outstanding
 * free meals. (An owner who really wants one gone marks it `revoked`.)
 *
 * Returns null when there is nothing to spend: no armed voucher, or one
 * that expired while it sat armed. Both are ordinary outcomes, not errors:
 * the app renders a preview from `/me/loyalty` and the server is the
 * authority, so a stale preview costs the guest their discount, never
 * their order.
 */
export async function claimArmedVoucher(
  tx: Prisma.TransactionClient,
  customerId: string,
  chargeableCents: number,
): Promise<VoucherClaim | null> {
  await expireStaleVouchers(tx, customerId);
  const voucher = await tx.loyaltyVoucher.findFirst({
    where: { customerId, status: "armed", expiresAt: { gt: new Date() } },
    // Soonest to die goes first: a guest holding two rewards should spend
    // the one they would otherwise lose.
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, valueCents: true, pointsSpent: true },
  });
  if (!voucher) return null;

  const claimed = await tx.loyaltyVoucher.updateMany({
    where: { id: voucher.id, status: "armed" },
    data: { status: "redeemed", armedAt: null },
  });
  if (claimed.count === 0) return null;

  // A reward is never worth more than the bill it is used on — the
  // restaurant does not hand out change for a free meal, and a negative
  // total would be a refund nobody authorised.
  return {
    voucherId: voucher.id,
    discountCents: Math.max(0, Math.min(voucher.valueCents, chargeableCents)),
    pointsSpent: voucher.pointsSpent,
  };
}

/**
 * Bind a claimed voucher to the order it paid for, once that order has an
 * id. Also writes the history line the app lists as "€20 reward used ·
 * Order #0031": delta 0, because the POINTS were spent when the voucher
 * was minted — this row is the receipt of the voucher, not a second debit.
 */
export async function attachVoucherToOrder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  customerId: string,
  claim: VoucherClaim,
  orderId: string,
): Promise<void> {
  await tx.loyaltyVoucher.updateMany({
    where: { id: claim.voucherId },
    data: { redeemedOrderId: orderId },
  });
  await tx.loyaltyLedger.createMany({
    data: [
      { tenantId, customerId, orderId, voucherId: claim.voucherId, delta: 0, reason: "redeem" },
    ],
    skipDuplicates: true,
  });
}

/**
 * The cancel path's other half: give back the voucher a cancelled order
 * spent. Idempotent — it only ever touches a voucher still pointing at
 * THIS order, so a second cancel finds nothing to do. A voucher whose
 * expiry passed while the order was open comes back as `expired` rather
 * than `available`: the guest may not spend a reward the calendar already
 * took, and the account screen should say why.
 */
async function restoreOrderVoucher(tenantId: string, orderId: string): Promise<void> {
  const restored = await asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: { voucherId: true },
    });
    if (!order?.voucherId) return null;
    const voucher = await tx.loyaltyVoucher.findFirst({
      where: { id: order.voucherId, status: "redeemed", redeemedOrderId: orderId },
      select: { id: true, expiresAt: true },
    });
    if (!voucher) return null;
    const live = voucher.expiresAt.getTime() > Date.now();
    await tx.loyaltyVoucher.updateMany({
      where: { id: voucher.id, status: "redeemed", redeemedOrderId: orderId },
      data: { status: live ? "available" : "expired", armedAt: null, redeemedOrderId: null },
    });
    // The "reward used" history line goes with it: delta 0, so the balance
    // is untouched, but leaving it would tell the guest a voucher they can
    // see in their wallet was spent.
    await tx.loyaltyLedger.deleteMany({ where: { orderId, reason: "redeem" } });
    return { voucherId: voucher.id, status: live ? "available" : "expired" };
  });
  if (restored) log.info("loyalty.voucher_restored", { tenantId, orderId, ...restored });
}

/* ------------------------------------------------------------------ */
/* Congratulations email                                               */
/* ------------------------------------------------------------------ */

/**
 * Fire-and-forget, exactly once per voucher (it is called only where a
 * voucher was just created). Never throws — the settlement path that
 * triggered it must not learn about a mail outage.
 */
async function sendRewardEmail(tenantId: string, voucher: MintedVoucher): Promise<void> {
  try {
    const { sendEmail } = await import("./email");
    const { RewardEmail, rewardSubject } = await import("@/emails/reward-email");
    const locale = uiLocale(voucher.locale);
    const value = formatPrice(voucher.valueCents, voucher.currency, locale);
    const expires = new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeZone: voucher.timezone,
    }).format(voucher.expiresAt);
    await sendEmail({
      to: voucher.email,
      subject: rewardSubject(locale, value),
      react: RewardEmail({
        venue: voucher.venue,
        locale,
        value,
        expires,
        rewardsUrl: `${siteUrl()}/account`,
      }),
    });
    log.info("loyalty.reward_emailed", { tenantId, voucherId: voucher.voucherId });
  } catch (err) {
    captureException(err, { tenantId, voucherId: voucher.voucherId, where: "reward-email" });
    log.warn("loyalty.reward_email_failed", { tenantId, voucherId: voucher.voucherId });
  }
}
