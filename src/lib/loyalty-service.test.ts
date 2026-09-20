import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { signInCustomer } from "./customer-auth";
import { prisma } from "./db";
import {
  creditOrderIfEligible,
  getLoyaltySummary,
  reverseOrderCredit,
  setVoucherArmed,
  voucherExpiry,
} from "./loyalty-service";
import { placeOrder, type PlacedOrder } from "./order-service";
import { asTenant } from "./tenant";

/**
 * Loyalty earning against a real database, because the two things worth
 * proving here are both database properties: that a settled order is
 * credited exactly ONCE however many callers race for it, and that the
 * threshold conversion debits the points it spends in the same
 * transaction that mints the voucher.
 */

const tenantIds: string[] = [];
const userIds: string[] = [];

interface Fixture {
  tenantId: string;
  venueId: string;
  publishedVersionId: string;
  itemId: string;
  customerId: string;
}

/** A venue with one €12.45 dish and one signed-in customer. */
async function fixture(
  loyalty: Prisma.InputJsonObject,
  timezone = "Europe/Berlin",
): Promise<Fixture> {
  const s = await signupUser({
    email: `loyalty-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: "Loyalty Test",
  });
  if (!s.ok) throw new Error("signup failed");
  userIds.push(s.userId);
  tenantIds.push(s.tenantId);

  return asTenant(s.tenantId, async (tx) => {
    await tx.tenant.updateMany({ data: { plan: "scale" } });
    const venue = await tx.venue.create({
      data: {
        tenantId: s.tenantId,
        name: "Rangla Punjab",
        slug: `loy-${randomUUID().slice(0, 8)}`,
        currency: "EUR",
        timezone,
        loyalty,
      },
      select: { id: true },
    });
    const menu = await tx.menu.create({
      data: { tenantId: s.tenantId, venueId: venue.id, name: "Main", isDefault: true },
      select: { id: true },
    });
    const version = await tx.menuVersion.create({
      data: { tenantId: s.tenantId, menuId: menu.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });
    const cat = await tx.category.create({
      data: { tenantId: s.tenantId, menuVersionId: version.id, name: "Mains", orderIndex: 0 },
      select: { id: true },
    });
    const item = await tx.item.create({
      data: {
        tenantId: s.tenantId,
        categoryId: cat.id,
        name: "Biryani",
        priceCents: 1245,
        orderIndex: 0,
      },
      select: { id: true },
    });
    const signedIn = await signInCustomer(s.tenantId, "dev", {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `guest-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Guest",
    });
    return {
      tenantId: s.tenantId,
      venueId: venue.id,
      publishedVersionId: version.id,
      itemId: item.id,
      customerId: signedIn.customerId,
    };
  });
}

/** Place a dine-in order for `quantity` dishes, optionally anonymously. */
async function order(fx: Fixture, quantity: number, withCustomer = true): Promise<string> {
  return (await placed(fx, quantity, { withCustomer })).orderId;
}

/** The full placement result — what the app reads back at checkout. */
async function placed(
  fx: Fixture,
  quantity: number,
  opts: { withCustomer?: boolean; redeemVoucher?: boolean } = {},
): Promise<PlacedOrder> {
  const result = await placeOrder(
    fx,
    {
      orderType: "dine_in",
      tableNumber: "3",
      items: [{ itemId: fx.itemId, quantity }],
      ...(opts.redeemVoucher ? { redeemVoucher: true } : {}),
    },
    { customerId: opts.withCustomer === false ? null : fx.customerId },
  );
  if (!result.ok) throw new Error(`order failed: ${result.error}`);
  return result.value;
}

/** Earn one voucher (the fixtures below all set `rewardPoints` to one
 *  order's worth) and arm it, the way the app's Rewards card does. */
async function armedVoucher(fx: Fixture): Promise<{ id: string; valueCents: number }> {
  await creditOrderIfEligible(fx.tenantId, await order(fx, 2));
  const voucher = (await getLoyaltySummary(fx.tenantId, fx.customerId)).vouchers[0]!;
  const armed = await setVoucherArmed(fx.tenantId, fx.customerId, voucher.id, true);
  if (!armed.ok) throw new Error(`arming failed: ${armed.error}`);
  return { id: voucher.id, valueCents: voucher.valueCents };
}

