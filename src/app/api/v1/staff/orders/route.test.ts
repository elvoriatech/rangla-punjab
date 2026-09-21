import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { placeOrder } from "@/lib/order-service";
import { signSession } from "@/lib/session";
import type { StaffOrder } from "@/lib/staff-service";
import { asTenant } from "@/lib/tenant";
import { POST as LOGOUT } from "../logout/route";
import { GET as SUMMARY } from "../summary/route";
import { POST as STATUS } from "./[id]/status/route";
import { GET } from "./route";

/**
 * The restaurant's orders board. Asserted at the wire level: the React
 * Native side codes against these exact keys, and `allowedNext` is the
 * ONLY thing telling it which buttons to draw — a silent change here is
 * a shipped app whose kitchen cannot advance an order.
 *
 * The security assertions matter as much as the shape ones: a guest
 * token must never open this door, and pulling the owner membership must
 * shut it on the very next request, with no token to revoke.
 */

interface OrdersBody {
  ok: boolean;
  error?: string;
  serverTime?: string;
  orders?: StaffOrder[];
  order?: StaffOrder;
  openOrders?: number;
  unpaidOnline?: number;
  pendingReservations?: number;
  openIssues?: number;
}

describe("/api/v1/staff/*", () => {
  let tenantId: string;
  let userId: string;
  let ownerEmail: string;
  let staffToken: string;
  let guestToken: string;
  let venue: { tenantId: string; venueId: string; publishedVersionId: string; itemId: string };
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    ownerEmail = `board-${randomUUID()}@ex.com`;
    const s = await signupUser({
      email: ownerEmail,
      password: "S3cureP4ssPhrase!",
      tenantName: "Board Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `board-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venue = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const v = await tx.venue.create({
        data: { tenantId, name: "Board Venue", slug, currency: "EUR" },
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

    const guest = await registerCustomerWithPassword(
      tenantId,
      `guest-${randomUUID()}@ex.com`,
      "S3cureP4ssPhrase!",
      "Amrit",
    );
    if (!guest.ok) throw new Error("guest registration failed");
    guestToken = guest.value.token;
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.orderItem.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.order.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.reservation.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customerToken.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(url: string, token?: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${url}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function placeDineIn(table: string): Promise<string> {
    const placed = await placeOrder(venue, {
      orderType: "dine_in",
      tableNumber: table,
      items: [{ itemId: venue.itemId, quantity: 2 }],
    });
    if (!placed.ok) throw new Error(`order failed: ${placed.error}`);
    return placed.value.orderId;
  }

  /** Flip the owner's "the app may cancel" switch (`ordering.appCancelEnabled`),
   *  which is web-dashboard-only and OFF by default. */
  async function setAppCancel(enabled: boolean): Promise<void> {
    await asTenant(tenantId, (tx) =>
      tx.venue.updateMany({
        where: { id: venue.venueId },
        data: { ordering: { appCancelEnabled: enabled } },
      }),
    );
  }

  async function board(query = ""): Promise<OrdersBody> {
    const res = await GET(request(`/api/v1/staff/orders${query}`, staffToken));
    expect(res.status).toBe(200);
    return (await res.json()) as OrdersBody;
  }

  it("401s with no token, a guest token, or a forged one", async () => {
    for (const token of [undefined, guestToken, "forged.payload"]) {
      const res = await GET(request("/api/v1/staff/orders", token));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("lists a placed order with the transitions the app may offer", async () => {
    const orderId = await placeDineIn("7");
    const res = await GET(request("/api/v1/staff/orders", staffToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const body = (await res.json()) as OrdersBody;
    expect(body.ok).toBe(true);
    expect(new Date(body.serverTime!).getTime()).toBeGreaterThan(0);

    const order = body.orders?.find((o) => o.id === orderId);
    expect(order).toBeDefined();
    expect(order).toMatchObject({
      status: "placed",
      orderType: "dine_in",
      tableNumber: "7",
      paymentStatus: "none",
      totalCents: 2400,
      discountCents: 0,
      currency: "EUR",
      deliveryAddress: null,
      requestedFor: null,
      // No complaint on this order — the board draws no pill (P7-10).
      issueStatus: null,
      issueId: null,
    });
    // dine-in never walks the courier leg, and "cancelled" is absent
    // because the owner switch is OFF by default — `allowedNext` is the
    // only thing that puts a cancel button on the board, so a fresh venue
    // ships an app that cannot cancel by accident.
    expect(order?.allowedNext).toEqual(["preparing", "ready", "done"]);
    expect(order?.items).toEqual([{ name: "Dal", quantity: 2, priceCents: 1200 }]);
    expect(typeof order?.orderNumber).toBe("number");
    expect(new Date(order!.createdAt).getTime()).toBeGreaterThan(0);
    expect(new Date(order!.updatedAt).getTime()).toBeGreaterThan(0);
  });

  it("advances an order, writes the row, and refuses going backwards", async () => {
    const orderId = await placeDineIn("8");

    const ok = await STATUS(
      request(`/api/v1/staff/orders/${orderId}/status`, staffToken, { to: "preparing" }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as OrdersBody;
    expect(body.order).toMatchObject({ id: orderId, status: "preparing" });
    expect(body.order?.allowedNext).toEqual(["ready", "done"]);

    const row = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { status: true } }),
    );
    expect(row.status).toBe("preparing");

    // Backwards is not a transition — the lifecycle is forward-only.
    const back = await STATUS(
      request(`/api/v1/staff/orders/${orderId}/status`, staffToken, { to: "placed" }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(back.status).toBe(409);
    expect(await back.json()).toEqual({ ok: false, error: "invalid_transition" });

    // out_for_delivery is not on a dine-in order's chain either.
    const courier = await STATUS(
      request(`/api/v1/staff/orders/${orderId}/status`, staffToken, {
        to: "out_for_delivery",
      }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(courier.status).toBe(409);
  });

  it("404s an order this restaurant cannot see, and 401s a guest token", async () => {
    const missing = await STATUS(
      request("/api/v1/staff/orders/nope/status", staffToken, { to: "preparing" }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: "not_found" });

    const asGuest = await STATUS(
      request("/api/v1/staff/orders/nope/status", guestToken, { to: "preparing" }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(asGuest.status).toBe(401);
  });

  it("filters to what changed when `since` is given", async () => {
    const older = await placeDineIn("10");
    const moved = await placeDineIn("11");

    await STATUS(request(`/api/v1/staff/orders/${moved}/status`, staffToken, { to: "preparing" }), {
      params: Promise.resolve({ id: moved }),
    });

    // Take the cutoff from the server's own view of the row, not from a
    // local clock: the DB container's clock is nobody's business here.
    const full = await board();
    const since = full.orders?.find((o) => o.id === moved)?.updatedAt;
    expect(since).toBeDefined();

    const delta = await board(`?since=${encodeURIComponent(since!)}`);
    expect(delta.orders?.map((o) => o.id)).toContain(moved);
    expect(delta.orders?.map((o) => o.id)).not.toContain(older);

    // A nonsense cutoff falls back to the whole board rather than 400ing
    // mid-service.
    const garbage = await board("?since=not-a-date");
    expect(garbage.orders?.map((o) => o.id)).toEqual(expect.arrayContaining([older, moved]));
  });

  it("keeps finished orders on the board but out of the open count", async () => {
    const orderId = await placeDineIn("12");
    await STATUS(request(`/api/v1/staff/orders/${orderId}/status`, staffToken, { to: "done" }), {
      params: Promise.resolve({ id: orderId }),
    });

    const body = await board();
    const done = body.orders?.find((o) => o.id === orderId);
    expect(done?.status).toBe("done");
    expect(done?.allowedNext).toEqual([]);
  });

  it("hides cancel from the app and refuses it server-side while the switch is off", async () => {
    const orderId = await placeDineIn("13a");

    // The board draws one button per `allowedNext` entry, so an absent
    // "cancelled" is the missing button.
    const listed = (await board()).orders?.find((o) => o.id === orderId);
    expect(listed?.allowedNext).not.toContain("cancelled");

    // UI-only would not be enough: a stale app, a replay or a curl must
    // be refused too, because a cancel cannot be undone.
    const res = await STATUS(
      request(`/api/v1/staff/orders/${orderId}/status`, staffToken, { to: "cancelled" }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "cancel_disabled" });

    // And the order is untouched — refused, not half-applied.
    const row = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { status: true } }),
    );
    expect(row.status).toBe("placed");

    // An id this restaurant cannot see still 404s: a refused cancel must
    // not tell the caller that an order exists.
    const missing = await STATUS(
      request("/api/v1/staff/orders/nope/status", staffToken, { to: "cancelled" }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("cancels an open order and leaves it with nowhere to go once the owner allows it", async () => {
    const orderId = await placeDineIn("13");
    await setAppCancel(true);

    // With the switch on, the button is back on every open card.
    const listed = (await board()).orders?.find((o) => o.id === orderId);
    expect(listed?.allowedNext).toEqual(["preparing", "ready", "done", "cancelled"]);

    const res = await STATUS(
      request(`/api/v1/staff/orders/${orderId}/status`, staffToken, { to: "cancelled" }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrdersBody;
    expect(body.order).toMatchObject({ id: orderId, status: "cancelled" });
    // Terminal: the app draws no buttons at all on a cancelled card.
    expect(body.order?.allowedNext).toEqual([]);

    const row = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { status: true } }),
    );
    expect(row.status).toBe("cancelled");

    // Cancelled stays ON the board (the history is what staff check) but
    // is closed, so nothing may reopen it.
    const board1 = await board();
    expect(board1.orders?.map((o) => o.id)).toContain(orderId);
    for (const to of ["preparing", "done", "cancelled"]) {
      const again = await STATUS(
        request(`/api/v1/staff/orders/${orderId}/status`, staffToken, { to }),
        { params: Promise.resolve({ id: orderId }) },
      );
      expect(again.status, `${to} must not reopen a cancelled order`).toBe(409);
    }

    await setAppCancel(false);
  });

  it("counts the three numbers the app badges", async () => {
    // "Open" is everything not terminal — a cancelled order owes the
    // kitchen no work, exactly like a finished one.
    const open = await asTenant(tenantId, (tx) =>
      tx.order.count({ where: { status: { notIn: ["done", "cancelled"] } } }),
    );
    await asTenant(tenantId, async (tx) => {
      await tx.order.updateMany({
        where: { status: { notIn: ["done", "cancelled"] } },
        data: { paymentStatus: "pending" },
      });
      await tx.reservation.create({
        data: {
          tenantId,
          venueId: venue.venueId,
          name: "Jas",
          phone: "+49 170 000",
          guests: 4,
          at: new Date(Date.now() + 86_400_000),
          date: "2030-01-01",
          time: "19:00",
        },
      });
    });

    const res = await SUMMARY(request("/api/v1/staff/summary", staffToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await res.json()) as OrdersBody;
    // Every open order was just made an unpaid ONLINE order: those are
    // held off the kitchen (owner rule 2026-09-21), so the kitchen badge
    // drops to 0 and they are counted as awaiting payment instead.
    expect(body).toEqual({
      ok: true,
      openOrders: 0,
      unpaidOnline: open,
      pendingReservations: 1,
      openIssues: 0,
    });

    const guestRes = await SUMMARY(request("/api/v1/staff/summary", guestToken));
    expect(guestRes.status).toBe(401);
  });

  it("acknowledges a logout without needing anything to revoke", async () => {
    const res = await LOGOUT(request("/api/v1/staff/logout", staffToken, {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("shuts the door the moment the owner membership is gone", async () => {
    await asTenant(tenantId, (tx) => tx.membership.updateMany({ data: { role: "staff" } }));
    const res = await GET(request("/api/v1/staff/orders", staffToken));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    await asTenant(tenantId, (tx) => tx.membership.updateMany({ data: { role: "owner" } }));
  });
});
