import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import { deleteCancelledOrder, listDeletedOrders, orderDeleteBlock } from "./order-delete-service";
import { createStaffMember } from "./team-service";
import { asTenant } from "./tenant";

/**
 * Deleting an order is the one place the books lose a row, so every door
 * is asserted: who may, which orders, the reason, the log line that stays
 * behind, and that one restaurant can never reach another's orders or log.
 */
describe("deleteCancelledOrder", () => {
  const emails: string[] = [];
  const tenants: string[] = [];
  let ownerId: string;
  let staffId: string;
  let otherOwnerId: string;
  let tenantId: string;
  let venueId: string;
  let otherVenueId: string;
  let nextNumber = 1;

  async function restaurant(
    label: string,
  ): Promise<{ userId: string; tenantId: string; venueId: string }> {
    const email = `del-${label}-${randomUUID()}@ex.com`;
    emails.push(email);
    const s = await signupUser({
      email,
      password: "0wnerP4ssPhrase!",
      tenantName: `Delete ${label}`,
    });
    if (!s.ok) throw new Error("signup failed");
    tenants.push(s.tenantId);
    const venue = await asTenant(s.tenantId, (tx) =>
      tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: label,
          slug: `del-${randomUUID().slice(0, 8)}`,
          currency: "EUR",
        },
        select: { id: true },
      }),
    );
    return { userId: s.userId, tenantId: s.tenantId, venueId: venue.id };
  }

  function order(
    over: { status?: string; paymentStatus?: string; giftCardDiscountCents?: number } = {},
    where: { tenantId: string; venueId: string } = { tenantId, venueId },
  ): Promise<{ id: string; orderNumber: number }> {
    return asTenant(where.tenantId, (tx) =>
      tx.order.create({
        data: {
          tenantId: where.tenantId,
          venueId: where.venueId,
          orderNumber: nextNumber++,
          totalCents: 1290,
          currency: "EUR",
          status: over.status ?? "cancelled",
          paymentStatus: over.paymentStatus ?? "none",
          giftCardDiscountCents: over.giftCardDiscountCents ?? 0,
          items: {
            create: [{ tenantId: where.tenantId, name: "Dal", priceCents: 1290, quantity: 1 }],
          },
        },
        select: { id: true, orderNumber: true },
      }),
    );
  }

  const exists = (id: string, t = tenantId): Promise<boolean> =>
    asTenant(t, async (tx) => (await tx.order.count({ where: { id } })) === 1);

  beforeAll(async () => {
    const a = await restaurant("a");
    ownerId = a.userId;
    tenantId = a.tenantId;
    venueId = a.venueId;
    const b = await restaurant("b");
    otherOwnerId = b.userId;
    otherVenueId = b.venueId;

    const staffEmail = `del-staff-${randomUUID()}@ex.com`;
    emails.push(staffEmail);
    const made = await createStaffMember(ownerId, {
      name: "Counter",
      email: staffEmail,
      password: "counter-pass-1",
      permissions: ["orders", "reports"],
    });
    if (!made.ok) throw new Error("staff create failed");
    staffId = made.value.userId;
  });

  afterAll(async () => {
    for (const t of tenants) {
      await asTenant(t, (tx) => tx.venue.deleteMany({}));
      await asTenant(t, (tx) => tx.membership.deleteMany({}));
      await asTenant(t, (tx) => tx.tenant.deleteMany({}));
    }
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("names the rule: cancelled, and no money moved", () => {
    const base = { status: "cancelled", paymentStatus: "none", giftCardDiscountCents: 0 };
    expect(orderDeleteBlock(base)).toBeNull();
    expect(orderDeleteBlock({ ...base, paymentStatus: "pending" })).toBeNull();
    expect(orderDeleteBlock({ ...base, paymentStatus: "failed" })).toBeNull();
    expect(orderDeleteBlock({ ...base, status: "done" })).toBe("not_cancelled");
    expect(orderDeleteBlock({ ...base, status: "placed" })).toBe("not_cancelled");
    expect(orderDeleteBlock({ ...base, paymentStatus: "paid" })).toBe("money_moved");
    expect(orderDeleteBlock({ ...base, paymentStatus: "refunded" })).toBe("money_moved");
    expect(orderDeleteBlock({ ...base, giftCardDiscountCents: 500 })).toBe("money_moved");
  });

  it("lets the owner delete a cancelled, unpaid order and keeps the reason", async () => {
    const o = await order();
    const res = await deleteCancelledOrder(ownerId, o.id, "  test order  ");
    expect(res).toEqual({ ok: true, orderNumber: o.orderNumber });
    expect(await exists(o.id)).toBe(false);
    // Its lines went with it.
    expect(await asTenant(tenantId, (tx) => tx.orderItem.count({ where: { orderId: o.id } }))).toBe(
      0,
    );

    const log = await listDeletedOrders(ownerId, venueId, {
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    });
    const line = log.find((l) => l.orderNumber === o.orderNumber);
    expect(line).toMatchObject({ reason: "test order", totalCents: 1290, currency: "EUR" });
    expect(line?.deletedBy).toMatch(/^del-a-/);
  });

  it("refuses a team member, even one with Orders ticked", async () => {
    const o = await order();
    expect(await deleteCancelledOrder(staffId, o.id, "not mine to delete")).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await exists(o.id)).toBe(true);
  });

  it("refuses without a real reason", async () => {
    const o = await order();
    for (const reason of ["", "  ", "x"]) {
      expect(await deleteCancelledOrder(ownerId, o.id, reason)).toEqual({
        ok: false,
        error: "reason_required",
      });
    }
    expect(await exists(o.id)).toBe(true);
  });

  it("refuses orders that are not cancelled, or on which money moved", async () => {
    const open = await order({ status: "placed" });
    const done = await order({ status: "done" });
    const paid = await order({ paymentStatus: "paid" });
    const gift = await order({ giftCardDiscountCents: 500 });
    expect((await deleteCancelledOrder(ownerId, open.id, "reason")).ok).toBe(false);
    expect(await deleteCancelledOrder(ownerId, done.id, "reason")).toEqual({
      ok: false,
      error: "not_cancelled",
    });
    for (const o of [paid, gift]) {
      expect(await deleteCancelledOrder(ownerId, o.id, "reason")).toEqual({
        ok: false,
        error: "money_moved",
      });
    }
    for (const o of [open, done, paid, gift]) expect(await exists(o.id)).toBe(true);
  });

  it("cannot reach another restaurant's order, nor read its log", async () => {
    const o = await order();
    expect(await deleteCancelledOrder(otherOwnerId, o.id, "not my restaurant")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await exists(o.id)).toBe(true);

    const window = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    // The other owner asking for THIS venue's log gets nothing (RLS).
    expect(await listDeletedOrders(otherOwnerId, venueId, window)).toEqual([]);
    expect(await listDeletedOrders(otherOwnerId, otherVenueId, window)).toEqual([]);
  });
});