/** The stored order row, for the columns redemption writes. */
async function orderRow(
  tenantId: string,
  orderId: string,
): Promise<{
  totalCents: number;
  discountCents: number;
  discountPoints: number;
  voucherId: string | null;
  paymentStatus: string;
  paymentProvider: string | null;
}> {
  return asTenant(tenantId, (tx) =>
    tx.order.findFirstOrThrow({
      where: { id: orderId },
      select: {
        totalCents: true,
        discountCents: true,
        discountPoints: true,
        voucherId: true,
        paymentStatus: true,
        paymentProvider: true,
      },
    }),
  );
}

const ON = {
  enabled: true,
  minOrderCents: 2000,
  pointsPerOrder: 5,
  rewardPoints: 100,
  rewardValueCents: 2000,
  // A year, the default since rewards stopped dying at the end of the
  // month they were earned in.
  voucherExpiryMonths: 12,
};

// One cleanup for the whole file: every describe below mints its own
// tenant, and a per-describe hook would run before the later ones had.
afterAll(async () => {
  for (const tid of tenantIds) {
    await asTenant(tid, (tx) => tx.loyaltyLedger.deleteMany({}));
    await asTenant(tid, (tx) => tx.loyaltyVoucher.deleteMany({}));
    await asTenant(tid, (tx) => tx.orderItem.deleteMany({}));
    await asTenant(tid, (tx) => tx.order.deleteMany({}));
    await asTenant(tid, (tx) => tx.customer.deleteMany({}));
    await asTenant(tid, (tx) => tx.membership.deleteMany({}));
    await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("loyalty earning", () => {
  it("credits a qualifying order once, however often it is settled", async () => {
    const fx = await fixture(ON);
    const orderId = await order(fx, 2); // €24.90 ≥ €20 minimum

    expect(await creditOrderIfEligible(fx.tenantId, orderId)).toEqual({
      credited: true,
      points: 5,
    });
    // The webhook, /pay/verify and the dashboard reconcile all call this
    // for the same order — the second and third must be no-ops.
    expect(await creditOrderIfEligible(fx.tenantId, orderId)).toEqual({
      credited: false,
      points: 0,
    });
    expect(await creditOrderIfEligible(fx.tenantId, orderId)).toEqual({
      credited: false,
      points: 0,
    });

    const summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary.balance).toBe(5);
    expect(summary.history).toHaveLength(1);
    expect(summary.history[0]).toMatchObject({ delta: 5, reason: "order" });
    // The history entry knows which order it came from.
    expect(summary.history[0]?.orderNumber).toBeTypeOf("number");
  });

  it("earns nothing below the minimum order value", async () => {
    const fx = await fixture(ON);
    const orderId = await order(fx, 1); // €12.45 < €20
    expect(await creditOrderIfEligible(fx.tenantId, orderId)).toEqual({
      credited: false,
      points: 0,
    });
    expect((await getLoyaltySummary(fx.tenantId, fx.customerId)).balance).toBe(0);
  });

  it("earns nothing for a guest who is not signed in", async () => {
    const fx = await fixture(ON);
    const orderId = await order(fx, 3, false);
    expect(await creditOrderIfEligible(fx.tenantId, orderId)).toEqual({
      credited: false,
      points: 0,
    });
    expect((await getLoyaltySummary(fx.tenantId, fx.customerId)).balance).toBe(0);
  });

  it("earns nothing while the owner has loyalty switched off", async () => {
    const fx = await fixture({ ...ON, enabled: false });
    const orderId = await order(fx, 3);
    expect(await creditOrderIfEligible(fx.tenantId, orderId)).toEqual({
      credited: false,
      points: 0,
    });
    // And the summary tells the client nothing at all about the venue's
    // numbers while it is off.
    const summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary).toMatchObject({
      enabled: false,
      balance: 0,
      rewardPoints: 0,
      rewardValueCents: 0,
      minOrderCents: 0,
      pointsPerOrder: 0,
      vouchers: [],
      history: [],
    });
  });

  it("excludes the delivery fee from the qualifying value", async () => {
    // €19.92 of food (2 × €9.96) plus a €5 delivery fee tops €20 in total
    // but must NOT earn: the fee is not food.
    const fx = await fixture({ ...ON, minOrderCents: 2000 });
    const orderId = await asTenant(fx.tenantId, async (tx) => {
      const created = await tx.order.create({
        data: {
          tenantId: fx.tenantId,
          venueId: fx.venueId,
          orderNumber: 9001,
          orderType: "delivery",
          customerId: fx.customerId,
          customerName: "Guest",
          customerPhone: "0170 1",
          deliveryAddress: { street: "Hauptstr. 1", zip: "60311", city: "Frankfurt" },
          totalCents: 2492,
          currency: "EUR",
          items: {
            create: [
              {
                tenantId: fx.tenantId,
                itemId: fx.itemId,
                name: "Biryani",
                priceCents: 996,
                quantity: 2,
              },
              {
                tenantId: fx.tenantId,
                itemId: null,
                name: "Delivery fee",
                priceCents: 500,
                quantity: 1,
              },
            ],
          },
        },
        select: { id: true },
      });
      return created.id;
    });
    expect(await creditOrderIfEligible(fx.tenantId, orderId)).toEqual({
      credited: false,
      points: 0,
    });
  });

  it("gives the points back when an order is reversed, once", async () => {
    const fx = await fixture(ON);
    const orderId = await order(fx, 2);
    await creditOrderIfEligible(fx.tenantId, orderId);
    expect((await getLoyaltySummary(fx.tenantId, fx.customerId)).balance).toBe(5);

    expect(await reverseOrderCredit(fx.tenantId, orderId)).toEqual({
      credited: true,
      points: -5,
    });
    expect((await getLoyaltySummary(fx.tenantId, fx.customerId)).balance).toBe(0);
    // A second cancel (or a retried one) must not pay the guest twice.
    expect(await reverseOrderCredit(fx.tenantId, orderId)).toEqual({
      credited: false,
      points: 0,
    });
    expect((await getLoyaltySummary(fx.tenantId, fx.customerId)).balance).toBe(0);
  });

  it("reverses nothing for an order that never earned", async () => {
    const fx = await fixture(ON);
    const orderId = await order(fx, 1);
    expect(await reverseOrderCredit(fx.tenantId, orderId)).toEqual({
      credited: false,
      points: 0,
    });
  });
});

describe("loyalty threshold", () => {
  it("mints exactly one voucher at the threshold and debits the points", async () => {
    // 5 points per order, 10 for a reward: two qualifying orders = one
    // voucher and a balance back at zero.
    const fx = await fixture({ ...ON, rewardPoints: 10, rewardValueCents: 1500 });
    const first = await order(fx, 2);
    await creditOrderIfEligible(fx.tenantId, first);
    let summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary.balance).toBe(5);
    expect(summary.vouchers).toHaveLength(0);

    const second = await order(fx, 2);
    await creditOrderIfEligible(fx.tenantId, second);
    summary = await getLoyaltySummary(fx.tenantId, fx.customerId);

    expect(summary.vouchers).toHaveLength(1);
    expect(summary.vouchers[0]).toMatchObject({ valueCents: 1500, status: "available" });
    expect(summary.balance).toBe(0);
    // Earned 5 + 5, spent 10: the debit is its own ledger row.
    expect(summary.history.filter((h) => h.reason === "voucher")).toHaveLength(1);
    expect(summary.history.find((h) => h.reason === "voucher")?.delta).toBe(-10);
    expect(summary.history.find((h) => h.reason === "voucher")?.orderNumber).toBeNull();
  });

  /** The month a voucher minted NOW should die in, `months` out, as
   *  "YYYY-MM" in the venue's own zone. */
  function venueMonthAhead(months: number): string {
    const now = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
    })
      .format(new Date())
      .split("-")
      .map(Number);
    const exclusive = (now[1] ?? 1) - 1 + months;
    const year = (now[0] ?? 0) + Math.floor(exclusive / 12);
    return `${year}-${String((exclusive % 12) + 1).padStart(2, "0")}`;
  }

  /** The venue-local Y-M-D h:m:s of an instant, as one lookup. */
  function berlinParts(at: Date): (kind: string) => string {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(at);
    return (kind) => parts.find((p) => p.type === kind)?.value ?? "";
  }

  it("expires the voucher a YEAR out, at the last second of that month", async () => {
    const fx = await fixture({ ...ON, rewardPoints: 5, rewardValueCents: 2000 });
    const orderId = await order(fx, 2);
    await creditOrderIfEligible(fx.tenantId, orderId);
    const summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary.vouchers).toHaveLength(1);

    const expires = new Date(summary.vouchers[0]!.expiresAt);
    const get = berlinParts(expires);
    expect(`${get("hour")}:${get("minute")}:${get("second")}`).toBe("23:59:59");
    // Twelve months out, not this one — the whole point of the change.
    expect(`${get("year")}-${get("month")}`).toBe(venueMonthAhead(12));
    // Tomorrow is the 1st of the NEXT month, which proves "last day".
    const next = new Date(expires.getTime() + 1000);
    expect(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", day: "2-digit" }).format(next),
    ).toBe("01");
  });

  /**
   * Every venue that ever pressed Save on the old Loyalty form stored a
   * 0, which used to mean "dies at the end of the month it was earned
   * in". The config parser reads that as "never chose" and hands the
   * service the new default, so the rows this mints must look exactly
   * like the ones above — a stored 0 must not still be minting
   * three-day rewards.
   */
  it("mints a year-long voucher for a venue still holding the old 0", async () => {
    const fx = await fixture({ ...ON, rewardPoints: 5, voucherExpiryMonths: 0 });
    const orderId = await order(fx, 2);
    await creditOrderIfEligible(fx.tenantId, orderId);
    const summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary.vouchers).toHaveLength(1);

    const get = berlinParts(new Date(summary.vouchers[0]!.expiresAt));
    expect(`${get("year")}-${get("month")}`).toBe(venueMonthAhead(12));
    expect(`${get("hour")}:${get("minute")}:${get("second")}`).toBe("23:59:59");
  });

  it("computes expiry per timezone and per month offset", () => {
    // 2026-01-15 22:30 UTC is already 2026-01-16 in Berlin — same month,
    // so the boundary is 31 Jan 23:59:59 local = 22:59:59 UTC.
    const at = new Date("2026-01-15T22:30:00Z");
    expect(voucherExpiry("Europe/Berlin", 0, at).toISOString()).toBe("2026-01-31T22:59:59.000Z");
    // +1 month rolls to the end of February (28 days in 2026).
    expect(voucherExpiry("Europe/Berlin", 1, at).toISOString()).toBe("2026-02-28T22:59:59.000Z");
    // Year rollover from December.
    const dec = new Date("2026-12-04T09:00:00Z");
    expect(voucherExpiry("Europe/Berlin", 1, dec).toISOString()).toBe("2027-01-31T22:59:59.000Z");
  });
});

