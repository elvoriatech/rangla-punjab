import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { deletePrefix } from "@/lib/image-storage";
import type { IssueMessageWire } from "@/lib/issue-service";
import { MAX_ISSUE_PHOTO_BYTES } from "@/lib/issue-service";
import { placeOrder } from "@/lib/order-service";
import { signReceiptToken } from "@/lib/receipt-token";
import { signSession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { GET as STATUS } from "../status/route";
import { GET as PHOTO } from "./photo/[messageId]/route";
import { GET, POST } from "./route";

/**
 * The guest's complaint endpoints, at the wire level the tracking page
 * and the mobile app code against.
 *
 * Two things are load-bearing here and asserted hard: the receipt token
 * must be for THIS order (a valid token for someone else's order is not
 * a credential), and a photo must be reachable ONLY through the gated
 * route — never by a key, never without proof.
 */

interface IssueBody {
  ok: boolean;
  error?: string;
  created?: boolean;
  canReport?: boolean;
  windowEndsAt?: string;
  issue?: {
    id: string;
    orderId: string;
    status: string;
    messages: IssueMessageWire[];
  } | null;
  order?: { id: string; status: string };
}

/** The order rate limit is per IP and its Redis buckets outlive the
 *  process, so every request gets its own address — this file is about
 *  the contract, not about the limiter. */
let ipCounter = 0;
const ipPrefix = `10.11.${Math.floor(Math.random() * 250)}`;
const nextIp = (): string => `${ipPrefix}.${(ipCounter += 1) % 250}`;

/** One transparent pixel — real PNG bytes, so sharp genuinely decodes it. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("/api/v1/orders/{id}/issue", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  let venue: { tenantId: string; venueId: string; publishedVersionId: string; itemId: string };
  const originalSlug = process.env.RESTAURANT_SLUG;

  async function placeOne(table: string): Promise<{ orderId: string; token: string }> {
    const placed = await placeOrder(venue, {
      orderType: "dine_in",
      tableNumber: table,
      items: [{ itemId: venue.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error(`order failed: ${placed.error}`);
    return { orderId: placed.value.orderId, token: placed.value.receiptToken };
  }

  beforeAll(async () => {
    const s = await signupUser({
      email: `issue-api-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Issue API Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `issue-api-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venue = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const v = await tx.venue.create({
        data: { tenantId, name: "Issue Venue", slug, currency: "EUR" },
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
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function get(url: string): NextRequest {
    return new NextRequest(`http://localhost:3000${url}`, {
      headers: { "x-forwarded-for": nextIp() },
    });
  }

  function postJson(orderId: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000/api/v1/orders/${orderId}/issue`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify(body),
    });
  }

  /** A genuine multipart request — the browser shape the zero-JS tracking
   *  form posts. The boundary is left to the runtime on purpose. */
  function postForm(orderId: string, form: FormData): NextRequest {
    return new NextRequest(`http://localhost:3000/api/v1/orders/${orderId}/issue`, {
      method: "POST",
      headers: { "x-forwarded-for": nextIp() },
      body: form,
    });
  }

  it("401s a missing, forged, or other-order token on both verbs", async () => {
    const { orderId } = await placeOne("1");
    const stranger = signReceiptToken("some-other-order", tenantId);

    for (const token of ["", "forged.payload", stranger]) {
      const res = await GET(get(`/api/v1/orders/${orderId}/issue?token=${token}`), {
        params: Promise.resolve({ orderId }),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_token" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");

      const posted = await POST(postJson(orderId, { token, body: "Cold food" }), {
        params: Promise.resolve({ orderId }),
      });
      expect(posted.status).toBe(401);
    }
  });

  it("answers an open window and no thread before anything is reported", async () => {
    const { orderId, token } = await placeOne("2");
    const res = await GET(get(`/api/v1/orders/${orderId}/issue?token=${token}`), {
      params: Promise.resolve({ orderId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    const body = (await res.json()) as IssueBody;
    expect(body.ok).toBe(true);
    expect(body.canReport).toBe(true);
    expect(body.issue).toBeNull();
    expect(new Date(body.windowEndsAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("creates the thread from a multipart post with a real photo, then appends over JSON", async () => {
    const { orderId, token } = await placeOne("3");

    const form = new FormData();
    form.append("token", token);
    form.append("body", "The saag arrived cold — see the photo.");
    form.append("photo", new Blob([new Uint8Array(ONE_PIXEL_PNG)], { type: "image/png" }), "p.png");

    const created = await POST(postForm(orderId, form), {
      params: Promise.resolve({ orderId }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as IssueBody;
    expect(createdBody.created).toBe(true);
    expect(createdBody.issue!.status).toBe("open");
    const message = createdBody.issue!.messages[0]!;
    expect(message.body).toBe("The saag arrived cold — see the photo.");
    expect(message.hasPhoto).toBe(true);
    // Absolute, on our own origin, carrying the caller's OWN token back.
    expect(message.photoUrl).toBe(
      `http://localhost:3000/api/v1/orders/${orderId}/issue/photo/${message.id}?token=${encodeURIComponent(token)}`,
    );

    const appended = await POST(postJson(orderId, { token, body: "The naan was missing too." }), {
      params: Promise.resolve({ orderId }),
    });
    // 200, not 201: the thread already existed.
    expect(appended.status).toBe(200);
    const appendedBody = (await appended.json()) as IssueBody;
    expect(appendedBody.created).toBe(false);
    expect(appendedBody.issue!.id).toBe(createdBody.issue!.id);
    expect(appendedBody.issue!.messages).toHaveLength(2);
    expect(appendedBody.issue!.messages[1]!.photoUrl).toBeNull();
  });

  it("serves the photo to the token, to the restaurant, and to nobody else", async () => {
    const { orderId, token } = await placeOne("4");
    const other = await placeOne("5");

    const form = new FormData();
    form.append("token", token);
    form.append("body", "Evidence");
    form.append("photo", new Blob([new Uint8Array(ONE_PIXEL_PNG)], { type: "image/png" }), "p.png");
    const created = await POST(postForm(orderId, form), {
      params: Promise.resolve({ orderId }),
    });
    const messageId = ((await created.json()) as IssueBody).issue!.messages[0]!.id;
    const params = { params: Promise.resolve({ orderId, messageId }) };

    // 1. the guest's own receipt token
    const byToken = await PHOTO(
      get(`/api/v1/orders/${orderId}/issue/photo/${messageId}?token=${encodeURIComponent(token)}`),
      params,
    );
    expect(byToken.status).toBe(200);
    expect(byToken.headers.get("Content-Type")).toBe("image/png");
    expect(byToken.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(byToken.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await byToken.arrayBuffer()).byteLength).toBeGreaterThan(0);

    // 2. the restaurant's staff token, sent as an image header
    const staffReq = new NextRequest(
      `http://localhost:3000/api/v1/orders/${orderId}/issue/photo/${messageId}`,
      { headers: { "x-staff-token": staffToken, "x-forwarded-for": nextIp() } },
    );
    expect(
      (await PHOTO(staffReq, { params: Promise.resolve({ orderId, messageId }) })).status,
    ).toBe(200);

    // 3. everything else is one flat 404 — a probe learns nothing.
    for (const url of [
      `/api/v1/orders/${orderId}/issue/photo/${messageId}`,
      `/api/v1/orders/${orderId}/issue/photo/${messageId}?token=forged`,
      // A real token, for a DIFFERENT order: valid credential, wrong door.
      `/api/v1/orders/${orderId}/issue/photo/${messageId}?token=${encodeURIComponent(other.token)}`,
    ]) {
      const res = await PHOTO(get(url), { params: Promise.resolve({ orderId, messageId }) });
      expect(res.status, url).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    }

    // The message is real and the token is real, but the message does not
    // belong to the order in the path.
    const crossed = await PHOTO(
      get(
        `/api/v1/orders/${other.orderId}/issue/photo/${messageId}?token=${encodeURIComponent(other.token)}`,
      ),
      { params: Promise.resolve({ orderId: other.orderId, messageId }) },
    );
    expect(crossed.status).toBe(404);
  });

  it("refuses an empty body, a broken envelope, and an oversized photo", async () => {
    const { orderId, token } = await placeOne("6");

    const empty = await POST(postJson(orderId, { token, body: "   " }), {
      params: Promise.resolve({ orderId }),
    });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ ok: false, error: "invalid" });

    const noBody = await POST(postJson(orderId, { token }), {
      params: Promise.resolve({ orderId }),
    });
    expect(noBody.status).toBe(400);

    const big = new FormData();
    big.append("token", token);
    big.append("body", "huge");
    big.append(
      "photo",
      new Blob([new Uint8Array(MAX_ISSUE_PHOTO_BYTES + 1)], { type: "image/png" }),
      "big.png",
    );
    const tooLarge = await POST(postForm(orderId, big), {
      params: Promise.resolve({ orderId }),
    });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ ok: false, error: "too_large" });
  });

  it("403s a closed window and 409s a resolved thread", async () => {
    const { orderId, token } = await placeOne("7");
    // Backdate the order past the venue's default 3-hour window.
    await asTenant(tenantId, (tx) =>
      tx.order.updateMany({
        where: { id: orderId },
        data: { createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000) },
      }),
    );

    const closed = await POST(postJson(orderId, { token, body: "Too late" }), {
      params: Promise.resolve({ orderId }),
    });
    expect(closed.status).toBe(403);
    expect(await closed.json()).toEqual({ ok: false, error: "window_closed" });

    const state = await GET(get(`/api/v1/orders/${orderId}/issue?token=${token}`), {
      params: Promise.resolve({ orderId }),
    });
    expect(((await state.json()) as IssueBody).canReport).toBe(false);

    // A thread opened in time, then resolved, refuses the guest with 409.
    const fresh = await placeOne("8");
    const opened = await POST(postJson(fresh.orderId, { token: fresh.token, body: "Cold" }), {
      params: Promise.resolve({ orderId: fresh.orderId }),
    });
    const issueId = ((await opened.json()) as IssueBody).issue!.id;
    await asTenant(tenantId, (tx) =>
      tx.orderIssue.updateMany({
        where: { id: issueId },
        data: { status: "resolved", resolvedAt: new Date() },
      }),
    );
    const afterResolve = await POST(
      postJson(fresh.orderId, { token: fresh.token, body: "one more" }),
      { params: Promise.resolve({ orderId: fresh.orderId }) },
    );
    expect(afterResolve.status).toBe(409);
    expect(await afterResolve.json()).toEqual({ ok: false, error: "resolved" });
  });

  it("carries the complaint into the tracking status payload", async () => {
    const { orderId, token } = await placeOne("9");

    const before = (await (
      await STATUS(get(`/api/v1/orders/${orderId}/status?token=${token}`), {
        params: Promise.resolve({ orderId }),
      })
    ).json()) as IssueBody & { issue?: { status: string } | null };
    expect(before.canReport).toBe(true);
    expect(before.issue).toBeNull();

    await POST(postJson(orderId, { token, body: "Cold food" }), {
      params: Promise.resolve({ orderId }),
    });

    const after = (await (
      await STATUS(get(`/api/v1/orders/${orderId}/status?token=${token}`), {
        params: Promise.resolve({ orderId }),
      })
    ).json()) as IssueBody & { issue?: { status: string; updatedAt: string } | null };
    // A summary, not the thread: this is the polling endpoint.
    expect(after.issue).toMatchObject({ status: "open" });
    expect(new Date(after.issue!.updatedAt!).getTime()).toBeGreaterThan(0);
    expect(Object.keys(after.issue!)).toEqual(["status", "updatedAt"]);
    expect(after.canReport).toBe(true);
    // The order itself is untouched by any of this.
    expect(after.order).toMatchObject({ id: orderId, status: "placed" });
  });
});
