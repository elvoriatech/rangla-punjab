import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import { guestExpectedAt, orderEta, withinAcceptWindow, type EtaOrder } from "./order-eta";
import { acceptOrderWithEta } from "./order-service";
import { clampEtaMinutes, parseOrderingConfig } from "./ordering-config";
import { asTenant } from "./tenant";

const T0 = new Date("2026-10-01T18:10:00.000Z");
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);
const base: EtaOrder = {
  orderType: "delivery",
  status: "placed",
  requestedFor: null,
  createdAt: T0,
  paidAt: null,
  etaMinutes: null,
};

describe("orderEta — the promised time of an order", () => {
  it("defaults to 50 min for delivery and 20 for pickup, counted from the order", () => {
    expect(orderEta(base, undefined, at(5))).toMatchObject({
      minutes: 50,
      accepted: false,
      expectedAt: at(50 * 60),
      adjustableUntil: at(30),
    });
    expect(orderEta({ ...base, orderType: "takeaway" }, undefined, at(5))?.minutes).toBe(20);
  });

  it("takes the venue's own defaults and accept window", () => {
    const config = { etaDeliveryMinutes: 35, etaPickupMinutes: 15, etaAcceptSeconds: 60 };
    const eta = orderEta(base, config, at(45));
    expect(eta?.minutes).toBe(35);
    expect(eta?.adjustableUntil).toEqual(at(60));
  });

  it("is adjustable only inside the window, and only while untouched", () => {
    expect(orderEta(base, undefined, at(29))?.adjustableUntil).toEqual(at(30));
    expect(orderEta(base, undefined, at(30))?.adjustableUntil).toBeNull();
    // Moved on by the kitchen screen's plain button: no longer adjustable.
    expect(
      orderEta({ ...base, status: "preparing" }, undefined, at(5))?.adjustableUntil,
    ).toBeNull();
    // Accepted: fixed at what the restaurant chose.
    expect(
      orderEta({ ...base, etaMinutes: 65, status: "preparing" }, undefined, at(5)),
    ).toMatchObject({
      minutes: 65,
      accepted: true,
      adjustableUntil: null,
      expectedAt: at(65 * 60),
    });
  });

  it("counts an online order from when it was paid", () => {
    const paid = { ...base, paidAt: at(120) };
    const eta = orderEta(paid, undefined, at(125));
    expect(eta?.adjustableUntil).toEqual(at(150));
    expect(eta?.expectedAt).toEqual(at(120 + 50 * 60));
  });

  it("has no promise for planned or dine-in orders", () => {
    expect(orderEta({ ...base, requestedFor: at(7200) }, undefined, at(5))).toBeNull();
    expect(orderEta({ ...base, orderType: "dine_in" }, undefined, at(5))).toBeNull();
  });

  it("shows the guest the time only once it can no longer move", () => {
    const order = { ...base, paymentStatus: "none" };
    expect(guestExpectedAt(order, undefined, at(10))).toBeNull(); // window still open
    expect(guestExpectedAt(order, undefined, at(31))).toEqual(at(50 * 60));
    expect(
      guestExpectedAt({ ...order, etaMinutes: 40, status: "preparing" }, undefined, at(10)),
    ).toEqual(at(40 * 60));
    // Finished, cancelled, or not yet paid: nothing to promise.
    expect(guestExpectedAt({ ...order, status: "done" }, undefined, at(99))).toBeNull();
    expect(guestExpectedAt({ ...order, status: "cancelled" }, undefined, at(99))).toBeNull();
    expect(guestExpectedAt({ ...order, paymentStatus: "pending" }, undefined, at(99))).toBeNull();
  });

  it("gives a late tap a few seconds of grace, no more", () => {
    expect(withinAcceptWindow(base, undefined, at(33))).toBe(true);
    expect(withinAcceptWindow(base, undefined, at(36))).toBe(false);
  });

  it("snaps minutes to the stepper's grid and settings to their ranges", () => {
    expect(clampEtaMinutes(52, 50)).toBe(50);
    expect(clampEtaMinutes(53, 50)).toBe(55);
    expect(clampEtaMinutes(1, 50)).toBe(5);
    expect(clampEtaMinutes(999, 50)).toBe(180);
    expect(clampEtaMinutes("x", 50)).toBe(50);
    const config = parseOrderingConfig({ etaDeliveryMinutes: 47, etaAcceptSeconds: 5 });
    expect(config).toMatchObject({
      etaDeliveryMinutes: 45,
      etaPickupMinutes: 20,
      etaAcceptSeconds: 10,
    });
    expect(parseOrderingConfig({})).toMatchObject({
      etaDeliveryMinutes: 50,
      etaPickupMinutes: 20,
      etaAcceptSeconds: 30,
    });
  });
});

