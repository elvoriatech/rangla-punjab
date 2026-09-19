import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeImage } from "./image-normalize";
import { deleteUpload, readUpload, writeUpload } from "./image-storage";
import { parseOrderingConfig } from "./ordering-config";
import { siteUrl } from "./site-url";
import { asTenant, asUser } from "./tenant";

/**
 * Complaint threads on an order (P7-10) — the single writer for both
 * sides of the conversation.
 *
 * A guest with a receipt token may open ONE thread per order and keep
 * adding to it; the restaurant, authenticated as itself, replies and
 * eventually resolves. Both sides go through this module so the status
 * machine has exactly one implementation: the web server action, the v1
 * API and the dashboard all call the same functions rather than three
 * lookalikes that drift.
 *
 * ## The two clocks
 *
 * OPENING a thread is time-boxed by the venue's `issueWindowHours`
 * (Settings → Ordering, default 3). The window runs from the LATER of
 * the order's placement and its requested time, so an order placed at
 * 17:00 for a 20:00 pickup still has its full window after the food is
 * in the guest's hands.
 *
 * ADDING to a thread that already exists is not time-boxed at all. Once
 * the restaurant is in the conversation, cutting the guest off mid-reply
 * because a clock ran out would be worse than useless — so the window
 * gates creation only, and `resolved` (a restaurant decision) is what
 * ends the guest's side.
 *
 * ## Photos
 *
 * One optional photo per message. The declared MIME type is a cheap
 * first gate; what is actually stored is decided by `normalizeImage`,
 * which detects the real format from the bytes, strips EXIF/GPS (a
 * guest's kitchen photo carries their location) and caps the longest
 * edge. The bytes land on local disk under `{tenantId}/issues/{uuid}`
 * and are served ONLY by the token-gated photo route — never by `/img`,
 * which is public and immutable-cached.
 */

export type IssueStatus = "open" | "answered" | "resolved";
export type IssueAuthor = "guest" | "restaurant";

/** Long enough for the whole story, short enough that the column stays a
 *  message rather than an essay the dashboard cannot render. */
export const ISSUE_BODY_MAX = 2000;

/** Raw upload ceiling, checked on the bytes BEFORE decoding. A modern
 *  phone photo is 3–8 MB at full resolution and 1–2 MB at the quality the
 *  app picks; 5 MB accepts the realistic ones and refuses the rest early,
 *  without sharp ever allocating a pixel buffer. */
export const MAX_ISSUE_PHOTO_BYTES = 5 * 1024 * 1024;

export const ISSUE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface IssueMessageView {
  id: string;
  author: IssueAuthor;
  body: string;
  hasPhoto: boolean;
  /** ISO-8601. */
  createdAt: string;
}

export interface IssueView {
  id: string;
  orderId: string;
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Oldest first — the order the conversation happened in. */
  messages: IssueMessageView[];
}

