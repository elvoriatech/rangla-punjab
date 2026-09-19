import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { trackedReviewUrl } from "@/lib/google-rating";
import { placeOrder } from "@/lib/order-service";
import { asTenant } from "@/lib/tenant";
import { GET as REVIEW_GET } from "../review/route";
import { GET } from "./route";

/**
 * The tracking payload's `review` field (the app's "rate us on Google"
 * button).
 *
 * The rest of this endpoint is covered from the complaint test next
 * door; what is asserted here is the one thing a client must be able to
 * trust: `review.url` is OUR tracked redirect — which lands on Google's
 * own write-a-review form — or the field is null. Never a Maps search,
 * never a link the owner switched off.
 *
 * `prompted` is the second half: it flips once the guest actually
 * follows the redirect, and the url keeps working afterwards.
 */

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

interface StatusBody {
  ok: boolean;
  review?: { url: string; prompted: boolean } | null;
  order?: { id: string; status: string };
}

describe("/api/v1/orders/{id}/status — review link", () => {
  let tenantId: string;
  let userId: string;
  let venue: { tenantId: string; venueId: string; publishedVersionId: string; itemId: string };
  let orderId: string;
  let token: string;
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.17.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `status-api-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Status API Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;

    const slug = `status-api-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venue = await asTenant(tenantId, async (tx) => {
      const v = await tx.venue.create({
        data: { tenantId, name: "Status Venue", slug, currency: "EUR" },
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
      tableNumber: "3",
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
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function status(): Promise<StatusBody> {
    const req = new NextRequest(
      `http://localhost:3000/api/v1/orders/${orderId}/status?token=${token}`,
      { headers: { "x-forwarded-for": ip } },
    );
    const res = await GET(req, { params: Promise.resolve({ orderId }) });
    expect(res.status).toBe(200);
    return (await res.json()) as StatusBody;
  }

  async function setVenue(data: Record<string, unknown>): Promise<void> {
    await asTenant(tenantId, (tx) => tx.venue.updateMany({ where: { id: venue.venueId }, data }));
  }

  it("is null until the owner has saved a Place ID", async () => {
    const body = await status();
    expect(body.ok).toBe(true);
    expect(body.review).toBeNull();
  });

  it("is null for a hand-typed rating with no Place ID — a search page is not a review form", async () => {
    await setVenue({
      googleRatingManual: { rating: 4.8, count: 120, updatedAt: new Date().toISOString() },
    });
    expect((await status()).review).toBeNull();
  });

  it("carries our tracked redirect once a Place ID is saved", async () => {
    await setVenue({ googlePlaceId: PLACE_ID });
    const body = await status();
    expect(body.review).toEqual({ url: trackedReviewUrl(orderId, token), prompted: false });
    // The whole field, so a client can't come to depend on anything else.
    expect(Object.keys(body.review!)).toEqual(["url", "prompted"]);
    // The caller's OWN token is echoed back — we never mint one, so the
    // link grants exactly what whoever holds it already had.
    expect(body.review!.url).toContain(encodeURIComponent(token));
    // And the order itself is untouched by any of this.
    expect(body.order).toMatchObject({ id: orderId, status: "placed" });
  });

  it("disappears when the owner switches the rating off, and comes back when they don't", async () => {
    await setVenue({ googleRatingEnabled: false });
    expect((await status()).review).toBeNull();
    await setVenue({ googleRatingEnabled: true });
    expect((await status()).review).toEqual({
      url: trackedReviewUrl(orderId, token),
      prompted: false,
    });
  });

  it("flips `prompted` once the guest has actually followed the redirect", async () => {
    // Follow the very link the payload just handed out.
    const redirect = await REVIEW_GET(
      new NextRequest(trackedReviewUrl(orderId, token), { headers: { "x-forwarded-for": ip } }),
      { params: Promise.resolve({ orderId }) },
    );
    expect(redirect.status).toBe(302);

    const body = await status();
    // The ask is spent — but the url is deliberately still live, so a
    // guest who taps, gets distracted and comes back through an old
    // receipt lands on the review form instead of a dead link.
    expect(body.review).toEqual({ url: trackedReviewUrl(orderId, token), prompted: true });
  });
});
