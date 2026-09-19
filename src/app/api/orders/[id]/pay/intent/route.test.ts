import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { signupUser } from "@/lib/auth-service";
import { asTenant } from "@/lib/tenant";
import { placeOrder } from "@/lib/order-service";
import { POST as CONFIRM } from "../confirm/route";
import { POST as VERIFY } from "../verify/route";
import { getStripeProvider } from "@/lib/stripe";
import { reconcilePendingPayments } from "@/lib/connect-service";
import { POST } from "./route";

/**
 * POST /api/orders/{id}/pay/intent — the native payment sheet's server
 * half. Runs on the fake Stripe provider (vitest.setup strips the real
 * keys), so the assertions here are about the contract the mobile app
 * codes against: the shape, the refusals, and the fact that an intent
 * settles through the SAME confirm path a hosted checkout does.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

// The order rate limit is 10/minute per IP and its Redis buckets outlive
// the process — a per-run address keeps repeat runs off each other's.
const ip = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function fixture(): Promise<{
  tenantId: string;
  userId: string;
  venueId: string;
  publishedVersionId: string;
  itemId: string;
}> {
  const s = await signupUser({
    email: `intent-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: "Intent Test",
  });
  if (!s.ok) throw new Error("signup failed");
  createdUserIds.push(s.userId);
  createdTenantIds.push(s.tenantId);

  return asTenant(s.tenantId, async (tx) => {
    const venue = await tx.venue.create({
      data: {
        tenantId: s.tenantId,
        name: "Rangla Punjab",
        slug: `intent-${randomUUID().slice(0, 8)}`,
        currency: "EUR",
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
      userId: s.userId,
      venueId: venue.id,
      publishedVersionId: version.id,
      itemId: item.id,
    };
  });
}

async function placedOrder(): Promise<{
  tenantId: string;
  userId: string;
  orderId: string;
  receiptToken: string;
}> {
  const fx = await fixture();
  const placed = await placeOrder(fx, {
    orderType: "dine_in",
    tableNumber: "5",
    items: [{ itemId: fx.itemId, quantity: 2 }],
  });
  if (!placed.ok) throw new Error("order failed");
  return {
    tenantId: fx.tenantId,
    userId: fx.userId,
    orderId: placed.value.orderId,
    receiptToken: placed.value.receiptToken,
  };
}

function request(orderId: string, body: unknown): Request {
  return new Request(`http://localhost:3000/api/orders/${orderId}/pay/intent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/orders/{id}/pay/intent", () => {
  afterAll(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.orderItem.deleteMany({}));
      await asTenant(tid, (tx) => tx.order.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  it("400s a body with no usable token", async () => {
    const res = await POST(request("order-x", {}), context("order-x"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid" });
    // CORS lands on the refusals too — the Expo web preview has to be able
    // to READ the error, not just receive it.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("403s a token that is not this order's receipt token", async () => {
    const { orderId } = await placedOrder();
    const res = await POST(request(orderId, { token: "forged.token.value" }), context(orderId));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_token" });
  });

  it("mints an intent the app can confirm, then /pay/confirm settles it", async () => {
    const { tenantId, orderId, receiptToken } = await placedOrder();

    const res = await POST(request(orderId, { token: receiptToken }), context(orderId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      mode: string;
      ref: string;
      clientSecret: string;
      publishableKey: string | null;
      amountCents: number;
      currency: string;
      merchantName: string;
    };
    expect(body.mode).toBe("fake");
    // No real Stripe here, so there is no publishable key to hand over —
    // the app reads this as "show the dev pay button, not Stripe's sheet".
    expect(body.publishableKey).toBeNull();
    expect(body.ref).toMatch(/^pi_fake_/);
    expect(body.clientSecret).toBe(`${body.ref}_secret_test`);
    // Priced from the stored order (2 × €12.45), never from the client.
    expect(body.amountCents).toBe(2490);
    expect(body.currency).toBe("EUR");
    expect(body.merchantName).toBe("Rangla Punjab");

    const pending = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({
        where: { id: orderId },
        select: { paymentStatus: true, paymentRef: true, paymentProvider: true },
      }),
    );
    expect(pending).toMatchObject({
      paymentStatus: "pending",
      paymentRef: body.ref,
      paymentProvider: "stripe",
    });

    // The intent settles through the SAME endpoint a fake hosted checkout
    // does — that shared path is the whole point of reusing the ref map.
    const confirmed = await CONFIRM(
      new Request(`http://localhost:3000/api/orders/${orderId}/pay/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ token: receiptToken, ref: body.ref }),
      }),
      context(orderId),
    );
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ paid: true });

    const paid = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    expect(paid.paymentStatus).toBe("paid");
  });

  it("409s an order that is already paid", async () => {
    const { tenantId, orderId, receiptToken } = await placedOrder();
    await asTenant(tenantId, (tx) =>
      tx.order.updateMany({ where: { id: orderId }, data: { paymentStatus: "paid" } }),
    );
    const res = await POST(request(orderId, { token: receiptToken }), context(orderId));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_paid" });
  });

  it("a retry mints a fresh intent and takes over paymentRef", async () => {
    const { tenantId, orderId, receiptToken } = await placedOrder();
    const first = (await (
      await POST(request(orderId, { token: receiptToken }), context(orderId))
    ).json()) as { ref: string };
    const second = (await (
      await POST(request(orderId, { token: receiptToken }), context(orderId))
    ).json()) as { ref: string };

    expect(second.ref).not.toBe(first.ref);
    const order = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentRef: true } }),
    );
    expect(order.paymentRef).toBe(second.ref);
  });

  it("/pay/verify settles an intent Stripe says succeeded even when no webhook arrived", async () => {
    const { tenantId, orderId, receiptToken } = await placedOrder();
    const minted = await POST(request(orderId, { token: receiptToken }), context(orderId));
    expect(minted.status).toBe(201);
    const { ref } = (await minted.json()) as { ref: string };

    const verifyReq = (): Request =>
      new Request(`http://localhost:3000/api/orders/${orderId}/pay/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ token: receiptToken }),
      });

    // Nothing charged yet: verify must NOT settle.
    const before = await VERIFY(verifyReq(), context(orderId));
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ paid: false });

    // Stripe-side success with the webhook never delivered: flip the fake
    // intent to succeeded WITHOUT touching the order row.
    const provider = (await getStripeProvider()) as unknown as {
      settleOrderCheckout(ref: string): unknown;
    };
    provider.settleOrderCheckout(ref);

    const after = await VERIFY(verifyReq(), context(orderId));
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ paid: true, status: "succeeded" });
    const row = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    expect(row.paymentStatus).toBe("paid");
  });

  it("the owner's dashboard sweep settles a webhook-less success too", async () => {
    const { tenantId, userId, orderId, receiptToken } = await placedOrder();
    const minted = await POST(request(orderId, { token: receiptToken }), context(orderId));
    const { ref } = (await minted.json()) as { ref: string };
    expect(await reconcilePendingPayments(userId)).toBe(0);
    const provider = (await getStripeProvider()) as unknown as {
      settleOrderCheckout(ref: string): unknown;
    };
    provider.settleOrderCheckout(ref);
    expect(await reconcilePendingPayments(userId)).toBe(1);
    const row = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    expect(row.paymentStatus).toBe("paid");
  });
});
