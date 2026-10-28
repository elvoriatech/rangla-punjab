import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { asTenant } from "./tenant";
import { signupUser } from "./auth-service";
import { signInCustomer } from "./customer-auth";
import {
  autoCloseEarlierDays,
  autoCompletePickups,
  isPickupDue,
  PICKUP_AUTO_DONE_AFTER_MS,
} from "./pickup-autodone";

const MIN = 60 * 1000;
const defaults = { etaPickupMinutes: 20, etaDeliveryMinutes: 50, etaAcceptSeconds: 30 };

function timing(over: Partial<Parameters<typeof isPickupDue>[0]> = {}) {
  const placed = new Date("2026-10-23T12:00:00Z");
  return {
    orderType: "takeaway",
    status: "ready",
    paymentStatus: "none",
    requestedFor: null,
    createdAt: placed,
    paidAt: null,
    etaMinutes: 15,
    ...over,
  };
}

describe("pickup orders close 20 min after their pickup time (rule)", () => {
  const placed = new Date("2026-10-23T12:00:00Z").getTime();

  it("ASAP pickup: due 20 min after the promised time (accepted minutes)", () => {
    // Promised 12:15 (15 accepted minutes) → due from 12:35.
    expect(isPickupDue(timing(), defaults, new Date(placed + 34 * MIN))).toBe(false);
    expect(isPickupDue(timing(), defaults, new Date(placed + 35 * MIN))).toBe(true);
  });

  it("never accepted (auto-accepted, still 'placed'): uses the venue default", () => {
    const o = timing({ status: "placed", etaMinutes: null });
    // Default 20 min → promised 12:20 → due from 12:40.
    expect(isPickupDue(o, defaults, new Date(placed + 39 * MIN))).toBe(false);
    expect(isPickupDue(o, defaults, new Date(placed + 40 * MIN))).toBe(true);
  });

  it("a planned pickup uses the time the guest chose", () => {
    const o = timing({ requestedFor: new Date(placed + 3 * 60 * MIN) });
    expect(isPickupDue(o, defaults, new Date(placed + 3 * 60 * MIN + 19 * MIN))).toBe(false);
    expect(isPickupDue(o, defaults, new Date(placed + 3 * 60 * MIN + 20 * MIN))).toBe(true);
  });

  it("an online order paid later counts from when it reached the board", () => {
    const o = timing({ paymentStatus: "paid", paidAt: new Date(placed + 10 * MIN) });
    // Board 12:10 + 15 → 12:25 → due from 12:45.
    expect(isPickupDue(o, defaults, new Date(placed + 44 * MIN))).toBe(false);
    expect(isPickupDue(o, defaults, new Date(placed + 45 * MIN))).toBe(true);
  });

  it("never: unpaid online, delivery, dine-in, done or cancelled", () => {
    const late = new Date(placed + 10 * 60 * MIN);
    expect(isPickupDue(timing({ paymentStatus: "pending" }), defaults, late)).toBe(false);
    expect(isPickupDue(timing({ paymentStatus: "failed" }), defaults, late)).toBe(false);
    expect(isPickupDue(timing({ orderType: "delivery" }), defaults, late)).toBe(false);
    expect(isPickupDue(timing({ orderType: "dine_in" }), defaults, late)).toBe(false);
    expect(isPickupDue(timing({ status: "done" }), defaults, late)).toBe(false);
    expect(isPickupDue(timing({ status: "cancelled" }), defaults, late)).toBe(false);
  });

  it("the wait is 20 minutes", () => {
    expect(PICKUP_AUTO_DONE_AFTER_MS).toBe(20 * MIN);
  });
});

