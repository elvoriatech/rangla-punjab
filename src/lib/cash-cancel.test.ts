import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import { cancelCashOrderByGuest, cashCancelDeadline, isCashOrder } from "./cash-cancel";
import { placeOrder } from "./order-service";
import { asTenant } from "./tenant";

/**
 * The guest's own cancel on a CASH order: a time-boxed exit the server
 * enforces, whatever a (stale) screen still shows.
 */

const MIN = 60_000;
const base = {
  status: "placed",
  paymentStatus: "none",
  paymentProvider: null,
  createdAt: new Date(0),
};

describe("cashCancelDeadline", () => {
  it("opens for the configured minutes after placing a cash order", () => {
    const until = cashCancelDeadline(base, 10, new Date(9 * MIN));
    expect(until?.getTime()).toBe(10 * MIN);
    expect(cashCancelDeadline(base, 10, new Date(10 * MIN))).toBeNull();
  });

  it("is off at 0 minutes, for online orders, and once the food is ready", () => {
    expect(cashCancelDeadline(base, 0, new Date(1))).toBeNull();
    expect(
      cashCancelDeadline(
        { ...base, paymentStatus: "paid", paymentProvider: "stripe" },
        10,
        new Date(1),
      ),
    ).toBeNull();
    expect(cashCancelDeadline({ ...base, status: "preparing" }, 10, new Date(1))).not.toBeNull();
    expect(cashCancelDeadline({ ...base, status: "ready" }, 10, new Date(1))).toBeNull();
  });

  it("tells cash from a voucher- or card-settled order", () => {
    expect(isCashOrder(base)).toBe(true);
    expect(isCashOrder({ paymentStatus: "paid", paymentProvider: "voucher" })).toBe(false);
    expect(isCashOrder({ paymentStatus: "pending", paymentProvider: "stripe" })).toBe(false);
  });
});

const tenantIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
  for (const tid of tenantIds) {
    await asTenant(tid, (tx) => tx.orderItem.deleteMany({}));
    await asTenant(tid, (tx) => tx.order.deleteMany({}));
    await asTenant(tid, (tx) => tx.item.deleteMany({}));
    await asTenant(tid, (tx) => tx.category.deleteMany({}));
    await asTenant(tid, (tx) => tx.menu.updateMany({ data: { publishedVersion: null } }));
    await asTenant(tid, (tx) => tx.menuVersion.deleteMany({}));
    await asTenant(tid, (tx) => tx.menu.deleteMany({}));
    await asTenant(tid, (tx) => tx.venue.deleteMany({}));
    await asTenant(tid, (tx) => tx.membership.deleteMany({}));
    await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

/** A venue with one published €12.45 dish and `minutes` of cancel window. */
async function fixture(minutes: number): Promise<{
  tenantId: string;
  venueId: string;
  publishedVersionId: string;
  itemId: string;
}> {
  const s = await signupUser({
    email: `cash-cancel-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: "Cash Cancel",
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
        slug: `cc-${randomUUID().slice(0, 8)}`,
        currency: "EUR",
        ordering: { cashCancelMinutes: minutes },
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
    return {
      tenantId: s.tenantId,
      venueId: venue.id,
      publishedVersionId: version.id,
      itemId: item.id,
    };
  });
}

async function cashOrder(fx: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const placed = await placeOrder(
    fx,
    { orderType: "dine_in", tableNumber: "3", items: [{ itemId: fx.itemId, quantity: 1 }] },
    { customerId: null },
  );
  if (!placed.ok) throw new Error(`order failed: ${placed.error}`);
  return placed.value.orderId;
}

describe("cancelCashOrderByGuest", () => {
  it("cancels a cash order inside the window, once", async () => {
    const fx = await fixture(10);
    const orderId = await cashOrder(fx);
    expect(await cancelCashOrderByGuest(fx.tenantId, orderId)).toEqual({ ok: true });
    const row = await asTenant(fx.tenantId, (tx) =>
      tx.order.findFirst({ where: { id: orderId }, select: { status: true } }),
    );
    expect(row?.status).toBe("cancelled");
    expect(await cancelCashOrderByGuest(fx.tenantId, orderId)).toEqual({
      ok: false,
      error: "window_closed",
    });
  });

  it("refuses once the window has passed, and when the owner switched it off", async () => {
    const fx = await fixture(10);
    const orderId = await cashOrder(fx);
    const later = new Date(Date.now() + 11 * MIN);
    expect(await cancelCashOrderByGuest(fx.tenantId, orderId, later)).toEqual({
      ok: false,
      error: "window_closed",
    });
    const off = await fixture(0);
    expect(await cancelCashOrderByGuest(off.tenantId, await cashOrder(off))).toEqual({
      ok: false,
      error: "window_closed",
    });
  });

  it("refuses an order the kitchen already marked ready", async () => {
    const fx = await fixture(10);
    const orderId = await cashOrder(fx);
    await asTenant(fx.tenantId, (tx) =>
      tx.order.update({ where: { id: orderId }, data: { status: "ready" } }),
    );
    expect(await cancelCashOrderByGuest(fx.tenantId, orderId)).toEqual({
      ok: false,
      error: "window_closed",
    });
  });
});