describe("acceptOrderWithEta", () => {
  let ownerId: string;
  let tenantId: string;
  let venueId: string;
  let email: string;
  let n = 1;

  function order(
    over: { orderType?: string; status?: string; createdAt?: Date; requestedFor?: Date } = {},
  ): Promise<{ id: string }> {
    return asTenant(tenantId, (tx) =>
      tx.order.create({
        data: {
          tenantId,
          venueId,
          orderNumber: n++,
          totalCents: 1500,
          currency: "EUR",
          orderType: over.orderType ?? "delivery",
          status: over.status ?? "placed",
          requestedFor: over.requestedFor ?? null,
          ...(over.createdAt ? { createdAt: over.createdAt } : {}),
        },
        select: { id: true },
      }),
    );
  }
  const read = (id: string): Promise<{ status: string; etaMinutes: number | null } | null> =>
    asTenant(tenantId, (tx) =>
      tx.order.findFirst({ where: { id }, select: { status: true, etaMinutes: true } }),
    );

  beforeAll(async () => {
    email = `eta-${randomUUID()}@ex.com`;
    const s = await signupUser({ email, password: "0wnerP4ssPhrase!", tenantName: "Eta Test" });
    if (!s.ok) throw new Error("signup failed");
    ownerId = s.userId;
    tenantId = s.tenantId;
    const venue = await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: "Eta", slug: `eta-${randomUUID().slice(0, 8)}`, currency: "EUR" },
        select: { id: true },
      }),
    );
    venueId = venue.id;
  });

  afterAll(async () => {
    await asTenant(tenantId, (tx) => tx.venue.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { email } });
  });

  it("stores the snapped minutes and moves the order to preparing", async () => {
    const o = await order();
    expect(await acceptOrderWithEta(ownerId, o.id, 63)).toEqual({ ok: true, minutes: 65 });
    expect(await read(o.id)).toEqual({ status: "preparing", etaMinutes: 65 });
    // Fixed now: a second accept is refused and changes nothing.
    expect(await acceptOrderWithEta(ownerId, o.id, 20)).toEqual({
      ok: false,
      error: "not_applicable",
    });
    expect((await read(o.id))?.etaMinutes).toBe(65);
  });

  it("refuses once the accept window has run out", async () => {
    const o = await order({ createdAt: new Date(Date.now() - 5 * 60_000) });
    expect(await acceptOrderWithEta(ownerId, o.id, 40)).toEqual({
      ok: false,
      error: "window_closed",
    });
    expect(await read(o.id)).toEqual({ status: "placed", etaMinutes: null });
  });

  it("refuses planned and dine-in orders, and unknown ids", async () => {
    const planned = await order({ requestedFor: new Date(Date.now() + 3 * 3600_000) });
    const dineIn = await order({ orderType: "dine_in" });
    for (const o of [planned, dineIn]) {
      expect(await acceptOrderWithEta(ownerId, o.id, 40)).toEqual({
        ok: false,
        error: "not_applicable",
      });
    }
    expect(await acceptOrderWithEta(ownerId, "nope", 40)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
