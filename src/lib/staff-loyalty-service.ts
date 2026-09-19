import { parseLoyaltyConfig } from "./loyalty-config";
import { asTenant } from "./tenant";

/**
 * The restaurant's view of its own loyalty programme — the numbers an owner
 * asks for at the counter ("how many regulars do we have?", "how much are we
 * carrying in unredeemed points?") plus the member list behind them.
 *
 * Strictly read-only. The switches themselves stay in the dashboard: changing
 * what a point is worth re-prices every outstanding balance, which is not a
 * decision anyone should make one-handed during service.
 *
 * Membership is defined by the LEDGER, not by the customer table: a guest who
 * has an account but never earned a point is not a loyalty member, and listing
 * them would bury the regulars the owner actually wants to see.
 */

/** Rolling window for "recently redeemed" — a month of trading. */
const REDEEMED_WINDOW_DAYS = 30;

/** The board shows the top slice; the full list belongs in the dashboard. */
const MEMBER_LIMIT = 50;

/** Vouchers that still exist as a promise to the guest. `armed` is one the
 *  guest has already pointed at their next order. */
const LIVE_VOUCHER_STATUSES = ["available", "armed"];

export interface StaffLoyaltyMember {
  customerId: string;
  name: string | null;
  email: string;
  /** Points on hand: SUM(delta) over the ledger, never a stored counter. */
  balance: number;
  vouchersAvailable: number;
  lastOrderAt: string | null;
}

export interface StaffLoyaltyTotals {
  members: number;
  /** Points earned and not yet converted — the programme's liability in
   *  points. */
  pointsOutstanding: number;
  vouchersAvailable: number;
  vouchersRedeemed30d: number;
}

export interface StaffLoyaltyOverview {
  enabled: boolean;
  config: {
    minOrderCents: number;
    pointsPerOrder: number;
    rewardPoints: number;
    rewardValueCents: number;
    voucherExpiryMonths: number;
  };
  totals: StaffLoyaltyTotals;
  members: StaffLoyaltyMember[];
}

/**
 * Everything the app's loyalty tab renders, in one round trip.
 *
 * The config is reported even when the programme is switched OFF: the owner is
 * looking at their own settings, and an all-zero card would read as "loyalty
 * is broken" rather than "loyalty is off". Guests get the opposite treatment —
 * `publicLoyalty` tells them nothing about a disabled venue.
 */
export async function getStaffLoyaltyOverview(tenantId: string): Promise<StaffLoyaltyOverview> {
  return asTenant(tenantId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { loyalty: true },
    });
    const config = parseLoyaltyConfig(venue?.loyalty);

    const now = new Date();
    const since = new Date(now.getTime() - REDEEMED_WINDOW_DAYS * 86_400_000);

    const balances = await tx.loyaltyLedger.groupBy({
      by: ["customerId"],
      _sum: { delta: true },
    });
    const pointsOutstanding = balances.reduce((sum, row) => sum + (row._sum.delta ?? 0), 0);

    const [vouchersAvailable, vouchersRedeemed30d] = await Promise.all([
      tx.loyaltyVoucher.count({
        where: { status: { in: LIVE_VOUCHER_STATUSES }, expiresAt: { gt: now } },
      }),
      tx.loyaltyVoucher.count({ where: { status: "redeemed", updatedAt: { gte: since } } }),
    ]);

    const totals: StaffLoyaltyTotals = {
      members: balances.length,
      pointsOutstanding,
      vouchersAvailable,
      vouchersRedeemed30d,
    };

    // Richest first. Ties fall back to the customer id so two runs of the same
    // data never reorder the list under the owner's thumb.
    const top = [...balances]
      .sort((a, b) => {
        const delta = (b._sum.delta ?? 0) - (a._sum.delta ?? 0);
        return delta !== 0 ? delta : a.customerId.localeCompare(b.customerId);
      })
      .slice(0, MEMBER_LIMIT);
    const ids = top.map((row) => row.customerId);
    if (ids.length === 0) {
      return { enabled: config.enabled, config: publicConfig(config), totals, members: [] };
    }

    const [customers, vouchers, lastOrders] = await Promise.all([
      tx.customer.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, name: true, email: true },
      }),
      tx.loyaltyVoucher.groupBy({
        by: ["customerId"],
        where: {
          customerId: { in: ids },
          status: { in: LIVE_VOUCHER_STATUSES },
          expiresAt: { gt: now },
        },
        _count: { _all: true },
      }),
      tx.order.groupBy({
        by: ["customerId"],
        where: { customerId: { in: ids } },
        _max: { createdAt: true },
      }),
    ]);

    const byId = new Map(customers.map((c) => [c.id, c]));
    const voucherCount = new Map(vouchers.map((v) => [v.customerId, v._count._all]));
    const lastOrderAt = new Map(
      lastOrders.flatMap((o) => (o.customerId ? [[o.customerId, o._max.createdAt]] : [])),
    );

    const members = top.flatMap<StaffLoyaltyMember>((row) => {
      // A soft-deleted customer keeps their ledger rows (the totals above are
      // still true) but has no name or address left to show.
      const customer = byId.get(row.customerId);
      if (!customer) return [];
      const last = lastOrderAt.get(row.customerId);
      return [
        {
          customerId: customer.id,
          name: customer.name,
          email: customer.email,
          balance: row._sum.delta ?? 0,
          vouchersAvailable: voucherCount.get(row.customerId) ?? 0,
          lastOrderAt: last ? last.toISOString() : null,
        },
      ];
    });

    return { enabled: config.enabled, config: publicConfig(config), totals, members };
  });
}

function publicConfig(
  config: ReturnType<typeof parseLoyaltyConfig>,
): StaffLoyaltyOverview["config"] {
  return {
    minOrderCents: config.minOrderCents,
    pointsPerOrder: config.pointsPerOrder,
    rewardPoints: config.rewardPoints,
    rewardValueCents: config.rewardValueCents,
    voucherExpiryMonths: config.voucherExpiryMonths,
  };
}