describe("voucher minting", () => {
  /**
   * The voucher records what it COST, not only what it is worth.
   *
   * `pointsSpent` has been written since minting shipped but nothing ever
   * read it, so nothing would have caught it drifting. It is now the
   * source of `orders.discount_points`, which every surface that draws
   * the reward line reads — quoted from the voucher rather than from the
   * venue's current `rewardPoints`, so an owner who later raises the
   * price of a reward does not rewrite what last month's guest paid.
   */
  it("records the points a minted voucher cost, at the rate in force then", async () => {
    const fx = await fixture({ ...ON, rewardPoints: 5 });
    await creditOrderIfEligible(fx.tenantId, await order(fx, 2));

    const vouchers = await asTenant(fx.tenantId, (tx) =>
      tx.loyaltyVoucher.findMany({ select: { valueCents: true, pointsSpent: true } }),
    );
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({ pointsSpent: 5, valueCents: ON.rewardValueCents });

    // Raising the price of a reward does not rewrite the one already won.
    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({ data: { loyalty: { ...ON, rewardPoints: 50 } } }),
    );
    expect(
      await asTenant(fx.tenantId, (tx) =>
        tx.loyaltyVoucher.findFirstOrThrow({ select: { pointsSpent: true } }),
      ),
    ).toMatchObject({ pointsSpent: 5 });
  });
});

