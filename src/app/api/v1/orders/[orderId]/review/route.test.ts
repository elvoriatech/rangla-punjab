import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { reviewUrl } from "@/lib/google-rating";
import { placeOrder } from "@/lib/order-service";
import { asTenant } from "@/lib/tenant";
import { GET } from "./route";

/**
 * The tracked review redirect (the "ask once" half of P7-14).
 *
 * The contract a client depends on is small and it is all here: the
 * route sends a 302 to Google's own write-review form, it records the
 * TAP on the way past — on the order always, and on the account too when
 * the order has one — and it refuses to invent a destination when the
 * owner never saved a Place ID.
 *
 * What is NOT asserted, because it cannot be: that a review was written.
 * Google publishes no signal for that. `review_clicked_at` is a tap and
 * the tests are worded that way on purpose.
 */

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

describe("/api/v1/orders/{id}/review — tracked redirect", () => {
  let tenantId: string;
  let userId: string;
  let venue: { tenantId: string; venueId: string; publishedVersionId: string; itemId: string };
  let orderId: string;
  let token: string;
  const originalSlug = process.env.RESTAURANT_SLUG;
  // Distinct per run so the shared per-IP order limiter (10/min) can
  // never make this suite flaky against a neighbour's traffic.
  const ip = `10.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `review-api-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Review API Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;

    const slug = `review-api-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venue = await asTenant(tenantId, async (tx) => {
      const v = await tx.venue.create({
        data: { tenantId, name: "Review Venue", slug, currency: "EUR" },
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
        data: { tenantId, categoryId: cat.id, name: "Saag", priceCents: 1100, orderIndex: 0 },
        select: { id: true },
      });
      return { tenantId, venueId: v.id, publishedVersionId: version.id, itemId: item.id };
    });

    const placed = await placeOrder(venue, {
      orderType: "dine_in",
      tableNumber: "7",
      items: [{ itemId: venue.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error(`order failed: ${placed.error}`);
    orderId = placed.value.orderId;
    token = placed.value.receiptToken;
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, async (tx) => {
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.customer.deleteMany({});
      await tx.membership.deleteMany({});
      await tx.tenant.deleteMany({});
    });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function hit(id = orderId, tok = token): Promise<Response> {
    const req = new NextRequest(
      `http://localhost:3000/api/v1/orders/${id}/review?token=${encodeURIComponent(tok)}`,
      { headers: { "x-forwarded-for": ip } },
    );
    return GET(req, { params: Promise.resolve({ orderId: id }) });
  }

  async function orderRow(): Promise<{ reviewClickedAt: Date | null } | null> {
    return asTenant(tenantId, (tx) =>
      tx.order.findFirst({ where: { id: orderId }, select: { reviewClickedAt: true } }),
    );
  }

  it("refuses a token that isn't this order's", async () => {
    const res = await hit(orderId, "not-a-real-token");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_token" });
    // And nothing was recorded off the back of a refused call.
    expect((await orderRow())?.reviewClickedAt).toBeNull();
  });

  it("404s while the owner has no Place ID — a search page is not a review form", async () => {
    const res = await hit();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "no_review_link" });
    expect((await orderRow())?.reviewClickedAt).toBeNull();
  });

  it("302s to Google's write-review form and records the tap on the order", async () => {
    await asTenant(tenantId, (tx) =>
      tx.venue.updateMany({ where: { id: venue.venueId }, data: { googlePlaceId: PLACE_ID } }),
    );
    const before = Date.now();
    const res = await hit();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(reviewUrl(PLACE_ID));
    // A redirect a browser may cache and replay would blind the only
    // signal this route exists to collect.
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const clicked = (await orderRow())?.reviewClickedAt;
    expect(clicked).toBeInstanceOf(Date);
    expect(clicked!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("is idempotent — a second tap still redirects and keeps the first instant", async () => {
    const first = (await orderRow())!.reviewClickedAt!;
    const res = await hit();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(reviewUrl(PLACE_ID));
    expect((await orderRow())!.reviewClickedAt!.getTime()).toBe(first.getTime());
  });

  it("records the tap on the ACCOUNT too, so a regular isn't asked again next month", async () => {
    const customerId = await asTenant(tenantId, async (tx) => {
      const c = await tx.customer.create({
        data: {
          tenantId,
          provider: "password",
          providerSub: `rev-${randomUUID()}`,
          email: `regular-${randomUUID()}@ex.com`,
        },
        select: { id: true },
      });
      return c.id;
    });

    const placed = await placeOrder(venue, {
      orderType: "dine_in",
      tableNumber: "8",
      items: [{ itemId: venue.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    await asTenant(tenantId, (tx) =>
      tx.order.updateMany({ where: { id: placed.value.orderId }, data: { customerId } }),
    );

    const res = await hit(placed.value.orderId, placed.value.receiptToken);
    expect(res.status).toBe(302);

    const [order, customer] = await asTenant(tenantId, (tx) =>
      Promise.all([
        tx.order.findFirst({
          where: { id: placed.value.orderId },
          select: { reviewClickedAt: true },
        }),
        tx.customer.findFirst({ where: { id: customerId }, select: { reviewClickedAt: true } }),
      ]),
    );
    expect(order?.reviewClickedAt).toBeInstanceOf(Date);
    expect(customer?.reviewClickedAt).toBeInstanceOf(Date);
  });
});
