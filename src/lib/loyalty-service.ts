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
 * Loyalty, round one: earning, the balance, and the vouchers it converts
 * into. Redemption (spending a voucher on an order) is round two — the
 * "armed" status and `orders.discount_cents` / `orders.voucher_id` are the
 * seams it will grow into.
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
}

export interface LoyaltyHistoryEntry {
  id: string;
  delta: number;
  reason: string;
  /** The order the movement belongs to, or null (voucher / adjustment). */
  orderNumber: number | null;
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
 * (0 = this month, 1 = the end of next month, …).
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
 * Vouchers already minted are deliberately left alone: the guest was told
 * they had a free meal, and clawing it back over a kitchen-side cancel
 * would be worse for the restaurant than the points are worth. The balance
 * simply carries the debt.
 */
export async function reverseOrderCredit(tenantId: string, orderId: string): Promise<CreditResult> {
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
      data: { tenantId, customerId, orderId: null, delta: -config.rewardPoints, reason: "voucher" },
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
        select: { id: true, valueCents: true, status: true, expiresAt: true },
      }),
      tx.loyaltyLedger.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          delta: true,
          reason: true,
          createdAt: true,
          order: { select: { orderNumber: true } },
        },
      }),
    ]);

    return {
      enabled: true,
      balance,
      rewardPoints: config.rewardPoints,
      rewardValueCents: config.rewardValueCents,
      minOrderCents: config.minOrderCents,
      pointsPerOrder: config.pointsPerOrder,
      vouchers: vouchers.map(voucherView),
      history: history.map((h) => ({
        id: h.id,
        delta: h.delta,
        reason: h.reason,
        orderNumber: h.order?.orderNumber ?? null,
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

function voucherView(v: {
  id: string;
  valueCents: number;
  status: string;
  expiresAt: Date;
}): LoyaltyVoucherView {
  return {
    id: v.id,
    valueCents: v.valueCents,
    status: v.status,
    expiresAt: v.expiresAt.toISOString(),
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
