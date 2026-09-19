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
import { placeOrder } from "./order-service";
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
  const placed = await placeOrder(
    fx,
    { orderType: "dine_in", tableNumber: "3", items: [{ itemId: fx.itemId, quantity }] },
    { customerId: withCustomer ? fx.customerId : null },
  );
  if (!placed.ok) throw new Error(`order failed: ${placed.error}`);
  return placed.value.orderId;
}

const ON = {
  enabled: true,
  minOrderCents: 2000,
  pointsPerOrder: 5,
  rewardPoints: 100,
  rewardValueCents: 2000,
  voucherExpiryMonths: 0,
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

  it("expires the voucher at the last second of the venue's calendar month", async () => {
    const fx = await fixture({ ...ON, rewardPoints: 5, rewardValueCents: 2000 });
    const orderId = await order(fx, 2);
    await creditOrderIfEligible(fx.tenantId, orderId);
    const summary = await getLoyaltySummary(fx.tenantId, fx.customerId);
    expect(summary.vouchers).toHaveLength(1);

    const expires = new Date(summary.vouchers[0]!.expiresAt);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(expires);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
    // Venue-local 23:59:59 on the last day of the month it was earned.
    expect(`${get("hour")}:${get("minute")}:${get("second")}`).toBe("23:59:59");
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());
    expect(`${get("year")}-${get("month")}`).toBe(today);
    // Tomorrow is the 1st of the NEXT month, which proves "last day".
    const next = new Date(expires.getTime() + 1000);
    expect(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", day: "2-digit" }).format(next),
    ).toBe("01");
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