export interface GuestIssueState {
  /** May the guest post right now? True while the window is open with no
   *  thread yet, and true on any thread that is not resolved. */
  canReport: boolean;
  windowEndsAt: string;
  issue: IssueView | null;
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

const HOUR_MS = 60 * 60 * 1000;

/**
 * When the "you may still report a problem" window closes. Pure, so the
 * page, the API and the tests all agree without a database.
 */
export function issueWindowEndsAt(
  order: { createdAt: Date; requestedFor: Date | null },
  windowHours: number,
): Date {
  const requested = order.requestedFor ?? order.createdAt;
  const base = Math.max(order.createdAt.getTime(), requested.getTime());
  return new Date(base + windowHours * HOUR_MS);
}

/** The DB column is a CHECK-constrained TEXT; this is where it becomes
 *  the union the rest of the app reasons about. An unknown value can only
 *  come from a hand-edited row, and `open` is the safe reading of it —
 *  it puts the thread in front of the restaurant instead of hiding it. */
function asIssueStatus(raw: string): IssueStatus {
  return raw === "answered" || raw === "resolved" ? raw : "open";
}

function asIssueAuthor(raw: string): IssueAuthor {
  return raw === "restaurant" ? "restaurant" : "guest";
}

/* ------------------------------------------------------------------ */
/* Wire shaping                                                        */
/* ------------------------------------------------------------------ */

/**
 * Absolute URL of one message's photo. The guest's copy carries their own
 * receipt token (echoed, never minted here); the restaurant's carries
 * none, because the app sends `X-Staff-Token` as an image header and the
 * dashboard rides its session cookie.
 */
export function issuePhotoUrl(orderId: string, messageId: string, token?: string | null): string {
  const base = `${siteUrl()}/api/v1/orders/${orderId}/issue/photo/${messageId}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export interface IssueMessageWire extends IssueMessageView {
  photoUrl: string | null;
}

/** The view every HTTP surface answers with: the same thread, with each
 *  message's photo resolved to a URL the caller can actually fetch. */
export function withPhotoUrls<T extends IssueView>(
  issue: T,
  token?: string | null,
): Omit<T, "messages"> & { messages: IssueMessageWire[] } {
  return {
    ...issue,
    messages: issue.messages.map((m) => ({
      ...m,
      photoUrl: m.hasPhoto ? issuePhotoUrl(issue.orderId, m.id, token) : null,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Selects                                                             */
/* ------------------------------------------------------------------ */

const messageSelect = {
  id: true,
  author: true,
  body: true,
  photoKey: true,
  createdAt: true,
} satisfies Prisma.OrderIssueMessageSelect;

const issueSelect = {
  id: true,
  orderId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  messages: { select: messageSelect, orderBy: { createdAt: "asc" } },
} satisfies Prisma.OrderIssueSelect;

type IssueRow = Prisma.OrderIssueGetPayload<{ select: typeof issueSelect }>;

function toIssueView(row: IssueRow): IssueView {
  return {
    id: row.id,
    orderId: row.orderId,
    status: asIssueStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    messages: row.messages.map((m) => ({
      id: m.id,
      author: asIssueAuthor(m.author),
      body: m.body,
      // The KEY never leaves the server: a client that learns it could
      // ask `/img` for the bytes with no token at all.
      hasPhoto: m.photoKey !== null,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Guest side (receipt-token authorized; caller has already verified)   */
/* ------------------------------------------------------------------ */

/** null ⇒ no such order in this tenant. */
export async function getGuestIssueState(
  tenantId: string,
  orderId: string,
  now: Date = new Date(),
): Promise<GuestIssueState | null> {
  return asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: { createdAt: true, requestedFor: true, venue: { select: { ordering: true } } },
    });
    if (!order) return null;

    const endsAt = issueWindowEndsAt(
      order,
      parseOrderingConfig(order.venue.ordering).issueWindowHours,
    );
    const row = await tx.orderIssue.findFirst({ where: { orderId }, select: issueSelect });
    const issue = row ? toIssueView(row) : null;
    return {
      // An open conversation outlives its window; a resolved one is
      // read-only for the guest however fresh the order is.
      canReport: issue ? issue.status !== "resolved" : now.getTime() <= endsAt.getTime(),
      windowEndsAt: endsAt.toISOString(),
      issue,
    };
  });
}

export type GuestPostError =
  "not_found" | "window_closed" | "resolved" | "invalid" | "invalid_photo" | "too_large";

export type GuestPostResult =
  { ok: true; issue: IssueView; created: boolean } | { ok: false; error: GuestPostError };

/**
 * The guest's turn: create the thread with its first message, or append
 * to the one that exists.
 *
 * Work is ordered so the cheap refusals come first and nothing reaches
 * the disk that a forged order id could have caused: declared type and
 * size, then the order/window/status decision, and only then the sharp
 * decode + write. The final authority is still the write transaction.
 *
 * The owner email fires from HERE rather than from the callers, so a web
 * server action and the mobile API cannot disagree about whether the
 * restaurant was told. It is fire-and-forget: a mail outage must never
 * turn a guest's complaint into an error page.
 */
export async function postGuestIssueMessage(
  tenantId: string,
  orderId: string,
  input: { body: string; photo?: { bytes: Buffer; contentType: string } | null },
  now: Date = new Date(),
): Promise<GuestPostResult> {
  const body = (input.body ?? "").trim();
  if (body.length === 0 || body.length > ISSUE_BODY_MAX) return { ok: false, error: "invalid" };

  const photo = input.photo ?? null;
  if (photo) {
    if (photo.bytes.length > MAX_ISSUE_PHOTO_BYTES) return { ok: false, error: "too_large" };
    if (photo.bytes.length === 0) return { ok: false, error: "invalid_photo" };
    if (!(ISSUE_PHOTO_TYPES as readonly string[]).includes(photo.contentType)) {
      return { ok: false, error: "invalid_photo" };
    }
  }

  const decision = await asTenant(
    tenantId,
    async (
      tx,
    ): Promise<
      | { error: GuestPostError }
      | { error?: undefined; issueId: string | null; venueId: string; customerId: string | null }
    > => {
      const order = await tx.order.findFirst({
        where: { id: orderId },
        select: {
          venueId: true,
          customerId: true,
          createdAt: true,
          requestedFor: true,
          venue: { select: { ordering: true } },
        },
      });
      if (!order) return { error: "not_found" };

      const existing = await tx.orderIssue.findFirst({
        where: { orderId },
        select: { id: true, status: true },
      });
      if (existing) {
        if (asIssueStatus(existing.status) === "resolved") return { error: "resolved" };
        return { issueId: existing.id, venueId: order.venueId, customerId: order.customerId };
      }

      const hours = parseOrderingConfig(order.venue.ordering).issueWindowHours;
      if (now.getTime() > issueWindowEndsAt(order, hours).getTime()) {
        return { error: "window_closed" };
      }
      return { issueId: null, venueId: order.venueId, customerId: order.customerId };
    },
  );
  if (decision.error !== undefined) return { ok: false, error: decision.error };

  let photoKey: string | null = null;
  let photoType: string | null = null;
  if (photo) {
    // Byte-verified, EXIF-stripped, edge-capped. A renamed .exe or a
    // spoofed Content-Type dies here, not in storage.
    const normalized = await normalizeImage(photo.bytes);
    if (!normalized.ok) return { ok: false, error: "invalid_photo" };
    photoKey = `${tenantId}/issues/${randomUUID()}`;
    photoType = normalized.contentType;
    await writeUpload(photoKey, normalized.bytes);
  }

  let written: WrittenMessage;
  try {
    written = await writeGuestMessage(tenantId, orderId, decision, {
      body,
      photoKey,
      photoType,
    });
  } catch (err) {
    // `order_issues.order_id` is UNIQUE, and a guest who double-taps
    // "send" while a photo uploads fires two requests that both read "no
    // thread yet" before either writes. One create wins; the other lands
    // here. The loser is not an error — its message belongs in the thread
    // the winner just made, so re-read and append. (A Postgres constraint
    // violation aborts the surrounding transaction, which is why this is
    // a fresh call rather than a catch inside the first one.)
    if (!isUniqueViolation(err)) throw err;

    const existing = await asTenant(tenantId, (tx) =>
      tx.orderIssue.findFirst({ where: { orderId }, select: { id: true, status: true } }),
    );
    if (!existing) throw err;
    if (asIssueStatus(existing.status) === "resolved") {
      // Resolved between our decision and our write: the guest side is
      // read-only, and the photo we normalized has nowhere to live.
      if (photoKey) await deleteUpload(photoKey).catch(() => undefined);
      return { ok: false, error: "resolved" };
    }
    written = await writeGuestMessage(
      tenantId,
      orderId,
      { issueId: existing.id, venueId: decision.venueId, customerId: decision.customerId },
      { body, photoKey, photoType },
    );
  }

  void notifyOwner(tenantId, written.issueId);
  return { ok: true, issue: written.issue, created: written.created };
}

interface WrittenMessage {
  issueId: string;
  created: boolean;
  issue: IssueView;
}

/** The write half of a guest post: create the thread if this attempt is
 *  the one opening it, then append the message and read the thread back.
 *  One transaction, so a message can never exist without its thread. */
async function writeGuestMessage(
  tenantId: string,
  orderId: string,
  target: { issueId: string | null; venueId: string; customerId: string | null },
  message: { body: string; photoKey: string | null; photoType: string | null },
): Promise<WrittenMessage> {
  return asTenant(tenantId, async (tx) => {
    let issueId = target.issueId;
    let created = false;
    if (issueId === null) {
      const row = await tx.orderIssue.create({
        data: {
          tenantId,
          venueId: target.venueId,
          orderId,
          customerId: target.customerId,
          status: "open",
        },
        select: { id: true },
      });
      issueId = row.id;
      created = true;
    } else {
      // A guest turn always puts the ball back in the restaurant's court,
      // and the write bumps `updatedAt` so "newest activity first" on the
      // complaints list means what it says.
      await tx.orderIssue.update({ where: { id: issueId }, data: { status: "open" } });
    }
    await tx.orderIssueMessage.create({
      data: { tenantId, issueId, author: "guest", ...message },
    });
    const fresh = await tx.orderIssue.findFirstOrThrow({
      where: { id: issueId },
      select: issueSelect,
    });
    return { issueId, created, issue: toIssueView(fresh) };
  });
}

/** P2002 = unique constraint. Prisma wraps it; the raw driver error can
 *  also surface as Postgres SQLSTATE 23505 when an adapter re-throws, so
 *  both spellings count as "somebody beat us to it". */
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code === "P2002";
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

/** Imported lazily so the email template (and React) never load on a read
 *  path, and so the notification module can never form an import cycle
 *  back into the service. Swallows everything: see the doc above. */
async function notifyOwner(tenantId: string, issueId: string): Promise<void> {
  try {
    const { sendNewIssueNotification } = await import("./issue-notification");
    await sendNewIssueNotification(tenantId, issueId);
  } catch {
    /* the complaint is already saved; the email is a courtesy */
  }
  try {
    // …and on their phone (P7-11). A separate try so a mail failure above
    // cannot swallow the push, and vice versa: two channels, two courtesies,
    // neither able to take the other down or fail the guest's complaint.
    const { sendNewIssuePush } = await import("./push-service");
    await sendNewIssuePush(tenantId, issueId);
  } catch {
    /* same posture as the email above */
  }
}

/** Cheap lookup for the status endpoint and the staff order lists. */
export async function getIssueSummaryForOrder(
  tenantId: string,
  orderId: string,
): Promise<{ status: IssueStatus; updatedAt: string } | null> {
  const row = await asTenant(tenantId, (tx) =>
    tx.orderIssue.findFirst({ where: { orderId }, select: { status: true, updatedAt: true } }),
  );
  return row ? { status: asIssueStatus(row.status), updatedAt: row.updatedAt.toISOString() } : null;
}

export interface IssueRef {
  id: string;
  status: IssueStatus;
}

/**
 * One query for a whole board: which of these orders carries a thread,
 * what state it is in, and its id — so a card can link straight to the
 * thread without a second lookup per order. Empty input never touches
 * the database.
 */
export async function issueRefByOrder(
  tenantId: string,
  orderIds: string[],
): Promise<Map<string, IssueRef>> {
  const out = new Map<string, IssueRef>();
  if (orderIds.length === 0) return out;
  const rows = await asTenant(tenantId, (tx) =>
    tx.orderIssue.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, orderId: true, status: true },
    }),
  );
  for (const row of rows) out.set(row.orderId, { id: row.id, status: asIssueStatus(row.status) });
  return out;
}

/** The status-only projection of {@link issueRefByOrder}, kept because
 *  most callers only ever want the pill. */
export async function issueStatusByOrder(
  tenantId: string,
  orderIds: string[],
): Promise<Map<string, IssueStatus>> {
  const refs = await issueRefByOrder(tenantId, orderIds);
  return new Map([...refs].map(([orderId, ref]) => [orderId, ref.status]));
}

/* ------------------------------------------------------------------ */
/* Restaurant side (userId-scoped, like order-service)                 */
/* ------------------------------------------------------------------ */

export interface StaffIssueSummary {
  id: string;
  orderId: string;
  orderNumber: number;
  orderType: string;
  status: IssueStatus;
  customerName: string | null;
  customerPhone: string | null;
  messageCount: number;
  lastMessage: { author: IssueAuthor; body: string; createdAt: string };
  createdAt: string;
  updatedAt: string;
}

export interface StaffIssueView extends IssueView {
  orderNumber: number;
  orderType: string;
  customerName: string | null;
  customerPhone: string | null;
  orderTotalCents: number;
  currency: string;
  orderCreatedAt: string;
}

const staffIssueSelect = {
  ...issueSelect,
  order: {
    select: {
      orderNumber: true,
      orderType: true,
      customerName: true,
      customerPhone: true,
      totalCents: true,
      currency: true,
      createdAt: true,
    },
  },
} satisfies Prisma.OrderIssueSelect;

type StaffIssueRow = Prisma.OrderIssueGetPayload<{ select: typeof staffIssueSelect }>;

function toStaffIssueView(row: StaffIssueRow): StaffIssueView {
  return {
    ...toIssueView(row),
    orderNumber: row.order.orderNumber,
    orderType: row.order.orderType,
    customerName: row.order.customerName,
    customerPhone: row.order.customerPhone,
    orderTotalCents: row.order.totalCents,
    currency: row.order.currency,
    orderCreatedAt: row.order.createdAt.toISOString(),
  };
}

/** How much history the complaints screen carries. Complaints are rare by
 *  construction; a restaurant with more than this outstanding has a
 *  problem no list length will fix. */
const STAFF_ISSUE_LIMIT = 200;

/** Newest activity first — a thread the guest just added to belongs at
 *  the top, not where it was opened. */
export async function listStaffIssues(
  userId: string,
  opts: { includeResolved?: boolean } = {},
): Promise<StaffIssueSummary[]> {
  const where: Prisma.OrderIssueWhereInput = opts.includeResolved
    ? {}
    : { status: { not: "resolved" } };

  const rows = await asUser(userId, (tx) =>
    tx.orderIssue.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: STAFF_ISSUE_LIMIT,
      select: {
        id: true,
        orderId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        order: {
          select: {
            orderNumber: true,
            orderType: true,
            customerName: true,
            customerPhone: true,
          },
        },
        messages: {
          select: { author: true, body: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: { select: { messages: true } },
      },
    }),
  );

  return rows.map((row) => {
    const last = row.messages[0];
    return {
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.order.orderNumber,
      orderType: row.order.orderType,
      status: asIssueStatus(row.status),
      customerName: row.order.customerName,
      customerPhone: row.order.customerPhone,
      messageCount: row._count.messages,
      // A thread is always created WITH its first message, so the
      // fallback is unreachable — it exists so a hand-deleted message
      // renders an empty preview instead of crashing the screen.
      lastMessage: last
        ? {
            author: asIssueAuthor(last.author),
            body: last.body,
            createdAt: last.createdAt.toISOString(),
          }
        : { author: "guest", body: "", createdAt: row.createdAt.toISOString() },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/** What the rail badge and the app's burger menu count: threads the
 *  restaurant still owes something on. */
export async function countOpenIssues(userId: string): Promise<number> {
  return asUser(userId, (tx) => tx.orderIssue.count({ where: { status: { not: "resolved" } } }));
}

export async function getStaffIssue(
  userId: string,
  issueId: string,
): Promise<StaffIssueView | null> {
  const row = await asUser(userId, (tx) =>
    tx.orderIssue.findFirst({ where: { id: issueId }, select: staffIssueSelect }),
  );
  return row ? toStaffIssueView(row) : null;
}

export async function getStaffIssueByOrder(
  userId: string,
  orderId: string,
): Promise<StaffIssueView | null> {
  const row = await asUser(userId, (tx) =>
    tx.orderIssue.findFirst({ where: { orderId }, select: staffIssueSelect }),
  );
  return row ? toStaffIssueView(row) : null;
}

export async function replyToIssue(
  userId: string,
  issueId: string,
  bodyRaw: string,
): Promise<{ ok: true; issue: StaffIssueView } | { ok: false; error: "not_found" | "invalid" }> {
  const body = (bodyRaw ?? "").trim();
  if (body.length === 0 || body.length > ISSUE_BODY_MAX) return { ok: false, error: "invalid" };

  return asUser(userId, async (tx) => {
    const existing = await tx.orderIssue.findFirst({
      where: { id: issueId },
      select: { id: true, tenantId: true, status: true },
    });
    if (!existing) return { ok: false, error: "not_found" };

    await tx.orderIssueMessage.create({
      data: {
        tenantId: existing.tenantId,
        issueId,
        author: "restaurant",
        authorUserId: userId,
        body,
      },
    });
    // Answering an open thread moves it to `answered`. Adding a note to a
    // RESOLVED one leaves it resolved — reopening is the guest's move, and
    // closing is the restaurant's; neither happens by accident here. The
    // write still bumps `updatedAt`, so the note surfaces in the list.
    await tx.orderIssue.update({
      where: { id: issueId },
      data: { status: asIssueStatus(existing.status) === "resolved" ? "resolved" : "answered" },
    });
    const fresh = await tx.orderIssue.findFirstOrThrow({
      where: { id: issueId },
      select: staffIssueSelect,
    });
    return { ok: true, issue: toStaffIssueView(fresh) };
  });
}

/** Close the thread. Idempotent: resolving twice just re-stamps the row,
 *  which is the friendlier answer to a double tap on a slow connection. */
export async function resolveIssue(
  userId: string,
  issueId: string,
  now: Date = new Date(),
): Promise<{ ok: true; issue: StaffIssueView } | { ok: false; error: "not_found" }> {
  return asUser(userId, async (tx) => {
    const existing = await tx.orderIssue.findFirst({
      where: { id: issueId },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "not_found" };

    await tx.orderIssue.update({
      where: { id: issueId },
      data: { status: "resolved", resolvedAt: now },
    });
    const fresh = await tx.orderIssue.findFirstOrThrow({
      where: { id: issueId },
      select: staffIssueSelect,
    });
    return { ok: true, issue: toStaffIssueView(fresh) };
  });
}

/**
 * Photo bytes for the gated route. Returns the order the message belongs
 * to as well, so the caller can prove the receipt token in its hand is
 * for THAT order rather than for any order in the tenant.
 */
export async function readIssuePhoto(
  tenantId: string,
  messageId: string,
): Promise<{ bytes: Buffer; contentType: string; orderId: string } | null> {
  const row = await asTenant(tenantId, (tx) =>
    tx.orderIssueMessage.findFirst({
      where: { id: messageId },
      select: { photoKey: true, photoType: true, issue: { select: { orderId: true } } },
    }),
  );
  if (!row?.photoKey) return null;
  const bytes = await readUpload(row.photoKey);
  if (!bytes) return null;
  return {
    bytes,
    // `photo_type` is written from the normalizer's own verdict, so this
    // fallback only fires on a hand-edited row.
    contentType: row.photoType ?? "application/octet-stream",
    orderId: row.issue.orderId,
  };
}