describe("arming a voucher", () => {
  it("toggles available ⇄ armed and refuses terminal vouchers", async () => {
    const fx = await fixture({ ...ON, rewardPoints: 5 });
    const orderId = await order(fx, 2);
    await creditOrderIfEligible(fx.tenantId, orderId);
    const voucherId = (await getLoyaltySummary(fx.tenantId, fx.customerId)).vouchers[0]!.id;

    const armed = await setVoucherArmed(fx.tenantId, fx.customerId, voucherId, true);
    expect(armed).toMatchObject({ ok: true, voucher: { id: voucherId, status: "armed" } });
    const disarmed = await setVoucherArmed(fx.tenantId, fx.customerId, voucherId, false);
    expect(disarmed).toMatchObject({ ok: true, voucher: { status: "available" } });

    expect(await setVoucherArmed(fx.tenantId, fx.customerId, "nope", true)).toEqual({
      ok: false,
      error: "not_found",
    });

    await asTenant(fx.tenantId, (tx) =>
      tx.loyaltyVoucher.updateMany({ where: { id: voucherId }, data: { status: "redeemed" } }),
    );
    expect(await setVoucherArmed(fx.tenantId, fx.customerId, voucherId, true)).toEqual({
      ok: false,
      error: "not_armable",
    });
  });

  it("expires a stale voucher lazily on read", async () => {
    const fx = await fixture({ ...ON, rewardPoints: 5 });
    const orderId = await order(fx, 2);
    await creditOrderIfEligible(fx.tenantId, orderId);
    const voucherId = (await getLoyaltySummary(fx.tenantId, fx.customerId)).vouchers[0]!.id;

    await asTenant(fx.tenantId, (tx) =>
      tx.loyaltyVoucher.updateMany({
        where: { id: voucherId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      }),
    );
    // No cron ran — the read itself is what expires it.
    const summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary.vouchers[0]).toMatchObject({ id: voucherId, status: "expired" });
    expect(await setVoucherArmed(fx.tenantId, fx.customerId, voucherId, true)).toEqual({
      ok: false,
      error: "not_armable",
    });
  });
});

