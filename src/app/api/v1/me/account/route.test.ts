import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { signInCustomer, verifyCustomerToken } from "@/lib/customer-auth";
import { placeOrder } from "@/lib/order-service";
import { prisma } from "@/lib/db";
import { asTenant } from "@/lib/tenant";
import { DELETE } from "./route";

/**
 * "Konto löschen": what the guest's own delete wipes, and — just as
 * important — what it must leave alone (the sale for the tax record, an
 * order the kitchen is still cooking, a gift card someone is holding).
 */
describe("DELETE /api/v1/me/account", () => {
  let tenantId: string;
  let userId: string;
  let slug: string;
  let venue: { tenantId: string; venueId: string; publishedVersionId: string; itemId: string };
  const originalSlug = process.env.RESTAURANT_SLUG;

  beforeAll(async () => {
    const s = await signupUser({
      email: `del-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Delete Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    slug = `del-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    venue = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const v = await tx.venue.create({
        data: {
          tenantId,
          name: "Delete Venue",
          slug,
          currency: "EUR",
          ordering: { delivery: true, deliveryZips: ["60311"] },
        },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId, venueId: v.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      const version = await tx.menuVersion.create({
        data: { tenantId, menuId: menu.id, status: "published", publishedAt: new Date() },
        select: { id: true },
      });
      await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });
      const cat = await tx.category.create({
        data: { tenantId, menuVersionId: version.id, name: "Mains", orderIndex: 0 },
        select: { id: true },
      });
      const item = await tx.item.create({
        data: { tenantId, categoryId: cat.id, name: "Dal", priceCents: 1200, orderIndex: 0 },
        select: { id: true },
      });
      return { tenantId, venueId: v.id, publishedVersionId: version.id, itemId: item.id };
    });
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, async (tx) => {
      await tx.giftCard.deleteMany({});
      await tx.reservation.deleteMany({});
      await tx.customer.deleteMany({});
      await tx.membership.deleteMany({});
      await tx.tenant.deleteMany({});
    });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(token: string): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/me/account", {
      method: "DELETE",
      headers: { "x-customer-token": token },
    });
  }

  it("401s without a valid session", async () => {
    expect((await DELETE(request("bogus-token-bogus-token-bogus"))).status).toBe(401);
  });

  it("anonymises the account, keeps the sales record, and frees the identity", async () => {
    const identity = {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `guest-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Sana",
    };
    const me = await signInCustomer(tenantId, "dev", identity);
    const customerId = me.customerId;

    const order = (name: string) =>
      placeOrder(
        venue,
        {
          orderType: "takeaway",
          items: [{ itemId: venue.itemId, quantity: 1 }],
          customerName: name,
          customerPhone: "0170 42",
        },
        { customerId },
      );
    const finished = await order("Finished");
    const cooking = await order("Cooking");
    if (!finished.ok || !cooking.ok) throw new Error("order failed");

    const seeded = await asTenant(tenantId, async (tx) => {
      await tx.order.update({ where: { id: finished.value.orderId }, data: { status: "done" } });
      await tx.customer.update({
        where: { id: customerId },
        data: { phone: "0170 42", lastDeliveryAddress: { street: "Hauptstr. 1", zip: "60311" } },
      });
      await tx.loyaltyLedger.create({
        data: { tenantId, customerId, delta: 5, reason: "adjust" },
      });
      await tx.loyaltyVoucher.create({
        data: {
          tenantId,
          customerId,
          valueCents: 1000,
          pointsSpent: 100,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const card = await tx.giftCard.create({
        data: {
          tenantId,
          venueId: venue.venueId,
          code: randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
          purchaserCustomerId: customerId,
          purchaserPhone: "+4917042",
          valueCents: 2500,
          currency: "EUR",
          status: "active",
        },
        select: { id: true },
      });
      const reservation = await tx.reservation.create({
        data: {
          tenantId,
          venueId: venue.venueId,
          customerId,
          name: "Sana",
          phone: "0170 42",
          guests: 2,
          at: new Date(),
          date: "2026-09-30",
          time: "19:00",
        },
        select: { id: true },
      });
      return { cardId: card.id, reservationId: reservation.id };
    });

    const res = await DELETE(request(me.token));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/rangla_customer=;/);

    // Every session is dead — this device's and any other.
    expect(await verifyCustomerToken(tenantId, me.token)).toBeNull();

    const after = await asTenant(tenantId, async (tx) => ({
      customer: await tx.customer.findUniqueOrThrow({ where: { id: customerId } }),
      finished: await tx.order.findUniqueOrThrow({ where: { id: finished.value.orderId } }),
      cooking: await tx.order.findUniqueOrThrow({ where: { id: cooking.value.orderId } }),
      ledger: await tx.loyaltyLedger.count({ where: { customerId } }),
      vouchers: await tx.loyaltyVoucher.count({ where: { customerId } }),
      tokens: await tx.customerToken.count({ where: { customerId } }),
      card: await tx.giftCard.findUniqueOrThrow({ where: { id: seeded.cardId } }),
      reservation: await tx.reservation.findUniqueOrThrow({
        where: { id: seeded.reservationId },
      }),
    }));

    expect(after.customer.deletedAt).not.toBeNull();
    expect(after.customer).toMatchObject({
      provider: "deleted",
      email: "",
      name: null,
      phone: null,
      lastDeliveryAddress: null,
      passwordHash: null,
    });
    // The finished sale stays for the tax record, with nobody on it.
    expect(after.finished).toMatchObject({
      customerId: null,
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      totalCents: 1200,
    });
    // The kitchen still needs to reach whoever is waiting for this one.
    expect(after.cooking).toMatchObject({ customerId: null, customerName: "Cooking" });
    expect(after.ledger).toBe(0);
    expect(after.vouchers).toBe(0);
    expect(after.tokens).toBe(0);
    // The gift card is paid money in someone's hands: still spendable.
    expect(after.card).toMatchObject({ status: "active", purchaserPhone: null });
    expect(after.reservation.customerId).toBeNull();

    // Signing in again with the same Google account starts from scratch.
    const again = await signInCustomer(tenantId, "dev", identity);
    expect(again.customerId).not.toBe(customerId);
    expect(again.customer.phone).toBeNull();

    // And a second delete of the dead token is a clean 401, not a crash.
    expect((await DELETE(request(me.token))).status).toBe(401);
  });
});
