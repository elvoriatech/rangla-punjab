import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { __fakePush, registerStaffDevice } from "@/lib/push-service";
import { asTenant } from "@/lib/tenant";
import { POST } from "./route";

/**
 * Placing a cash order buzzes the owner's phone (P7-11).
 *
 * Driven through the ROUTE rather than `placeOrder` directly, because the
 * trigger lives in the route next to the owner's email — the two ride the
 * same rule ("cash settles at placement, card waits for the money") and a
 * test that called the service would prove nothing about that rule.
 *
 * The provider is the in-memory fake (EXPO_PUSH_ENABLED unset), so this
 * asserts the fan-out and the payload without a single real credential.
 */

const TOKEN = "ExponentPushToken[orders-route-test]";

describe("POST /api/orders → owner push", () => {
  let tenantId: string;
  let userId: string;
  let slug: string;
  let itemId: string;
  const ip = `10.14.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `orders-push-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Orders Push Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    slug = `orders-push-${randomUUID().slice(0, 8)}`;

    itemId = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const venue = await tx.venue.create({
        data: { tenantId, name: "Push Venue", slug, currency: "EUR" },
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
      await tx.staffDevice.deleteMany({});
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** The push is fire-and-forget, so the assertion has to wait for it —
   *  but only as long as it actually takes. */
  async function waitForPush(): Promise<void> {
    for (let i = 0; i < 60 && __fakePush().sent.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it("registers a device, then a cash order wakes it with data.kind === 'order'", async () => {
    expect(await registerStaffDevice(userId, { token: TOKEN, platform: "ios" })).toEqual({
      ok: true,
      created: true,
    });
    __fakePush().reset();

    const res = await POST(
      new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
          // Present but meaningless: keeps the handler off `cookies()`,
          // which has no request scope in a unit test.
          "x-customer-token": "not-a-real-guest-token",
        },
        body: JSON.stringify({
          slug,
          orderType: "dine_in",
          tableNumber: "5",
          items: [{ itemId, quantity: 2 }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const placed = (await res.json()) as { orderId: string; orderNumber: number };

    await waitForPush();
    const sent = __fakePush().sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: TOKEN,
      title: `New order #${placed.orderNumber}`,
      data: { kind: "order", orderId: placed.orderId },
    });
    // The body is what the owner reads on the lock screen: what kind of
    // order, and how much.
    expect(sent[0]?.body).toContain("Dine-in");
    expect(sent[0]?.body).toContain("26.00");
  });
});
