import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { deletePrefix } from "@/lib/image-storage";
import type { StaffIssueSummary, StaffIssueView } from "@/lib/issue-service";
import { postGuestIssueMessage } from "@/lib/issue-service";
import { placeOrder } from "@/lib/order-service";
import { signSession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { GET as SUMMARY } from "../summary/route";
import { GET as ORDERS } from "../orders/route";
import { GET as ISSUE } from "./[id]/route";
import { POST as REPLY } from "./[id]/messages/route";
import { POST as RESOLVE } from "./[id]/resolve/route";
import { GET } from "./route";

/**
 * The restaurant's complaints endpoints. Asserted at the wire level for
 * the same reason the orders board is: the app codes against these exact
 * keys, and `status` is what tells it whether to draw "reply" or
 * "resolved".
 *
 * The credential assertions matter as much as the shape ones — a guest
 * token is not a staff token, however valid it is for its own purpose.
 */

interface Body {
  ok: boolean;
  error?: string;
  issues?: StaffIssueSummary[];
  issue?: StaffIssueView & { messages: { photoUrl: string | null }[] };
  openIssues?: number;
  orders?: { id: string; issueStatus: string | null; issueId: string | null }[];
}

describe("/api/v1/staff/issues", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  let guestToken: string;
  let venue: { tenantId: string; venueId: string; publishedVersionId: string; itemId: string };
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.12.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `issues-staff-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Issues Staff Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `issues-staff-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venue = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const v = await tx.venue.create({
        data: { tenantId, name: "Complaints Venue", slug, currency: "EUR" },
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
    await deletePrefix(tenantId);
    await asTenant(tenantId, async (tx) => {
      await tx.orderIssueMessage.deleteMany({});
      await tx.orderIssue.deleteMany({});
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.customerToken.deleteMany({});
      await tx.customer.deleteMany({});
      await tx.membership.deleteMany({});
    });
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

  /** An order with a complaint already on it. */
  async function complaint(table: string, text: string): Promise<{ orderId: string; id: string }> {
    const placed = await placeOrder(venue, {
      orderType: "dine_in",
      tableNumber: table,
      items: [{ itemId: venue.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    const posted = await postGuestIssueMessage(tenantId, placed.value.orderId, { body: text });
    if (!posted.ok) throw new Error(`issue failed: ${posted.error}`);
    return { orderId: placed.value.orderId, id: posted.issue.id };
  }

  it("401s with no token, a guest token, or a forged one", async () => {
    for (const token of [undefined, guestToken, "forged.payload"]) {
      const res = await GET(request("/api/v1/staff/issues", token));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");

      const one = await ISSUE(request("/api/v1/staff/issues/x", token), {
        params: Promise.resolve({ id: "x" }),
      });
      expect(one.status).toBe(401);

      const replied = await REPLY(request("/api/v1/staff/issues/x/messages", token, { body: "hi" }), {
        params: Promise.resolve({ id: "x" }),
      });
      expect(replied.status).toBe(401);

      const resolved = await RESOLVE(request("/api/v1/staff/issues/x/resolve", token, {}), {
        params: Promise.resolve({ id: "x" }),
      });
      expect(resolved.status).toBe(401);
    }
  });

  it("lists the unresolved complaints with the order they belong to", async () => {
    const first = await complaint("21", "The korma was cold");

    const res = await GET(request("/api/v1/staff/issues", staffToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await res.json()) as Body;
    expect(body.ok).toBe(true);

    const row = body.issues?.find((i) => i.id === first.id);
    expect(row).toMatchObject({
      orderId: first.orderId,
      orderType: "dine_in",
      status: "open",
      messageCount: 1,
      lastMessage: { author: "guest", body: "The korma was cold" },
    });
    expect(typeof row?.orderNumber).toBe("number");

    // The board pill and the badge both see it.
    const summary = (await (
      await SUMMARY(request("/api/v1/staff/summary", staffToken))
    ).json()) as Body;
    expect(summary.openIssues).toBe(1);
    const orders = (await (
      await ORDERS(request("/api/v1/staff/orders", staffToken))
    ).json()) as Body;
    // The pill's status AND the thread it links to, in one board read.
    expect(orders.orders?.find((o) => o.id === first.orderId)).toMatchObject({
      issueStatus: "open",
      issueId: first.id,
    });
  });

  it("reads one thread, answers it, and resolves it", async () => {
    const { id, orderId } = await complaint("22", "Missing the raita");

    const read = await ISSUE(request(`/api/v1/staff/issues/${id}`, staffToken), {
      params: Promise.resolve({ id }),
    });
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as Body;
    expect(readBody.issue).toMatchObject({ id, orderId, status: "open", currency: "EUR" });
    expect(readBody.issue?.messages).toHaveLength(1);
    // No photo on this one, and no guest token anywhere in a staff answer.
    expect(readBody.issue?.messages[0]?.photoUrl).toBeNull();

    const replied = await REPLY(
      request(`/api/v1/staff/issues/${id}/messages`, staffToken, {
        body: "So sorry — a raita is on its way.",
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(replied.status).toBe(200);
    const repliedBody = (await replied.json()) as Body;
    expect(repliedBody.issue?.status).toBe("answered");
    expect(repliedBody.issue?.messages.at(-1)).toMatchObject({
      author: "restaurant",
      body: "So sorry — a raita is on its way.",
    });

    const resolved = await RESOLVE(request(`/api/v1/staff/issues/${id}/resolve`, staffToken, {}), {
      params: Promise.resolve({ id }),
    });
    expect(resolved.status).toBe(200);
    const resolvedBody = (await resolved.json()) as Body;
    expect(resolvedBody.issue?.status).toBe("resolved");
    expect(resolvedBody.issue?.resolvedAt).not.toBeNull();

    // Gone from the working set, still there behind ?all=1.
    const open = (await (await GET(request("/api/v1/staff/issues", staffToken))).json()) as Body;
    expect(open.issues?.map((i) => i.id)).not.toContain(id);
    const all = (await (
      await GET(request("/api/v1/staff/issues?all=1", staffToken))
    ).json()) as Body;
    expect(all.issues?.map((i) => i.id)).toContain(id);

    // The order card keeps its pill after the thread is closed.
    const orders = (await (
      await ORDERS(request("/api/v1/staff/orders", staffToken))
    ).json()) as Body;
    expect(orders.orders?.find((o) => o.id === orderId)).toMatchObject({
      issueStatus: "resolved",
      issueId: id,
    });
  });

  it("400s an empty reply and 404s a thread that does not exist", async () => {
    const { id } = await complaint("23", "Too spicy");

    const empty = await REPLY(request(`/api/v1/staff/issues/${id}/messages`, staffToken, {}), {
      params: Promise.resolve({ id }),
    });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ ok: false, error: "invalid" });

    const blank = await REPLY(
      request(`/api/v1/staff/issues/${id}/messages`, staffToken, { body: "   " }),
      { params: Promise.resolve({ id }) },
    );
    expect(blank.status).toBe(400);

    for (const res of [
      await ISSUE(request("/api/v1/staff/issues/nope", staffToken), {
        params: Promise.resolve({ id: "nope" }),
      }),
      await REPLY(request("/api/v1/staff/issues/nope/messages", staffToken, { body: "hi" }), {
        params: Promise.resolve({ id: "nope" }),
      }),
      await RESOLVE(request("/api/v1/staff/issues/nope/resolve", staffToken, {}), {
        params: Promise.resolve({ id: "nope" }),
      }),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    }
  });
});
