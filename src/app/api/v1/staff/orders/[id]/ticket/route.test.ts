import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { placeOrder } from "@/lib/order-service";
import { signSession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { GET } from "./route";

/**
 * The printable kitchen ticket the counter tablet fetches and hands to
 * `expo-print`.
 *
 * Two things are load-bearing. The response must be a COMPLETE document
 * (the print WebView has neither our stylesheet nor a reliable network,
 * so a Tailwind class name here is a blank page at the counter), and an
 * order id from another tenant must be a 404 — the same wall the board
 * itself stands behind, since a ticket carries the customer's name,
 * phone and home address.
 */
interface Fixture {
  tenantId: string;
  userId: string;
  venueId: string;
  publishedVersionId: string;
  itemId: string;
}

async function seedRestaurant(label: string, venueName: string): Promise<Fixture> {
  const signup = await signupUser({
    email: `${label}-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: `${label} Test`,
  });
  if (!signup.ok) throw new Error("signup failed");
  const { tenantId, userId } = signup;

  const seeded = await asTenant(tenantId, async (tx) => {
    await tx.tenant.updateMany({ data: { plan: "scale" } });
    const venue = await tx.venue.create({
      data: {
        tenantId,
        name: venueName,
        slug: `${label}-${randomUUID().slice(0, 8)}`,
        currency: "EUR",
        timezone: "Europe/Berlin",
        // Delivery on, with the one area the delivery ticket below is
        // addressed to — the quote is derived server-side from the ZIP.
        ordering: {
          dineIn: true,
          takeaway: true,
          delivery: true,
          deliveryAreas: [
            { zip: "44145", locality: "Dortmund", feeCents: 250, minCents: 0, freeOverCents: 0 },
          ],
        },
      },
      select: { id: true, slug: true },
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
    const category = await tx.category.create({
      data: { tenantId, menuVersionId: version.id, name: "Mains", orderIndex: 0 },
      select: { id: true },
    });
    const item = await tx.item.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: "Dal Makhani",
        priceCents: 1200,
        orderIndex: 0,
      },
      select: { id: true },
    });
    return {
      venueId: venue.id,
      slug: venue.slug,
      publishedVersionId: version.id,
      itemId: item.id,
    };
  });

  return { tenantId, userId, ...seeded };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await asTenant(fixture.tenantId, (tx) => tx.orderItem.deleteMany({}));
  await asTenant(fixture.tenantId, (tx) => tx.order.deleteMany({}));
  await asTenant(fixture.tenantId, (tx) => tx.customerToken.deleteMany({}));
  await asTenant(fixture.tenantId, (tx) => tx.customer.deleteMany({}));
  await asTenant(fixture.tenantId, (tx) => tx.membership.deleteMany({}));
  await asTenant(fixture.tenantId, (tx) => tx.tenant.deleteMany({}));
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}

describe("/api/v1/staff/orders/{id}/ticket", () => {
  let ours: Fixture;
  let theirs: Fixture;
  let staffToken: string;
  let guestToken: string;
  let dineInId: string;
  let deliveryId: string;
  let foreignOrderId: string;

  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.13.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    ours = await seedRestaurant("ticket", "Rangla Punjab");
    theirs = await seedRestaurant("rival", "Rival Kitchen");
    staffToken = signSession(ours.userId);

    // The deploy serves OUR restaurant; the rival's rows exist only to
    // prove they stay invisible.
    const slug = await asTenant(ours.tenantId, (tx) =>
      tx.venue.findFirstOrThrow({ where: { id: ours.venueId }, select: { slug: true } }),
    );
    process.env.RESTAURANT_SLUG = slug.slug;

    const guest = await registerCustomerWithPassword(
      ours.tenantId,
      `guest-${randomUUID()}@ex.com`,
      "S3cureP4ssPhrase!",
      "Amrit",
    );
    if (!guest.ok) throw new Error("guest registration failed");
    guestToken = guest.value.token;

    dineInId = await place(ours, { orderType: "dine_in", tableNumber: "7" });
    deliveryId = await place(ours, {
      orderType: "delivery",
      customerName: "Amrit Kaur",
      customerPhone: "+49 231 1234567",
      address: { street: "Bornstraße 12", zip: "44145", note: "2. OG, klingeln" },
    });
    foreignOrderId = await place(theirs, { orderType: "dine_in", tableNumber: "1" });
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await cleanup(ours);
    await cleanup(theirs);
  });

  async function place(at: Fixture, over: Record<string, unknown>): Promise<string> {
    const placed = await placeOrder(at, {
      items: [{ itemId: at.itemId, quantity: 2 }],
      ...over,
    });
    if (!placed.ok) throw new Error(`order failed: ${placed.error}`);
    return placed.value.orderId;
  }

  function request(id: string, token?: string): NextRequest {
    return new NextRequest(`http://localhost:3000/api/v1/staff/orders/${id}/ticket`, {
      headers: { ...(token ? { "x-staff-token": token } : {}), "x-forwarded-for": ip },
    });
  }

  async function ticket(id: string): Promise<Response> {
    return GET(request(id, staffToken), { params: Promise.resolve({ id }) });
  }

  it("401s with no token, a guest token, or a forged one", async () => {
    for (const token of [undefined, guestToken, "forged.payload"]) {
      const res = await GET(request(dineInId, token), {
        params: Promise.resolve({ id: dineInId }),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("renders a self-contained, un-cacheable HTML ticket for a placed order", async () => {
    const res = await ticket(dineInId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const html = await res.text();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("Rangla Punjab");
    expect(html).toContain("Kitchen ticket");
    expect(html).toContain("Dal Makhani");
    expect(html).toContain("IM RESTAURANT — TISCH 7");
    expect(html).toContain("TOTAL");
    // The order number, zero-padded as the kitchen calls it out.
    expect(/#\d{4}/.test(html)).toBe(true);

    // Nothing the print WebView would have to fetch, and no Tailwind:
    // both print blank or unstyled on a tablet with no stylesheet.
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(/class="[^"]*\b(mt-\d|font-mono|text-\[)/.test(html)).toBe(false);
    expect(html).toContain("@page { margin: 0;");
  });

  it("inlines the directions QR on a delivery ticket, with the address above it", async () => {
    const res = await ticket(deliveryId);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("LIEFERUNG / DELIVERY");
    expect(html).toContain("Amrit Kaur");
    expect(html).toContain("+49 231 1234567");
    expect(html).toContain("Bornstraße 12, 44145 Dortmund");
    expect(html).toContain("2. OG, klingeln");
    // Inline SVG, not an <img> the printer would have to go and fetch.
    expect(html).toContain("Scan: unterwegs + Route / out for delivery + route");
    expect(html).toContain("<svg");
  });

  it("404s another tenant's order and an id that does not exist", async () => {
    for (const id of [foreignOrderId, randomUUID()]) {
      const res = await ticket(id);
      expect(res.status).toBe(404);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    }
  });
});
