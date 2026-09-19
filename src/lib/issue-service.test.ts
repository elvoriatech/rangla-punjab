import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import { deletePrefix } from "./image-storage";
import {
  countOpenIssues,
  getGuestIssueState,
  getIssueSummaryForOrder,
  getStaffIssue,
  getStaffIssueByOrder,
  issueStatusByOrder,
  issueWindowEndsAt,
  ISSUE_BODY_MAX,
  listStaffIssues,
  MAX_ISSUE_PHOTO_BYTES,
  postGuestIssueMessage,
  readIssuePhoto,
  replyToIssue,
  resolveIssue,
} from "./issue-service";
import { placeOrder } from "./order-service";
import { asTenant } from "./tenant";

/**
 * Complaint threads (P7-10), at the level the rest of the app talks to
 * them: the window arithmetic as pure maths, and the status machine
 * against a real database — because "the guest may not post on a resolved
 * thread" is a claim about a row, not about a function.
 *
 * The isolation assertion earns its place too: a receipt token names a
 * tenant, and a thread read with the WRONG tenant must come back empty
 * rather than leak another restaurant's complaint.
 */

/** The smallest thing sharp will accept as a PNG: one transparent pixel.
 *  Real bytes on purpose — the photo path's whole point is that it decodes
 *  what it is given rather than trusting a Content-Type. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A wedge between the service's "is there a thread yet?" decision and its
 * write: the photo normalizer is the one slow step that sits between the
 * two, so a hook there is exactly the window a second request would land
 * in. Passthrough to real sharp whenever no hook is armed, so every other
 * test in this file still decodes genuine bytes.
 */
const wedge = vi.hoisted(() => ({ beforeNormalize: null as null | (() => Promise<void>) }));

vi.mock("./image-normalize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./image-normalize")>();
  return {
    ...actual,
    normalizeImage: async (input: Buffer) => {
      const hook = wedge.beforeNormalize;
      wedge.beforeNormalize = null;
      if (hook) await hook();
      return actual.normalizeImage(input);
    },
  };
});

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

interface Fixture {
  tenantId: string;
  userId: string;
  venueId: string;
  publishedVersionId: string;
  itemId: string;
}