describe("redeeming a voucher", () => {
  // One qualifying order earns the whole reward, so every test below can
  // get to an armed voucher in two lines.
  const REDEEMABLE = { ...ON, rewardPoints: 5, rewardValueCents: 2000 };

  it("spends the armed voucher when the app asks for it", async () => {
    const fx = await fixture(REDEEMABLE);
    const voucher = await armedVoucher(fx);

    // €24.90 of food, €20 reward → €4.90 left to pay.
    const result = await placed(fx, 2, { redeemVoucher: true });
    expect(result).toMatchObject({
      discountCents: 2000,
      chargedCents: 490,
      totalCents: 490,
      paidByVoucher: false,
    });

    // The order carries the discount and the voucher that paid for it;
    // the LINES keep their menu prices (the kitchen cooks the same food).
    expect(await orderRow(fx.tenantId, result.orderId)).toMatchObject({
      totalCents: 490,
      discountCents: 2000,
      // Copied off the voucher at placement. Every surface that draws the
      // reward line names the points, and `voucherId` has no relation to
      // join through — so the order has to carry the number itself.
      discountPoints: 5,
      voucherId: voucher.id,
      paymentStatus: "none",
    });

    const summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary.vouchers[0]).toMatchObject({
      id: voucher.id,
      status: "redeemed",
      redeemedOrderNumber: result.orderNumber,
    });
    // The history line the app lists as "€20 reward used · Order #0002":
    // no points move, the voucher itself was the payment, and the line
    // carries the voucher's own value so the app never has to guess.
    const redeem = summary.history.find((h) => h.reason === "redeem");
    expect(redeem).toMatchObject({
      delta: 0,
      orderNumber: result.orderNumber,
      valueCents: 2000,
    });
    // The minting line quotes the same voucher; earning quotes none.
    expect(summary.history.find((h) => h.reason === "voucher")?.valueCents).toBe(2000);
    expect(summary.history.find((h) => h.reason === "order")?.valueCents).toBeNull();

    // And history does not re-price itself when the owner changes the
    // reward: a guest who spent a €20 voucher must still read €20 after
    // the venue moves to €25.
    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({
        where: { id: fx.venueId },
        data: { loyalty: { ...REDEEMABLE, rewardValueCents: 2500 } },
      }),
    );
    const later = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(later.rewardValueCents).toBe(2500);
    expect(later.history.find((h) => h.reason === "redeem")?.valueCents).toBe(2000);
    expect(later.vouchers[0]?.valueCents).toBe(2000);
  });

  it("places an ordinary order when nothing is armed", async () => {
    const fx = await fixture(REDEEMABLE);
    await creditOrderIfEligible(fx.tenantId, await order(fx, 2));
    const voucherId = (await getLoyaltySummary(fx.tenantId, fx.customerId)).vouchers[0]!.id;

    // The guest holds a voucher but never armed it: asking to redeem is
    // not an error, it simply finds nothing to spend.
    const result = await placed(fx, 2, { redeemVoucher: true });
    expect(result).toMatchObject({ discountCents: 0, chargedCents: 2490, totalCents: 2490 });
    expect(await orderRow(fx.tenantId, result.orderId)).toMatchObject({
      discountCents: 0,
      discountPoints: 0,
      voucherId: null,
    });
    const summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary.vouchers[0]).toMatchObject({
      id: voucherId,
      status: "available",
      redeemedOrderNumber: null,
    });
  });

  it("never spends a voucher for a web order, even with one armed", async () => {
    const fx = await fixture(REDEEMABLE);
    const voucher = await armedVoucher(fx);

    // The website sends no `redeemVoucher` — the reward must survive.
    const result = await placed(fx, 2);
    expect(result).toMatchObject({ discountCents: 0, totalCents: 2490, paidByVoucher: false });
    expect(await orderRow(fx.tenantId, result.orderId)).toMatchObject({ voucherId: null });
    expect((await getLoyaltySummary(fx.tenantId, fx.customerId)).vouchers[0]).toMatchObject({
      id: voucher.id,
      status: "armed",
    });
  });

  it("settles the order at placement when the reward covers the whole bill", async () => {
    const fx = await fixture({ ...REDEEMABLE, rewardValueCents: 5000 });
    await armedVoucher(fx);

    // €12.45 of food against a €50 reward: nothing to collect, and the
    // discount is capped at the bill — no change is ever given.
    const result = await placed(fx, 1, { redeemVoucher: true });
    expect(result).toMatchObject({
      discountCents: 1245,
      chargedCents: 0,
      totalCents: 0,
      paidByVoucher: true,
    });
    expect(await orderRow(fx.tenantId, result.orderId)).toMatchObject({
      totalCents: 0,
      discountCents: 1245,
      // A reward that covered the WHOLE bill still says what it cost —
      // the "paid with reward" marker alone never does.
      discountPoints: 5,
      paymentStatus: "paid",
      paymentProvider: "voucher",
    });
  });

  it("refuses a voucher that expired while it sat armed", async () => {
    const fx = await fixture(REDEEMABLE);
    const voucher = await armedVoucher(fx);
    await asTenant(fx.tenantId, (tx) =>
      tx.loyaltyVoucher.updateMany({
        where: { id: voucher.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      }),
    );

    const result = await placed(fx, 2, { redeemVoucher: true });
    expect(result.discountCents).toBe(0);
    expect((await getLoyaltySummary(fx.tenantId, fx.customerId)).vouchers[0]).toMatchObject({
      status: "expired",
    });
  });

  it("earns on the CHARGED total, not the menu one", async () => {
    // €24.90 of food, €20 reward, €20 minimum: the guest paid €4.90, so
    // the order that spent a reward must not earn most of the next one.
    const fx = await fixture(REDEEMABLE);
    await armedVoucher(fx);
    const discounted = await placed(fx, 2, { redeemVoucher: true });
    expect(await creditOrderIfEligible(fx.tenantId, discounted.orderId)).toEqual({
      credited: false,
      points: 0,
    });

    // A small reward leaves the charged total above the minimum, and that
    // order earns exactly like any other.
    const fx2 = await fixture({ ...REDEEMABLE, rewardValueCents: 200 });
    await armedVoucher(fx2);
    const barely = await placed(fx2, 2, { redeemVoucher: true }); // €24.90 − €2
    expect(barely.chargedCents).toBe(2290);
    expect(await creditOrderIfEligible(fx2.tenantId, barely.orderId)).toEqual({
      credited: true,
      points: 5,
    });
  });

  it("gives the voucher back when the order is cancelled", async () => {
    const fx = await fixture(REDEEMABLE);
    const voucher = await armedVoucher(fx);
    const spent = await placed(fx, 2, { redeemVoucher: true });
    await creditOrderIfEligible(fx.tenantId, spent.orderId); // below minimum: earns nothing

    await reverseOrderCredit(fx.tenantId, spent.orderId);

    const summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary.vouchers[0]).toMatchObject({
      id: voucher.id,
      status: "available",
      redeemedOrderNumber: null,
    });
    // The "reward used" line goes with it — the wallet and the history
    // must not disagree about whether the guest still holds the meal.
    expect(summary.history.filter((h) => h.reason === "redeem")).toHaveLength(0);
    // And a second cancel is a no-op rather than a second refund.
    await reverseOrderCredit(fx.tenantId, spent.orderId);
    expect((await getLoyaltySummary(fx.tenantId, fx.customerId)).vouchers[0]).toMatchObject({
      status: "available",
    });
  });

  it("returns an expired voucher as expired, not as a second chance", async () => {
    const fx = await fixture(REDEEMABLE);
    const voucher = await armedVoucher(fx);
    const spent = await placed(fx, 2, { redeemVoucher: true });
    // The month turned over while the order sat in the kitchen.
    await asTenant(fx.tenantId, (tx) =>
      tx.loyaltyVoucher.updateMany({
        where: { id: voucher.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      }),
    );

    await reverseOrderCredit(fx.tenantId, spent.orderId);
    expect((await getLoyaltySummary(fx.tenantId, fx.customerId)).vouchers[0]).toMatchObject({
      id: voucher.id,
      status: "expired",
    });
  });

  it("spends one voucher per order, never two", async () => {
    const fx = await fixture({ ...REDEEMABLE, rewardPoints: 5 });
    // Two qualifying orders, two vouchers; arm them both.
    await creditOrderIfEligible(fx.tenantId, await order(fx, 2));
    await creditOrderIfEligible(fx.tenantId, await order(fx, 2));
    const vouchers = (await getLoyaltySummary(fx.tenantId, fx.customerId)).vouchers;
    expect(vouchers).toHaveLength(2);
    for (const v of vouchers) await setVoucherArmed(fx.tenantId, fx.customerId, v.id, true);

    const result = await placed(fx, 4, { redeemVoucher: true }); // €49.80
    expect(result.discountCents).toBe(2000);
    expect(result.chargedCents).toBe(2980);
    const after = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(after.vouchers.filter((v) => v.status === "redeemed")).toHaveLength(1);
    expect(after.vouchers.filter((v) => v.status === "armed")).toHaveLength(1);
  });
});
