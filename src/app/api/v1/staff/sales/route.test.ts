import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { dayBounds } from "@/lib/daily-sales";
import { prisma } from "@/lib/db";
import { signSession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { GET } from "./route";

/** The app's "Tagesumsatz" screen, asserted at the wire level. */

interface Body {
  ok: boolean;
  date?: string;
  totals?: {
    orders: number;
    grossCents: number;
    cashOrders: number;
    cashCents: number;
    onlineOrders: number;
    onlineCents: number;
  };
  filtered?: { orders: number; totalCents: number };
  orders?: { orderLabel: string; paymentMethod: string; deletable: boolean }[];
}

describe("dayBounds", () => {
  it("is midnight to midnight in Berlin, summer and winter", () => {
    expect(dayBounds("2026-07-01", "Europe/Berlin").from.toISOString()).toBe(
      "2026-06-30T22:00:00.000Z",
    );
    const winter = dayBounds("2026-12-01", "Europe/Berlin");
    expect(winter.from.toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(winter.to.toISOString()).toBe("2026-12-01T22:59:59.999Z");
  });
});

describe("/api/v1/staff/sales", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.14.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const day = "2026-10-11";

  beforeAll(async () => {
    const s = await signupUser({
      email: `sales-staff-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Sales Staff Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `sales-staff-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    await asTenant(tenantId, async (tx) => {
      const v = await tx.venue.create({
        data: { tenantId, name: "Sales Venue", slug, currency: "EUR", timezone: "Europe/Berlin" },
        select: { id: true },
      });
      const at = (hhmm: string) => new Date(`${day}T${hhmm}:00+02:00`);
      const order = (
        n: number,
        series: "B" | "O",
        createdAt: Date,
        totalCents: number,
        extra: Record<string, unknown> = {},
      ) =>
        tx.order.create({
          data: {
            tenantId,
            venueId: v.id,
            orderNumber: n,
            orderSeries: series,
            totalCents,
            currency: "EUR",
            createdAt,
            status: "done",
            ...extra,
          },
        });
      await order(1, "B", at("12:00"), 2000);
      await order(1, "O", at("13:00"), 3000, {
        paymentStatus: "paid",
        paymentProvider: "paypal",
      });
      await order(2, "O", at("14:00"), 4500, {
        paymentStatus: "paid",
        paymentProvider: "stripe",
        paymentMethod: "apple_pay",
      });
      // Cancelled, nothing paid: not revenue, and the owner may delete it.
      await order(2, "B", at("15:00"), 1200, { status: "cancelled" });
      // The day before (late evening in Berlin) stays out.
      await order(3, "B", new Date(`2026-10-10T23:30:00+02:00`), 9999);
    });
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, async (tx) => {
      await tx.order.deleteMany({});
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const request = (qs: string, token?: string): NextRequest =>
    new NextRequest(`http://localhost:3000/api/v1/staff/sales${qs}`, {
      headers: { ...(token ? { "x-staff-token": token } : {}), "x-forwarded-for": ip },
    });

  it("401s without a staff token", async () => {
    expect((await GET(request(`?date=${day}`))).status).toBe(401);
  });

  it("splits the day into cash and online, newest first", async () => {
    const res = await GET(request(`?date=${day}`, staffToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as Body;
    expect(body.date).toBe(day);
    expect(body.totals).toEqual({
      orders: 3,
      grossCents: 9500,
      cashOrders: 1,
      cashCents: 2000,
      onlineOrders: 2,
      onlineCents: 7500,
    });
    expect(body.orders!.map((o) => o.orderLabel)).toEqual(["B-2", "O-2", "O-1", "B-1"]);
    expect(body.orders!.map((o) => o.deletable)).toEqual([true, true, true, true]);
  });

  it("filters the list by payment type; the day's totals stay whole", async () => {
    const body = (await (
      await GET(request(`?date=${day}&pay=apple_pay`, staffToken))
    ).json()) as Body;
    expect(body.orders!.map((o) => o.orderLabel)).toEqual(["O-2"]);
    expect(body.filtered).toEqual({ orders: 1, totalCents: 4500 });
    expect(body.totals!.cashCents).toBe(2000);

    const cash = (await (await GET(request(`?date=${day}&pay=cash`, staffToken))).json()) as Body;
    expect(cash.orders!.map((o) => o.orderLabel)).toEqual(["B-2", "B-1"]);
    expect(cash.filtered).toEqual({ orders: 1, totalCents: 2000 });
  });
});
