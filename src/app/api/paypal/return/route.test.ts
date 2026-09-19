import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { placeOrder } from "@/lib/order-service";
import { createPayPalOrderPayment } from "@/lib/paypal-service";
import { siteUrl } from "@/lib/site-url";
import { asTenant } from "@/lib/tenant";
import { GET } from "./route";

/**
 * Where the PayPal round trip ENDS. The capture itself is covered by
 * `paypal-service.test.ts`; what matters here is the redirect target,
 * because it is the difference between the app guest tapping twice and
 * the browser handing itself straight back.
 *
 * Runs on the fake provider (vitest.setup strips PAYPAL_*), so nothing
 * below reaches PayPal.
 */

const DEEP_LINK = "ranglapunjab://payment-return";

describe("GET /api/paypal/return", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterAll(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  /** A tenant with one published dish, ready to be ordered. */
  async function fixture(): Promise<{
    tenantId: string;
    venueId: string;
    publishedVersionId: string;
    itemId: string;
  }> {
    const s = await signupUser({
      email: `ppr-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "PP Return Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);

    return asTenant(s.tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "PP Return Venue",
          slug: `ppr-test-${randomUUID().slice(0, 8)}`,
          currency: "EUR",
        },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId: s.tenantId, venueId: venue.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      const version = await tx.menuVersion.create({
        data: {
          tenantId: s.tenantId,
          menuId: menu.id,
          status: "published",
          publishedAt: new Date(),
        },
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
          name: "Karahi",
          priceCents: 1290,
          orderIndex: 0,
        },
        select: { id: true },
      });
      return {
        tenantId: s.tenantId,
        venueId: venue.id,
        publishedVersionId: version.id,
        itemId: item.id,
      };
    });
  }

  /** An order with a PayPal payment already started (unless `start` is
   *  false — that is the order whose capture cannot succeed). */
  async function order(start = true): Promise<{ orderId: string; token: string }> {
    const fx = await fixture();
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      tableNumber: "5",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    if (start) {
      const started = await createPayPalOrderPayment(
        fx.tenantId,
        placed.value.orderId,
        placed.value.receiptToken,
        DEEP_LINK,
      );
      if (!started.ok) throw new Error("paypal start failed");
    }
    return { orderId: placed.value.orderId, token: placed.value.receiptToken };
  }

  function ret(orderId: string, token: string, app?: string): NextRequest {
    const appParam = app ? `&app=${encodeURIComponent(app)}` : "";
    return new NextRequest(
      `${siteUrl()}/api/paypal/return?orderId=${encodeURIComponent(orderId)}&t=${encodeURIComponent(token)}${appParam}`,
    );
  }

  it("sends an app guest to the hand-over page, with the deep link and the outcome", async () => {
    const { orderId, token } = await order();
    const res = await GET(ret(orderId, token, DEEP_LINK));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `${siteUrl()}/auth/app-return?to=${encodeURIComponent(DEEP_LINK)}&status=success`,
    );
  });

  it("does the same for a payment that did not settle — failed, not stranded", async () => {
    const { orderId, token } = await order(false);
    const res = await GET(ret(orderId, token, DEEP_LINK));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `${siteUrl()}/auth/app-return?to=${encodeURIComponent(DEEP_LINK)}&status=failed`,
    );
  });

  it("takes an Expo dev-client link too", async () => {
    const { orderId, token } = await order();
    const res = await GET(ret(orderId, token, "exp+rangla://payment-return"));

    expect(res.headers.get("location")).toBe(
      `${siteUrl()}/auth/app-return?to=exp%2Brangla%3A%2F%2Fpayment-return&status=success`,
    );
  });

  it("leaves the web flow on the pay page, exactly as before", async () => {
    const { orderId, token } = await order();
    const res = await GET(ret(orderId, token));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `${siteUrl()}/pay/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}&status=success`,
    );
  });

  it("ignores an `app` that is not an app scheme — no open redirect", async () => {
    const { orderId, token } = await order();
    const res = await GET(ret(orderId, token, "https://evil.example.com/steal"));

    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("evil.example.com");
    expect(location).toBe(
      `${siteUrl()}/pay/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}&status=success`,
    );
  });

  it("refuses a token that does not belong to the order", async () => {
    const { orderId } = await order();
    const other = await order();
    const res = await GET(ret(orderId, other.token, DEEP_LINK));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${siteUrl()}/`);
  });
});
