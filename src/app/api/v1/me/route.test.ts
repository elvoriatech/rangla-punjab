import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { signInCustomer } from "@/lib/customer-auth";
import { placeOrder } from "@/lib/order-service";
import { prisma } from "@/lib/db";
import { asTenant } from "@/lib/tenant";
import { GET, PATCH } from "./route";

/**
 * The profile half of /api/v1/me: what the app and the web cart drawer
 * prefill checkout from, and the PATCH the guest corrects it with. The
 * order-history half is asserted here too, because the mobile app reads
 * those exact keys and this route is where they could silently change.
 */

interface MeBody {
  ok: boolean;
  error?: string;
  customer?: {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    lastDeliveryAddress: { street?: string; zip?: string; city?: string; note?: string } | null;
  };
  orders?: { orderId: string; orderNumber: number; receiptToken: string }[];
}

describe("/api/v1/me (customer profile)", () => {
  let tenantId: string;
  let userId: string;
  let slug: string;
  let venue: { tenantId: string; venueId: string; publishedVersionId: string; itemId: string };
  const originalSlug = process.env.RESTAURANT_SLUG;
  // A per-run IP so the PATCH rate limiter's Redis bucket is never shared
  // with an earlier run of this suite.
  const ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `me-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Me Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    slug = `me-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venue = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const v = await tx.venue.create({
        data: {
          tenantId,
          name: "Me Venue",
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
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(token: string, init?: { method?: string; body?: unknown }): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/me", {
      method: init?.method ?? "GET",
      headers: {
        "x-customer-token": token,
        "x-forwarded-for": ip,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  }

  async function signIn(): Promise<{ customerId: string; token: string }> {
    const s = await signInCustomer(tenantId, "dev", {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `guest-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Guest",
    });
    return { customerId: s.customerId, token: s.token };
  }

  it("401s an unknown token on both verbs", async () => {
    const bogus = "bogus-token-bogus-token-bogus";
    expect((await GET(request(bogus))).status).toBe(401);
    const patch = await PATCH(request(bogus, { method: "PATCH", body: { name: "X" } }));
    expect(patch.status).toBe(401);
  });

  it("returns the full profile and the order-history fields the app reads", async () => {
    const me = await signIn();
    const placed = await placeOrder(
      venue,
      {
        orderType: "takeaway",
        items: [{ itemId: venue.itemId, quantity: 1 }],
        customerName: "Sana",
        customerPhone: "0170 42",
      },
      { customerId: me.customerId },
    );
    if (!placed.ok) throw new Error("order failed");

    const res = await GET(request(me.token));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await res.json()) as MeBody;
    // The back-fill from the order above is already visible here.
    expect(body.customer).toMatchObject({
      id: me.customerId,
      name: "Sana",
      phone: "0170 42",
      lastDeliveryAddress: null,
    });
    expect(body.customer?.email).toBeTruthy();
    expect(body.orders?.[0]).toMatchObject({
      orderId: placed.value.orderId,
      orderNumber: placed.value.orderNumber,
    });
    expect(body.orders?.[0]?.receiptToken).toBeTruthy();
  });

  it("PATCH round-trips name, phone and the delivery address", async () => {
    const me = await signIn();
    const res = await PATCH(
      request(me.token, {
        method: "PATCH",
        body: {
          name: "  Noor  ",
          phone: "  +49 170 5 ",
          lastDeliveryAddress: {
            street: "Hauptstr. 3",
            zip: "60311",
            city: "Frankfurt",
            note: "Hinterhof",
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    const patched = (await res.json()) as MeBody;
    expect(patched.customer).toMatchObject({
      name: "Noor",
      phone: "+49 170 5",
      lastDeliveryAddress: {
        street: "Hauptstr. 3",
        zip: "60311",
        city: "Frankfurt",
        note: "Hinterhof",
      },
    });

    // GET sees exactly what PATCH returned.
    const after = (await (await GET(request(me.token))).json()) as MeBody;
    expect(after.customer).toEqual(patched.customer);

    // A partial patch leaves the other fields alone.
    const phoneOnly = (await (
      await PATCH(request(me.token, { method: "PATCH", body: { phone: "0170 6" } }))
    ).json()) as MeBody;
    expect(phoneOnly.customer).toMatchObject({
      name: "Noor",
      phone: "0170 6",
      lastDeliveryAddress: { zip: "60311" },
    });

    // Explicit null clears the address only.
    const cleared = (await (
      await PATCH(request(me.token, { method: "PATCH", body: { lastDeliveryAddress: null } }))
    ).json()) as MeBody;
    expect(cleared.customer?.lastDeliveryAddress).toBeNull();
    expect(cleared.customer?.name).toBe("Noor");
  });

  it("rejects an empty patch, a junk body and an address missing its ZIP", async () => {
    const me = await signIn();
    for (const body of [
      {}, // nothing to change
      { name: "" },
      { phone: "x".repeat(41) },
      { lastDeliveryAddress: { street: "Weg 1" } }, // no ZIP
      // Unknown keys are stripped, which leaves an empty patch → 400.
      // This is also the proof that email is not editable here.
      { email: "new@ex.com" },
    ]) {
      const res = await PATCH(request(me.token, { method: "PATCH", body }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    // Email is never editable here — the IdP owns it.
    const after = (await (await GET(request(me.token))).json()) as MeBody;
    expect(after.customer?.email).not.toBe("new@ex.com");
  });
});