describe("autoCompletePickups (database)", () => {
  const tenants: string[] = [];
  const users: string[] = [];

  afterEach(async () => {
    for (const t of tenants) {
      await asTenant(t, (tx) => tx.membership.deleteMany({}));
      await asTenant(t, (tx) => tx.tenant.deleteMany({}));
    }
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    tenants.length = 0;
    users.length = 0;
  });

  async function setup() {
    const s = await signupUser({
      email: `pickup-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Pickup Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenants.push(s.tenantId);
    users.push(s.userId);
    const venueId = await asTenant(s.tenantId, async (tx) => {
      const v = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Pickup Venue",
          slug: `pu-${randomUUID().slice(0, 8)}`,
        },
        select: { id: true },
      });
      return v.id;
    });
    let n = 0;
    const order = (over: Record<string, unknown>) =>
      asTenant(s.tenantId, (tx) =>
        tx.order.create({
          data: {
            tenantId: s.tenantId,
            venueId,
            orderNumber: ++n,
            orderSeries: "B",
            orderType: "takeaway",
            status: "ready",
            paymentStatus: "none",
            currency: "EUR",
            totalCents: 1000,
            createdAt: new Date(Date.now() - 2 * 60 * MIN),
            ...over,
          },
          select: { id: true },
        }),
      ).then((o) => o.id);
    const status = (id: string) =>
      asTenant(s.tenantId, (tx) =>
        tx.order.findFirstOrThrow({ where: { id }, select: { status: true } }),
      ).then((o) => o.status);
    return { tenantId: s.tenantId, order, status };
  }

  it("closes due pickups, leaves everything else, and records it in the history", async () => {
    const t = await setup();
    const dueReady = await t.order({});
    const dueUntouched = await t.order({ status: "placed" });
    const duePaidOnline = await t.order({
      orderSeries: "O",
      paymentStatus: "paid",
      paidAt: new Date(Date.now() - 2 * 60 * MIN),
    });
    const notYet = await t.order({ createdAt: new Date(Date.now() - 10 * MIN) });
    const plannedLater = await t.order({ requestedFor: new Date(Date.now() + 60 * MIN) });
    const unpaidOnline = await t.order({ orderSeries: "O", paymentStatus: "pending" });
    const delivery = await t.order({ orderType: "delivery" });
    const dineIn = await t.order({ orderType: "dine_in" });
    const cancelled = await t.order({ status: "cancelled" });

    expect(await autoCompletePickups(t.tenantId)).toBe(3);
    expect(await t.status(dueReady)).toBe("done");
    expect(await t.status(dueUntouched)).toBe("done");
    expect(await t.status(duePaidOnline)).toBe("done");
    expect(await t.status(notYet)).toBe("ready");
    expect(await t.status(plannedLater)).toBe("ready");
    expect(await t.status(unpaidOnline)).toBe("ready");
    expect(await t.status(delivery)).toBe("ready");
    expect(await t.status(dineIn)).toBe("ready");
    expect(await t.status(cancelled)).toBe("cancelled");

    const history = await asTenant(t.tenantId, (tx) =>
      tx.orderEvent.findMany({
        where: { orderId: dueReady },
        select: { kind: true, actor: true, summary: true },
      }),
    );
    expect(history).toEqual([
      {
        kind: "order.status",
        actor: "system",
        summary: "ready → done (automatically, 20 min after the pickup time)",
      },
    ]);

    // Running again changes nothing.
    expect(await autoCompletePickups(t.tenantId)).toBe(0);
  });

  it("after midnight, any order still open from an earlier day is closed (day close)", async () => {
    const t = await setup();
    const yesterday = new Date(Date.now() - 30 * 60 * MIN);
    const oldDelivery = await t.order({
      orderType: "delivery",
      status: "out_for_delivery",
      createdAt: yesterday,
    });
    const oldDineIn = await t.order({
      orderType: "dine_in",
      status: "preparing",
      createdAt: yesterday,
    });
    const oldPlaced = await t.order({ status: "placed", createdAt: yesterday });
    const oldUnpaidOnline = await t.order({
      orderSeries: "O",
      paymentStatus: "pending",
      createdAt: yesterday,
    });
    const oldCancelled = await t.order({ status: "cancelled", createdAt: yesterday });
    // Placed a minute ago: today, whatever the time of day the test runs.
    const todayOpen = await t.order({
      orderType: "dine_in",
      createdAt: new Date(Date.now() - MIN),
    });

    expect(await autoCloseEarlierDays(t.tenantId)).toBe(3);
    expect(await t.status(oldDelivery)).toBe("done");
    expect(await t.status(oldDineIn)).toBe("done");
    expect(await t.status(oldPlaced)).toBe("done");
    expect(await t.status(oldUnpaidOnline)).toBe("ready");
    expect(await t.status(oldCancelled)).toBe("cancelled");
    expect(await t.status(todayOpen)).toBe("ready");

    const history = await asTenant(t.tenantId, (tx) =>
      tx.orderEvent.findMany({ where: { orderId: oldDineIn }, select: { summary: true } }),
    );
    expect(history).toEqual([{ summary: "preparing → done (automatically, the day ended)" }]);
    expect(await autoCloseEarlierDays(t.tenantId)).toBe(0);
  });

  it("a cash pickup closed automatically earns the guest's loyalty points, like a manual close", async () => {
    const s = await signupUser({
      email: `pickup-loy-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Pickup Loyalty",
    });
    if (!s.ok) throw new Error("signup failed");
    tenants.push(s.tenantId);
    users.push(s.userId);
    const venueId = await asTenant(s.tenantId, async (tx) => {
      const v = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Loyalty Venue",
          slug: `pl-${randomUUID().slice(0, 8)}`,
          currency: "EUR",
          loyalty: {
            enabled: true,
            minOrderCents: 2000,
            pointsPerOrder: 5,
            rewardPoints: 100,
            rewardValueCents: 2000,
            voucherExpiryMonths: 12,
          },
        },
        select: { id: true },
      });
      return v.id;
    });
    const guest = await signInCustomer(s.tenantId, "dev", {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `guest-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Guest",
    });
    const orderId = await asTenant(s.tenantId, (tx) =>
      tx.order.create({
        data: {
          tenantId: s.tenantId,
          venueId,
          customerId: guest.customerId,
          orderNumber: 1,
          orderSeries: "B",
          orderType: "takeaway",
          status: "ready",
          paymentStatus: "none",
          currency: "EUR",
          totalCents: 2500,
          createdAt: new Date(Date.now() - 2 * 60 * MIN),
        },
        select: { id: true },
      }),
    ).then((o) => o.id);

    expect(await autoCompletePickups(s.tenantId)).toBe(1);
    const credited = await asTenant(s.tenantId, (tx) =>
      tx.loyaltyLedger.findMany({ where: { orderId }, select: { delta: true, reason: true } }),
    );
    expect(credited).toEqual([{ delta: 5, reason: "order" }]);
    await asTenant(s.tenantId, (tx) => tx.loyaltyLedger.deleteMany({}));
  });
});