async function fixture(windowHours?: number): Promise<Fixture> {
  const s = await signupUser({
    email: `issue-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: "Issue Test",
  });
  if (!s.ok) throw new Error("signup failed");
  createdUserIds.push(s.userId);
  createdTenantIds.push(s.tenantId);

  return asTenant(s.tenantId, async (tx) => {
    const venue = await tx.venue.create({
      data: {
        tenantId: s.tenantId,
        name: "Rangla Punjab",
        slug: `issue-${randomUUID().slice(0, 8)}`,
        currency: "EUR",
        ...(windowHours === undefined ? {} : { ordering: { issueWindowHours: windowHours } }),
      },
      select: { id: true },
    });
    const menu = await tx.menu.create({
      data: { tenantId: s.tenantId, venueId: venue.id, name: "Main", isDefault: true },
      select: { id: true },
    });
    const version = await tx.menuVersion.create({
      data: { tenantId: s.tenantId, menuId: menu.id, status: "published", publishedAt: new Date() },
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
        name: "Butter chicken",
        priceCents: 1450,
        orderIndex: 0,
      },
      select: { id: true },
    });
    return {
      tenantId: s.tenantId,
      userId: s.userId,
      venueId: venue.id,
      publishedVersionId: version.id,
      itemId: item.id,
    };
  });
}

async function orderedFixture(windowHours?: number): Promise<Fixture & { orderId: string }> {
  const fx = await fixture(windowHours);
  const placed = await placeOrder(fx, {
    orderType: "dine_in",
    tableNumber: "4",
    items: [{ itemId: fx.itemId, quantity: 1 }],
  });
  if (!placed.ok) throw new Error(`order failed: ${placed.error}`);
  return { ...fx, orderId: placed.value.orderId };
}

afterAll(async () => {
  for (const tenantId of createdTenantIds) {
    await deletePrefix(tenantId);
    await asTenant(tenantId, async (tx) => {
      await tx.orderIssueMessage.deleteMany({});
      await tx.orderIssue.deleteMany({});
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
  }
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("issueWindowEndsAt", () => {
  const placed = new Date("2026-09-19T12:00:00.000Z");

  it("runs from placement when the order is ASAP", () => {
    expect(issueWindowEndsAt({ createdAt: placed, requestedFor: null }, 3)).toEqual(
      new Date("2026-09-19T15:00:00.000Z"),
    );
  });

  it("runs from the REQUESTED time when the order is scheduled later", () => {
    // Ordered at noon for an 20:00 pickup: the guest cannot judge the
    // food until 20:00, so the clock has no business starting at noon.
    expect(
      issueWindowEndsAt(
        { createdAt: placed, requestedFor: new Date("2026-09-19T20:00:00.000Z") },
        3,
      ),
    ).toEqual(new Date("2026-09-19T23:00:00.000Z"));
  });

  it("never starts BEFORE placement, even with a backdated request time", () => {
    expect(
      issueWindowEndsAt(
        { createdAt: placed, requestedFor: new Date("2026-09-19T09:00:00.000Z") },
        1,
      ),
    ).toEqual(new Date("2026-09-19T13:00:00.000Z"));
  });

  it("has no ceiling — a week-long window is just arithmetic", () => {
    expect(issueWindowEndsAt({ createdAt: placed, requestedFor: null }, 168)).toEqual(
      new Date("2026-09-26T12:00:00.000Z"),
    );
  });
});

describe("guest side", () => {
  it("reports an open window and no thread on a fresh order", async () => {
    const fx = await orderedFixture();
    const state = await getGuestIssueState(fx.tenantId, fx.orderId);
    expect(state).not.toBeNull();
    expect(state!.canReport).toBe(true);
    expect(state!.issue).toBeNull();
    // The venue never set the key, so the 3-hour default applies.
    expect(new Date(state!.windowEndsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("creates the thread with its first message, then appends to it", async () => {
    const fx = await orderedFixture();

    const first = await postGuestIssueMessage(fx.tenantId, fx.orderId, {
      body: "  The butter chicken was stone cold.  ",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);
    expect(first.issue.status).toBe("open");
    expect(first.issue.messages).toHaveLength(1);
    // Trimmed on the way in, so the stored text is what was meant.
    expect(first.issue.messages[0]).toMatchObject({
      author: "guest",
      body: "The butter chicken was stone cold.",
      hasPhoto: false,
    });

    const second = await postGuestIssueMessage(fx.tenantId, fx.orderId, {
      body: "And the naan was missing.",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Same thread — one order, one conversation.
    expect(second.created).toBe(false);
    expect(second.issue.id).toBe(first.issue.id);
    expect(second.issue.messages.map((m) => m.body)).toEqual([
      "The butter chicken was stone cold.",
      "And the naan was missing.",
    ]);

    const summary = await getIssueSummaryForOrder(fx.tenantId, fx.orderId);
    expect(summary?.status).toBe("open");
    expect(await issueStatusByOrder(fx.tenantId, [fx.orderId])).toEqual(
      new Map([[fx.orderId, "open"]]),
    );
  });

  it("turns a double-tapped first post into ONE thread with two messages", async () => {
    const fx = await orderedFixture();

    // Both requests read "no thread yet" before either writes — the guest
    // tapped send twice while a photo uploaded. `order_id` is UNIQUE, so
    // one create wins and the loser must append rather than 500.
    const [a, b] = await Promise.all([
      postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "Cold food" }),
      postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "Cold food again" }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Exactly one of them opened the thread; both landed in the same one.
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.issue.id).toBe(b.issue.id);

    const counts = await asTenant(fx.tenantId, async (tx) => ({
      issues: await tx.orderIssue.count({ where: { orderId: fx.orderId } }),
      messages: await tx.orderIssueMessage.count({ where: { issueId: a.issue.id } }),
    }));
    expect(counts).toEqual({ issues: 1, messages: 2 });

    const state = await getGuestIssueState(fx.tenantId, fx.orderId);
    expect(state!.issue!.messages.map((m) => m.body).sort()).toEqual([
      "Cold food",
      "Cold food again",
    ]);
  });

  it("appends instead of 500ing when another request opens the thread first", async () => {
    const fx = await orderedFixture();

    // The thread appears while THIS request is normalizing its photo, so
    // its create loses the UNIQUE(order_id) race by construction.
    wedge.beforeNormalize = async () => {
      const winner = await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "First tap" });
      expect(winner.ok && winner.created).toBe(true);
    };
    const loser = await postGuestIssueMessage(fx.tenantId, fx.orderId, {
      body: "Second tap",
      photo: { bytes: ONE_PIXEL_PNG, contentType: "image/png" },
    });
    expect(loser.ok).toBe(true);
    if (!loser.ok) return;
    // Not an error, and not a second thread: the message joins the one
    // that won, and the photo with it.
    expect(loser.created).toBe(false);
    expect(loser.issue.messages.map((m) => [m.body, m.hasPhoto])).toEqual([
      ["First tap", false],
      ["Second tap", true],
    ]);

    const counts = await asTenant(fx.tenantId, async (tx) => ({
      issues: await tx.orderIssue.count({ where: { orderId: fx.orderId } }),
      messages: await tx.orderIssueMessage.count({ where: { issueId: loser.issue.id } }),
    }));
    expect(counts).toEqual({ issues: 1, messages: 2 });
  });

  it("refuses the loser of that race when the winner's thread is already resolved", async () => {
    const fx = await orderedFixture();

    wedge.beforeNormalize = async () => {
      const winner = await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "First tap" });
      if (!winner.ok) throw new Error("winner failed");
      await resolveIssue(fx.userId, winner.issue.id);
    };
    expect(
      await postGuestIssueMessage(fx.tenantId, fx.orderId, {
        body: "Second tap",
        photo: { bytes: ONE_PIXEL_PNG, contentType: "image/png" },
      }),
    ).toEqual({ ok: false, error: "resolved" });

    // One message only — and the orphaned photo was cleaned up rather
    // than left on disk pointing at nothing.
    const stored = await asTenant(fx.tenantId, (tx) =>
      tx.orderIssueMessage.findMany({ select: { body: true, photoKey: true } }),
    );
    expect(stored).toEqual([{ body: "First tap", photoKey: null }]);
  });

  it("refuses an empty or over-long message without touching the database", async () => {
    const fx = await orderedFixture();
    expect(await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "   " })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(
      await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "x".repeat(ISSUE_BODY_MAX + 1) }),
    ).toEqual({ ok: false, error: "invalid" });
    expect((await getGuestIssueState(fx.tenantId, fx.orderId))!.issue).toBeNull();
  });

  it("404s an order that is not in this tenant", async () => {
    expect(await getGuestIssueState((await fixture()).tenantId, "nope")).toBeNull();
    const fx = await orderedFixture();
    expect(await postGuestIssueMessage(fx.tenantId, "nope", { body: "hello" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("closes the window after the venue's issueWindowHours", async () => {
    const fx = await orderedFixture(1);
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const state = await getGuestIssueState(fx.tenantId, fx.orderId, later);
    expect(state!.canReport).toBe(false);
    expect(
      await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "Too late" }, later),
    ).toEqual({ ok: false, error: "window_closed" });
  });

  it("lets an OPEN thread outlive its window", async () => {
    const fx = await orderedFixture(1);
    const opened = await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "Cold food" });
    expect(opened.ok).toBe(true);

    const later = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const appended = await postGuestIssueMessage(
      fx.tenantId,
      fx.orderId,
      { body: "Still waiting" },
      later,
    );
    expect(appended.ok).toBe(true);
    // And the state endpoint agrees, so the page keeps drawing the form.
    expect((await getGuestIssueState(fx.tenantId, fx.orderId, later))!.canReport).toBe(true);
  });

  it("stores a normalized photo and serves it only by message id", async () => {
    const fx = await orderedFixture();
    const posted = await postGuestIssueMessage(fx.tenantId, fx.orderId, {
      body: "Look at this",
      photo: { bytes: ONE_PIXEL_PNG, contentType: "image/png" },
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;

    const message = posted.issue.messages[0]!;
    expect(message.hasPhoto).toBe(true);
    // The storage key is NOT in the view — a client that learned it could
    // fetch the bytes from the public /img route with no token at all.
    expect(JSON.stringify(posted.issue)).not.toContain("/issues/");

    const photo = await readIssuePhoto(fx.tenantId, message.id);
    expect(photo).not.toBeNull();
    expect(photo!.contentType).toBe("image/png");
    expect(photo!.orderId).toBe(fx.orderId);
    expect(photo!.bytes.length).toBeGreaterThan(0);

    // A message with no photo, and an id from nowhere, answer the same.
    const textOnly = await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "and this" });
    expect(textOnly.ok).toBe(true);
    if (!textOnly.ok) return;
    const plain = textOnly.issue.messages.find((m) => !m.hasPhoto)!;
    expect(await readIssuePhoto(fx.tenantId, plain.id)).toBeNull();
    expect(await readIssuePhoto(fx.tenantId, "no-such-message")).toBeNull();
  });

  it("refuses a photo that is too big, mistyped, or not an image at all", async () => {
    const fx = await orderedFixture();

    // Size is judged on the RAW bytes, before sharp allocates anything.
    expect(
      await postGuestIssueMessage(fx.tenantId, fx.orderId, {
        body: "huge",
        photo: { bytes: Buffer.alloc(MAX_ISSUE_PHOTO_BYTES + 1), contentType: "image/png" },
      }),
    ).toEqual({ ok: false, error: "too_large" });

    expect(
      await postGuestIssueMessage(fx.tenantId, fx.orderId, {
        body: "pdf",
        photo: { bytes: ONE_PIXEL_PNG, contentType: "application/pdf" },
      }),
    ).toEqual({ ok: false, error: "invalid_photo" });

    // Correct declared type, bytes that are not an image: the decoder is
    // the authority, not the header.
    expect(
      await postGuestIssueMessage(fx.tenantId, fx.orderId, {
        body: "renamed",
        photo: { bytes: Buffer.from("MZ this is not a picture"), contentType: "image/png" },
      }),
    ).toEqual({ ok: false, error: "invalid_photo" });

    expect((await getGuestIssueState(fx.tenantId, fx.orderId))!.issue).toBeNull();
  });

  it("cannot be read or written with another tenant's scope", async () => {
    const fx = await orderedFixture();
    await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "Cold food" });
    const other = await fixture();

    expect(await getGuestIssueState(other.tenantId, fx.orderId)).toBeNull();
    expect(await getIssueSummaryForOrder(other.tenantId, fx.orderId)).toBeNull();
    expect(await issueStatusByOrder(other.tenantId, [fx.orderId]).then((m) => m.size)).toBe(0);
    expect(await postGuestIssueMessage(other.tenantId, fx.orderId, { body: "hi" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await listStaffIssues(other.userId)).toEqual([]);
  });
});

describe("restaurant side", () => {
  it("answers, then resolves, and the guest goes read-only", async () => {
    const fx = await orderedFixture();
    const opened = await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "Cold food" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const issueId = opened.issue.id;

    expect(await countOpenIssues(fx.userId)).toBe(1);

    const replied = await replyToIssue(fx.userId, issueId, "  So sorry — refunding you now.  ");
    expect(replied.ok).toBe(true);
    if (!replied.ok) return;
    expect(replied.issue.status).toBe("answered");
    expect(replied.issue.messages.at(-1)).toMatchObject({
      author: "restaurant",
      body: "So sorry — refunding you now.",
    });
    // The order's own details ride along, so the thread screen needs one call.
    expect(replied.issue).toMatchObject({
      orderType: "dine_in",
      orderTotalCents: 1450,
      currency: "EUR",
    });
    expect(typeof replied.issue.orderNumber).toBe("number");
    // Still unresolved: answering is not closing.
    expect(await countOpenIssues(fx.userId)).toBe(1);

    // A guest reply puts the ball back in the restaurant's court.
    const back = await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "Thank you" });
    expect(back.ok && back.issue.status).toBe("open");

    const resolved = await resolveIssue(fx.userId, issueId);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.issue.status).toBe("resolved");
    expect(resolved.issue.resolvedAt).not.toBeNull();
    expect(await countOpenIssues(fx.userId)).toBe(0);

    // The guest side is now read-only...
    expect(await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "one more thing" })).toEqual(
      { ok: false, error: "resolved" },
    );
    expect((await getGuestIssueState(fx.tenantId, fx.orderId))!.canReport).toBe(false);

    // ...but the restaurant may still add a note, and it stays resolved.
    const note = await replyToIssue(fx.userId, issueId, "Refund sent.");
    expect(note.ok && note.issue.status).toBe("resolved");
  });

  it("lists unresolved threads newest-activity-first, resolved only on request", async () => {
    const fx = await fixture();
    const orderIds: string[] = [];
    for (const table of ["1", "2"]) {
      const placed = await placeOrder(fx, {
        orderType: "dine_in",
        tableNumber: table,
        items: [{ itemId: fx.itemId, quantity: 1 }],
      });
      if (!placed.ok) throw new Error("order failed");
      orderIds.push(placed.value.orderId);
      await postGuestIssueMessage(fx.tenantId, placed.value.orderId, { body: `Problem ${table}` });
    }

    const list = await listStaffIssues(fx.userId);
    expect(list).toHaveLength(2);
    // The second complaint was written last, so it leads.
    expect(list[0]!.orderId).toBe(orderIds[1]);
    expect(list[0]).toMatchObject({
      status: "open",
      messageCount: 1,
      lastMessage: { author: "guest", body: "Problem 2" },
    });

    const byOrder = await getStaffIssueByOrder(fx.userId, orderIds[0]!);
    expect(byOrder?.orderId).toBe(orderIds[0]);
    expect(await getStaffIssue(fx.userId, byOrder!.id)).toMatchObject({ id: byOrder!.id });

    await resolveIssue(fx.userId, byOrder!.id);
    expect((await listStaffIssues(fx.userId)).map((i) => i.orderId)).toEqual([orderIds[1]]);
    expect((await listStaffIssues(fx.userId, { includeResolved: true }))).toHaveLength(2);
    expect(await issueStatusByOrder(fx.tenantId, orderIds)).toEqual(
      new Map([
        [orderIds[0]!, "resolved"],
        [orderIds[1]!, "open"],
      ]),
    );
  });

  it("refuses an empty reply and an issue this restaurant cannot see", async () => {
    const fx = await orderedFixture();
    const opened = await postGuestIssueMessage(fx.tenantId, fx.orderId, { body: "Cold food" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(await replyToIssue(fx.userId, opened.issue.id, "   ")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await replyToIssue(fx.userId, "nope", "hello")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await resolveIssue(fx.userId, "nope")).toEqual({ ok: false, error: "not_found" });

    const other = await fixture();
    expect(await getStaffIssue(other.userId, opened.issue.id)).toBeNull();
    expect(await replyToIssue(other.userId, opened.issue.id, "mine now")).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
