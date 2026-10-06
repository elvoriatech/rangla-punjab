import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { placeOrder } from "@/lib/order-service";
import { signSession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { GET as CATERING } from "./catering/route";
import { POST as CATERING_SET } from "./catering/[id]/route";
import { PATCH as ITEM } from "./items/[id]/route";
import { POST as DELETE_ORDER } from "./orders/[id]/delete/route";
import { GET as SUMMARY } from "./summary/route";
import { GET as TEAM, POST as TEAM_ADD } from "./team/route";
import { DELETE as TEAM_REMOVE, PATCH as TEAM_EDIT } from "./team/[id]/route";
import { POST as TEAM_PASSWORD } from "./team/[id]/password/route";

/**
 * The owner tools the restaurant app gained on 2026-10-06 — catering
 * enquiries, the two dish settings, deleting a cancelled order and the
 * team — asserted at the wire level, because the app codes against these
 * exact keys and status codes. Every one sits on a service the dashboard
 * already uses; what is under test is the route's gate and its shape.
 */

interface Body {
  ok: boolean;
  error?: string;
  requests?: {
    id: string;
    name: string;
    guests: number;
    status: string;
    location: string | null;
  }[];
  members?: {
    id: string;
    email: string;
    name: string | null;
    isOwner: boolean;
    permissions: string[];
  }[];
  areas?: string[];
  item?: { dineInOnly: boolean; availableDays: number[] };
  orderNumber?: number;
  pendingCatering?: number;
}

describe("staff owner tools", () => {
  let tenantId: string;
  let ownerId: string;
  let ownerToken: string;
  let venue: { tenantId: string; venueId: string; publishedVersionId: string; itemId: string };
  let cateringId: string;
  const staffEmail = `owner-tools-staff-${randomUUID()}@ex.com`;
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.14.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `owner-tools-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Owner Tools Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    ownerId = s.userId;
    ownerToken = signSession(ownerId);

    const slug = `owner-tools-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venue = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const v = await tx.venue.create({
        data: { tenantId, name: "Owner Tools Venue", slug, currency: "EUR" },
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
        data: { tenantId, categoryId: cat.id, name: "Korma", priceCents: 1300, orderIndex: 0 },
        select: { id: true },
      });
      const today = new Date().toISOString().slice(0, 10);
      const c = await tx.cateringRequest.create({
        data: {
          tenantId,
          venueId: v.id,
          name: "Firma Seeblick",
          phone: "+4975311234",
          guests: 40,
          date: today,
          time: "12:00",
          location: "Büro, Konstanz",
          message: "Vegetarisch, bitte",
        },
        select: { id: true },
      });
      cateringId = c.id;
      return { tenantId, venueId: v.id, publishedVersionId: version.id, itemId: item.id };
    });
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    // The deleted-orders log is append-only for the app role; it goes with
    // the venue (cascade), as in order-delete-service.test.ts.
    await asTenant(tenantId, async (tx) => {
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.cateringRequest.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.venue.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { OR: [{ id: ownerId }, { email: staffEmail }] } });
  });

  function request(url: string, token?: string, body?: unknown, method?: string): NextRequest {
    return new NextRequest(`http://localhost:3000${url}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const json = async (res: Response) => (await res.json()) as Body;

  describe("catering", () => {
    it("lists the enquiry and counts it on the summary", async () => {
      const res = await CATERING(request("/api/v1/staff/catering", ownerToken));
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.requests?.[0]).toMatchObject({
        id: cateringId,
        name: "Firma Seeblick",
        guests: 40,
        status: "requested",
        location: "Büro, Konstanz",
      });
      const summary = await json(await SUMMARY(request("/api/v1/staff/summary", ownerToken)));
      expect(summary.pendingCatering).toBe(1);
    });

    it("confirms, and refuses a status the restaurant cannot set", async () => {
      const bad = await CATERING_SET(
        request(`/api/v1/staff/catering/${cateringId}`, ownerToken, { status: "requested" }),
        params(cateringId),
      );
      expect(bad.status).toBe(400);
      const ok = await CATERING_SET(
        request(`/api/v1/staff/catering/${cateringId}`, ownerToken, { status: "confirmed" }),
        params(cateringId),
      );
      expect(ok.status).toBe(200);
      const summary = await json(await SUMMARY(request("/api/v1/staff/summary", ownerToken)));
      expect(summary.pendingCatering).toBe(0);
    });
  });

  describe("dish settings", () => {
    it("sets dine-in only and the weekdays, and reads them back", async () => {
      const res = await ITEM(
        request(
          `/api/v1/staff/items/${venue.itemId}`,
          ownerToken,
          { dineInOnly: true, availableDays: [4, 0, 0] },
          "PATCH",
        ),
        params(venue.itemId),
      );
      expect(res.status).toBe(200);
      expect((await json(res)).item).toMatchObject({ dineInOnly: true, availableDays: [0, 4] });
    });

    it("refuses an empty set of days", async () => {
      const res = await ITEM(
        request(`/api/v1/staff/items/${venue.itemId}`, ownerToken, { availableDays: [] }, "PATCH"),
        params(venue.itemId),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("deleting a cancelled order", () => {
    async function order(): Promise<string> {
      await asTenant(tenantId, (tx) =>
        tx.item.update({
          where: { id: venue.itemId },
          data: { availableDays: [0, 1, 2, 3, 4, 5, 6] },
        }),
      );
      const placed = await placeOrder(venue, {
        orderType: "dine_in",
        tableNumber: "4",
        items: [{ itemId: venue.itemId, quantity: 1 }],
      });
      if (!placed.ok) throw new Error(`order failed: ${JSON.stringify(placed)}`);
      return placed.value.orderId;
    }

    it("refuses an order that is not cancelled, and a missing reason", async () => {
      const id = await order();
      const live = await DELETE_ORDER(
        request(`/api/v1/staff/orders/${id}/delete`, ownerToken, { reason: "Testbestellung" }),
        params(id),
      );
      expect(live.status).toBe(409);
      expect((await json(live)).error).toBe("not_cancelled");

      await asTenant(tenantId, (tx) =>
        tx.order.update({ where: { id }, data: { status: "cancelled" } }),
      );
      const noReason = await DELETE_ORDER(
        request(`/api/v1/staff/orders/${id}/delete`, ownerToken, { reason: " " }),
        params(id),
      );
      expect(noReason.status).toBe(400);

      const ok = await DELETE_ORDER(
        request(`/api/v1/staff/orders/${id}/delete`, ownerToken, { reason: "Testbestellung" }),
        params(id),
      );
      expect(ok.status).toBe(200);
      expect(typeof (await json(ok)).orderNumber).toBe("number");
      const gone = await asTenant(tenantId, (tx) => tx.order.findFirst({ where: { id } }));
      expect(gone).toBeNull();
    });
  });

  describe("team", () => {
    let memberId: string;
    let staffToken: string;

    it("adds a team member with ticked areas", async () => {
      const res = await TEAM_ADD(
        request("/api/v1/staff/team", ownerToken, {
          name: "Ravi",
          email: staffEmail,
          password: "kitchen-2026!",
          permissions: ["orders", "reservations", "nonsense"],
        }),
      );
      expect(res.status).toBe(201);

      const list = await json(await TEAM(request("/api/v1/staff/team", ownerToken)));
      expect(list.areas).toContain("catering");
      const ravi = list.members?.find((m) => m.email === staffEmail);
      expect(ravi).toMatchObject({
        name: "Ravi",
        isOwner: false,
        permissions: ["orders", "reservations"],
      });
      expect(list.members?.some((m) => m.isOwner)).toBe(true);
      memberId = ravi!.id;
      const user = await prisma.user.findFirstOrThrow({ where: { email: staffEmail } });
      staffToken = signSession(user.id);
    });

    it("409s on an address already in use, 400s on a short password", async () => {
      const taken = await TEAM_ADD(
        request("/api/v1/staff/team", ownerToken, {
          name: "Again",
          email: staffEmail,
          password: "kitchen-2026!",
          permissions: [],
        }),
      );
      expect(taken.status).toBe(409);
      const weak = await TEAM_ADD(
        request("/api/v1/staff/team", ownerToken, {
          name: "Weak",
          email: `weak-${randomUUID()}@ex.com`,
          password: "short",
          permissions: [],
        }),
      );
      expect(weak.status).toBe(400);
      expect((await json(weak)).error).toBe("weak_password");
    });

    it("is the owner's alone — a team member gets 403 everywhere", async () => {
      expect((await TEAM(request("/api/v1/staff/team", staffToken))).status).toBe(403);
      const del = await DELETE_ORDER(
        request(`/api/v1/staff/orders/${randomUUID()}/delete`, staffToken, { reason: "nope" }),
        params(randomUUID()),
      );
      expect(del.status).toBe(403);
      // Not ticked: catering.
      expect((await CATERING(request("/api/v1/staff/catering", staffToken))).status).toBe(403);
    });

    it("edits areas, sets a password, and removes the member", async () => {
      const edit = await TEAM_EDIT(
        request(
          `/api/v1/staff/team/${memberId}`,
          ownerToken,
          {
            name: "Ravi K.",
            permissions: ["catering"],
          },
          "PATCH",
        ),
        params(memberId),
      );
      expect(edit.status).toBe(200);
      expect((await CATERING(request("/api/v1/staff/catering", staffToken))).status).toBe(200);

      const pw = await TEAM_PASSWORD(
        request(`/api/v1/staff/team/${memberId}/password`, ownerToken, {
          password: "new-pass-2026",
        }),
        params(memberId),
      );
      expect(pw.status).toBe(200);

      const removed = await TEAM_REMOVE(
        request(`/api/v1/staff/team/${memberId}`, ownerToken, undefined, "DELETE"),
        params(memberId),
      );
      expect(removed.status).toBe(200);
      const list = await json(await TEAM(request("/api/v1/staff/team", ownerToken)));
      expect(list.members?.some((m) => m.email === staffEmail)).toBe(false);
    });
  });
});
