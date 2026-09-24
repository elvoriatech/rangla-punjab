import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword, signInCustomer } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { advanceOrderStatus } from "@/lib/order-service";
import { asTenant } from "@/lib/tenant";
import { POST } from "./route";

/**
 * When an order earns loyalty points (owner, 2026-09-24): a CASH order is
 * credited the moment it is placed — the guest sees the points straight
 * away — and cancelling takes them back. A CARD order still waits for the
 * money (markOrderPaid), so an abandoned card checkout earns nothing.
 *
 * Driven through the route, because that is where the placement-time
 * credit lives.
 */
describe("POST /api/orders → loyalty points", () => {
  let tenantId: string;
  let userId: string;
  let slug: string;
  let itemId: string;
  const ip = `10.15.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `orders-points-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Orders Points Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    slug = `orders-points-${randomUUID().slice(0, 8)}`;

    itemId = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const venue = await tx.venue.create({
        data: { tenantId, name: "Points Venue", slug, currency: "EUR", loyalty: { enabled: true } },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId, venueId: venue.id, name: "Main", isDefault: true },
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
        data: { tenantId, categoryId: cat.id, name: "Korma", priceCents: 1300, orderIndex: 0 },
        select: { id: true },
      });
      return item.id;
    });
  });

  afterAll(async () => {
    await asTenant(tenantId, async (tx) => {
      await tx.loyaltyLedger.deleteMany({});
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.customer.deleteMany({});
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  type Provider = "apple" | "google" | "password";
  async function guest(
    provider: Provider = "apple",
  ): Promise<{ customerId: string; token: string }> {
    if (provider === "password") {
      const r = await registerCustomerWithPassword(
        tenantId,
        `pw-${randomUUID().slice(0, 8)}@ex.com`,
        "S3cureP4ssPhrase!",
        "Email Guest",
      );
      if (!r.ok) throw new Error("register failed");
      return { customerId: r.value.customerId, token: r.value.token };
    }
    const g = await signInCustomer(tenantId, provider, {
      sub: `${provider}-${randomUUID()}`,
      email: `${randomUUID().slice(0, 8)}@ex.com`,
      name: "Points Guest",
    });
    return { customerId: g.customerId, token: g.token };
  }

  async function order(token: string, intendedPayment: "cash" | "card"): Promise<string> {
    const res = await POST(
      new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
          "x-customer-token": token,
        },
        // 2 × €13 = €26 of food → one full €20 → 5 points at the defaults.
        body: JSON.stringify({
          slug,
          orderType: "dine_in",
          tableNumber: "5",
          intendedPayment,
          items: [{ itemId, quantity: 2 }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { orderId: string }).orderId;
  }

  const balance = (customerId: string) =>
    asTenant(tenantId, async (tx) => {
      const sum = await tx.loyaltyLedger.aggregate({
        where: { customerId },
        _sum: { delta: true },
      });
      return sum._sum.delta ?? 0;
    });

  it("credits a cash order as soon as the response is back, and cancelling takes it back", async () => {
    const g = await guest();
    const orderId = await order(g.token, "cash");
    // No waiting: the route awaits the credit before it answers.
    expect(await balance(g.customerId)).toBe(5);

    expect((await advanceOrderStatus(userId, orderId, "cancelled")).ok).toBe(true);
    for (let i = 0; i < 30 && (await balance(g.customerId)) !== 0; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(await balance(g.customerId)).toBe(0);
  });

  // The owner's question, 2026-09-24: does it work for every way in?
  // Earning keys on the customer, never on how they signed in.
  it.each(["apple", "google", "password"] as const)(
    "credits a %s account's cash order at placement",
    async (provider) => {
      const g = await guest(provider);
      await order(g.token, "cash");
      expect(await balance(g.customerId)).toBe(5);
    },
  );

  it("does not credit a card order before it is paid", async () => {
    const g = await guest();
    await order(g.token, "card");
    expect(await balance(g.customerId)).toBe(0);
  });

  it("does not double-credit when the kitchen later marks the cash order done", async () => {
    const g = await guest();
    const orderId = await order(g.token, "cash");
    expect((await advanceOrderStatus(userId, orderId, "done")).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(await balance(g.customerId)).toBe(5);
  });
});
