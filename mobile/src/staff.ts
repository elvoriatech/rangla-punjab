import { BASE_URL, rebaseUrl } from "./api";

/**
 * The restaurant side of the API — everything behind `X-Staff-Token`.
 *
 * Same posture as `api.ts`: nothing throws, every field is read
 * defensively (a server can grow a status, a payment provider or a whole
 * section of the order after this build shipped), and money stays in
 * integer cents.
 *
 * One value is special: `"unauthorized"`. Any staff route answering 401
 * means the restaurant's session is gone — the caller clears it and the
 * app falls back to the guest shell. That is why every call returns a
 * result rather than a value.
 */

export interface StaffOrderItem {
  name: string;
  quantity: number;
  priceCents: number;
}

/** Present on delivery orders only, and then with all four keys — each
 *  of which may still be empty. Nulls are normalised to "" so every
 *  consumer can just render the strings. */
export interface StaffAddress {
  street: string;
  zip: string;
  city: string;
  note: string;
}

export interface StaffOrder {
  id: string;
  orderNumber: number;
  status: string;
  /** The transitions the SERVER allows from here. The app never derives
   *  the lifecycle itself — it renders one button per entry. */
  allowedNext: string[];
  orderType: string;
  tableNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: StaffAddress | null;
  /** When the guest asked for it (pickup/delivery slot); null = ASAP. */
  requestedFor: string | null;
  createdAt: string;
  updatedAt: string;
  paymentStatus: string;
  paymentProvider: string | null;
  totalCents: number;
  discountCents: number;
  /** Points the reward cost the guest. 0 = no reward, or an order from
   *  before the server carried the number. */
  discountPoints: number;
  currency: string;
  items: StaffOrderItem[];
  /** The complaint thread on this order — "open" | "answered" |
   *  "resolved", or null when the guest never reported anything (and on
   *  a server that predates complaints). */
  issueStatus: string | null;
  /** That thread's id, so the board can open it without looking it up.
   *  Null alongside a non-null `issueStatus` means an older server: the
   *  caller falls back to matching the complaints list on `orderId`. */
  issueId: string | null;
}

export interface StaffSummary {
  openOrders: number;
  unpaidOnline: number;
  pendingReservations: number;
  /** Complaint threads not yet resolved. 0 on an older server, which
   *  keeps the badge off rather than inventing one. */
  openIssues: number;
}

/**
 * "conflict" is only ever an invalid status transition (409): someone
 * else moved the order on first. "invalid" is the edit routes' 400 — the
 * server names the offending `field`, which the sheet shows inline —
 * and "notfound" their 404 (an item that was deleted or republished
 * under a new id while the owner had the list open).
 */
export type StaffError =
  "unauthorized" | "conflict" | "invalid" | "notfound" | "network" | "server";

export type StaffResult<T> =
  | { ok: true; data: T }
  /** `field` is set only for "invalid", and only when the server named one. */
  | { ok: false; error: StaffError; field?: string };

/** Statuses that take an order OFF the open board. Anything unknown is
 *  treated as still open — a kitchen would rather see a stray card than
 *  lose one. */
const CLOSED = new Set(["done", "cancelled", "canceled", "refunded"]);

export function isClosedStatus(status: string): boolean {
  return CLOSED.has(status);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asAddress(raw: unknown): StaffAddress | null {
  // `null` is the server's own "not a delivery"; anything object-shaped
  // is an address, whatever its individual fields hold.
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  return { street: str(a.street), zip: str(a.zip), city: str(a.city), note: str(a.note) };
}

function asItem(raw: unknown): StaffOrderItem | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Record<string, unknown>;
  const name = str(i.name);
  if (!name) return null;
  return { name, quantity: num(i.quantity, 1), priceCents: num(i.priceCents) };
}

export function asStaffOrder(raw: unknown): StaffOrder | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    orderNumber: num(o.orderNumber),
    status: str(o.status, "placed"),
    allowedNext: Array.isArray(o.allowedNext)
      ? o.allowedNext.filter((x): x is string => typeof x === "string")
      : [],
    orderType: str(o.orderType, "takeaway"),
    // Table numbers are strings ("12", "Terrace 3") but a server that
    // types the column as an integer must not lose the table.
    tableNumber:
      typeof o.tableNumber === "number" ? String(o.tableNumber) : nullableStr(o.tableNumber),
    customerName: nullableStr(o.customerName),
    customerPhone: nullableStr(o.customerPhone),
    deliveryAddress: asAddress(o.deliveryAddress),
    requestedFor: nullableStr(o.requestedFor),
    createdAt: str(o.createdAt),
    updatedAt: str(o.updatedAt, str(o.createdAt)),
    paymentStatus: str(o.paymentStatus, "unpaid"),
    paymentProvider: nullableStr(o.paymentProvider),
    totalCents: num(o.totalCents),
    discountCents: num(o.discountCents),
    discountPoints: num(o.discountPoints),
    currency: str(o.currency, "EUR"),
    items: Array.isArray(o.items)
      ? o.items.map(asItem).filter((i): i is StaffOrderItem => i !== null)
      : [],
    issueStatus: nullableStr(o.issueStatus),
    issueId: nullableStr(o.issueId),
  };
}

async function staffFetch(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: Record<string, unknown> | null } | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "X-Staff-Token": token,
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/** Fails the same way every route does, so callers have one branch. */
function failure(status: number): StaffError {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid";
  if (status === 404) return "notfound";
  return "server";
}

/**
 * The board's orders. `since` asks the server for what changed — the
 * caller merges the answer into what it already has. Called without it,
 * the server sends the whole board (open + closed today), which is what a
 * cold start and a pull-to-refresh want.
 */
export async function fetchStaffOrders(
  token: string,
  since?: string | null,
): Promise<StaffResult<{ serverTime: string | null; orders: StaffOrder[] }>> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await staffFetch(token, `/api/v1/staff/orders${qs}`);
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  const raw = res.body.orders;
  return {
    ok: true,
    data: {
      serverTime: nullableStr(res.body.serverTime),
      orders: Array.isArray(raw)
        ? raw.map(asStaffOrder).filter((o): o is StaffOrder => o !== null)
        : [],
    },
  };
}

/**
 * Why a transition was refused, in the server's own vocabulary.
 *
 * `cancel_disabled` is the one the board has to tell apart: cancelling
 * from the app is a per-venue switch in the web dashboard, so a 409
 * there is a SETTING, not a stale board, and "someone got there first"
 * would be a lie. Everything else keeps the existing reading.
 */
export type StaffAdvanceReason = "cancel_disabled" | "invalid_transition";

export type StaffAdvanceResult =
  | { ok: true; data: StaffOrder | null }
  | { ok: false; error: StaffError; reason?: StaffAdvanceReason };

/**
 * Move an order on. `to` always comes from that order's own `allowedNext`
 * — 409 (`invalid_transition`) therefore means the board is stale, not
 * that the app got the lifecycle wrong. The exception is
 * `cancel_disabled`, which the caller reports as the setting it is.
 */
export async function advanceStaffOrder(
  token: string,
  orderId: string,
  to: string,
): Promise<StaffAdvanceResult> {
  const res = await staffFetch(
    token,
    `/api/v1/staff/orders/${encodeURIComponent(orderId)}/status`,
    {
      method: "POST",
      body: { to },
    },
  );
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) {
    const error = failure(res.status);
    const reason = res.body?.error;
    return reason === "cancel_disabled" || reason === "invalid_transition"
      ? { ok: false, error, reason }
      : { ok: false, error };
  }
  // A server that answers 200 without echoing the order is fine: the next
  // poll carries the truth.
  return { ok: true, data: asStaffOrder(res.body.order) };
}

export async function fetchStaffSummary(token: string): Promise<StaffResult<StaffSummary>> {
  const res = await staffFetch(token, "/api/v1/staff/summary");
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  return {
    ok: true,
    data: {
      openOrders: num(res.body.openOrders),
      unpaidOnline: num(res.body.unpaidOnline),
      pendingReservations: num(res.body.pendingReservations),
      openIssues: num(res.body.openIssues),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Complaints (P7-10) — the restaurant's side of a guest's problem
 * thread. Same posture as everything above: never throws, every field
 * read defensively, 401 means the session is gone.
 * ------------------------------------------------------------------ */

export interface StaffIssueMessage {
  id: string;
  author: "guest" | "restaurant";
  body: string;
  /** Absolute; the app must send `X-Staff-Token` as an image header to
   *  fetch it. Null when the message carries no photo. */
  photoUrl: string | null;
  createdAt: string;
}

/** One row of the complaints list. */
export interface StaffIssueSummary {
  id: string;
  orderId: string;
  orderNumber: number;
  orderType: string;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  messageCount: number;
  lastMessage: { author: "guest" | "restaurant"; body: string; createdAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** One thread in full, with enough of the order to make sense of it. */
export interface StaffIssue {
  id: string;
  orderId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  messages: StaffIssueMessage[];
  orderNumber: number;
  orderType: string;
  customerName: string | null;
  customerPhone: string | null;
  orderTotalCents: number;
  currency: string;
  orderCreatedAt: string;
}

/** Unresolved is anything the restaurant still owes an answer or a
 *  verdict on — the badge and the default list both key on this. */
export function isOpenIssue(status: string | null | undefined): boolean {
  return status === "open" || status === "answered";
}

function asAuthor(value: unknown): "guest" | "restaurant" {
  // Never attribute an unknown author to the guest: misquoting the
  // customer is the worse of the two mistakes.
  return value === "guest" ? "guest" : "restaurant";
}

function asIssueMessage(raw: unknown): StaffIssueMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id);
  if (!id) return null;
  return {
    id,
    author: asAuthor(m.author),
    body: str(m.body),
    photoUrl: rebaseUrl(nullableStr(m.photoUrl)),
    createdAt: str(m.createdAt),
  };
}

function asIssueSummary(raw: unknown): StaffIssueSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Record<string, unknown>;
  const id = str(i.id);
  if (!id) return null;
  const last = (
    i.lastMessage && typeof i.lastMessage === "object" ? i.lastMessage : null
  ) as Record<string, unknown> | null;
  return {
    id,
    orderId: str(i.orderId),
    orderNumber: num(i.orderNumber),
    orderType: str(i.orderType, "takeaway"),
    status: str(i.status, "open"),
    customerName: nullableStr(i.customerName),
    customerPhone: nullableStr(i.customerPhone),
    messageCount: num(i.messageCount),
    lastMessage: last
      ? {
          author: asAuthor(last.author),
          body: str(last.body),
          createdAt: str(last.createdAt),
        }
      : null,
    createdAt: str(i.createdAt),
    updatedAt: str(i.updatedAt, str(i.createdAt)),
  };
}

export function asStaffIssue(raw: unknown): StaffIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Record<string, unknown>;
  const id = str(i.id);
  if (!id) return null;
  return {
    id,
    orderId: str(i.orderId),
    status: str(i.status, "open"),
    createdAt: str(i.createdAt),
    updatedAt: str(i.updatedAt, str(i.createdAt)),
    resolvedAt: nullableStr(i.resolvedAt),
    messages: Array.isArray(i.messages)
      ? i.messages.map(asIssueMessage).filter((m): m is StaffIssueMessage => m !== null)
      : [],
    orderNumber: num(i.orderNumber),
    orderType: str(i.orderType, "takeaway"),
    customerName: nullableStr(i.customerName),
    customerPhone: nullableStr(i.customerPhone),
    orderTotalCents: num(i.orderTotalCents),
    currency: str(i.currency, "EUR"),
    orderCreatedAt: str(i.orderCreatedAt),
  };
}

/** Newest activity first, as the server orders them. `all` also brings
 *  back the resolved threads; without it the list is the work queue. */
export async function fetchStaffIssues(
  token: string,
  all = false,
): Promise<StaffResult<StaffIssueSummary[]>> {
  const res = await staffFetch(token, `/api/v1/staff/issues${all ? "?all=1" : ""}`);
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  const raw = res.body.issues;
  return {
    ok: true,
    data: Array.isArray(raw)
      ? raw.map(asIssueSummary).filter((i): i is StaffIssueSummary => i !== null)
      : [],
  };
}

export async function fetchStaffIssue(
  token: string,
  issueId: string,
): Promise<StaffResult<StaffIssue>> {
  const res = await staffFetch(token, `/api/v1/staff/issues/${encodeURIComponent(issueId)}`);
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  const issue = asStaffIssue(res.body.issue);
  // A 200 without a thread in it is a server we can't render — treat it
  // as the 404 it behaves like rather than showing an empty panel.
  if (!issue) return { ok: false, error: "notfound" };
  return { ok: true, data: issue };
}

/** Answering moves the thread to "answered"; on a resolved thread the
 *  server keeps the status and just appends. */
export async function replyStaffIssue(
  token: string,
  issueId: string,
  body: string,
): Promise<StaffResult<StaffIssue>> {
  const res = await staffFetch(
    token,
    `/api/v1/staff/issues/${encodeURIComponent(issueId)}/messages`,
    { method: "POST", body: { body } },
  );
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 && res.status !== 201) return { ok: false, error: failure(res.status) };
  const issue = asStaffIssue(res.body?.issue);
  if (!issue) return { ok: false, error: "server" };
  return { ok: true, data: issue };
}

export async function resolveStaffIssue(
  token: string,
  issueId: string,
): Promise<StaffResult<StaffIssue>> {
  const res = await staffFetch(
    token,
    `/api/v1/staff/issues/${encodeURIComponent(issueId)}/resolve`,
    { method: "POST", body: {} },
  );
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200) return { ok: false, error: failure(res.status) };
  const issue = asStaffIssue(res.body?.issue);
  if (!issue) return { ok: false, error: "server" };
  return { ok: true, data: issue };
}

/** Best effort: the local session is cleared whatever the server says. */
export async function staffLogout(token: string): Promise<void> {
  await staffFetch(token, "/api/v1/staff/logout", { method: "POST" });
}

/* ------------------------------------------------------------------ *
 * Push devices (P7-11) — which phones this restaurant's notifications
 * go to. The token is an Expo push token (`ExponentPushToken[…]`); the
 * server fans out through the Expo Push API, so nothing here knows about
 * APNs or FCM. `src/push.ts` owns the permission + token half.
 * ------------------------------------------------------------------ */

/** Upsert on the token: the same phone re-registering on every app start
 *  is the normal case, not a duplicate. */
export async function registerStaffDevice(
  token: string,
  device: { token: string; platform: "ios" | "android" | "web"; appVersion?: string },
): Promise<StaffResult<null>> {
  const res = await staffFetch(token, "/api/v1/staff/devices", {
    method: "POST",
    body: {
      token: device.token,
      platform: device.platform,
      ...(device.appVersion ? { appVersion: device.appVersion } : {}),
    },
  });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 && res.status !== 201) return { ok: false, error: failure(res.status) };
  return { ok: true, data: null };
}

/** Stop pushing to this device. Best effort, like `staffLogout` — the
 *  session is going away whatever the server answers. */
export async function unregisterStaffDevice(
  token: string,
  pushToken: string,
): Promise<StaffResult<null>> {
  const res = await staffFetch(token, "/api/v1/staff/devices", {
    method: "DELETE",
    body: { token: pushToken },
  });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 && res.status !== 204) return { ok: false, error: failure(res.status) };
  return { ok: true, data: null };
}

/* ------------------------------------------------------------------ *
 * The owner's menu, service switches and loyalty overview.
 *
 * Everything below edits the LIVE menu: a successful PATCH is already
 * what the guest app is served, so every caller refetches the guest menu
 * straight afterwards rather than waiting for the next natural reload.
 * ------------------------------------------------------------------ */

/**
 * A recurring venue-local window an offer is limited to.
 *
 * `days` are Monday-first indexes (0 = Monday … 6 = Sunday) — the
 * server's own convention (`prisma/schema.prisma` → `offer_weekly`,
 * parsed by `src/lib/offer-pricing.ts`), NOT `Date#getDay`. A shape the
 * server can't parse makes the offer INACTIVE rather than always-on, so
 * the app only ever sends all three keys together.
 */
export interface StaffOfferWeekly {
  days: number[];
  /** "HH:MM", venue-local. */
  start: string;
  end: string;
}

export interface StaffOffer {
  /** The reduced price, always lower than the item's own `priceCents`. */
  priceCents: number;
  startsAt: string | null;
  endsAt: string | null;
  weekly: StaffOfferWeekly | null;
}

export interface StaffItem {
  id: string;
  name: string;
  description: string | null;
  /** The regular price. An offer reduces FROM this. */
  priceCents: number;
  currency: string;
  isAvailable: boolean;
  photoUrl: string | null;
  offer: StaffOffer | null;
  /** The server's verdict on the window right now — the app never
   *  recomputes it from the dates (the venue's clock is not this one). */
  offerActive: boolean;
  /** The published copy this editor row feeds, when the server says. */
  sourceItemId: string | null;
}

export interface StaffMenuCategory {
  id: string;
  name: string;
  items: StaffItem[];
}

/** Only the fields the owner actually changed travel — an absent key
 *  means "leave it alone", and `offer: null` means "take it off". */
export interface StaffItemPatch {
  isAvailable?: boolean;
  priceCents?: number;
  /** 1–120 characters, trimmed by the server. A dish with no name is
   *  not a dish, so there is no "clear the name". */
  name?: string;
  /** Up to 2000 characters. `null` (or "") clears it — the one text
   *  field on a dish a venue may legitimately want empty. */
  description?: string | null;
  offer?: {
    priceCents: number;
    startsAt?: string | null;
    endsAt?: string | null;
    weekly?: StaffOfferWeekly | null;
  } | null;
}

/** Which ways of ordering the venue is taking right now. */
export interface StaffOrdering {
  dineIn: boolean;
  takeaway: boolean;
  delivery: boolean;
}

export interface StaffLoyaltyConfig {
  minOrderCents: number;
  pointsPerOrder: number;
  rewardPoints: number;
  rewardValueCents: number;
  voucherExpiryMonths: number;
}

export interface StaffLoyaltyTotals {
  members: number;
  pointsOutstanding: number;
  vouchersAvailable: number;
  vouchersRedeemed30d: number;
}

export interface StaffLoyaltyMember {
  customerId: string;
  name: string | null;
  email: string | null;
  balance: number;
  vouchersAvailable: number;
  lastOrderAt: string | null;
}

export interface StaffLoyalty {
  enabled: boolean;
  config: StaffLoyaltyConfig;
  totals: StaffLoyaltyTotals;
  members: StaffLoyaltyMember[];
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asWeekly(raw: unknown): StaffOfferWeekly | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const days = Array.isArray(w.days)
    ? w.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
    : [];
  const start = str(w.start);
  const end = str(w.end);
  // Anything less than the full shape is unusable — and guessing the
  // missing half would silently change when the offer runs.
  if (days.length === 0 || !start || !end) return null;
  return { days, start, end };
}

function asOffer(raw: unknown): StaffOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const priceCents = num(o.priceCents, -1);
  if (priceCents < 0) return null;
  return {
    priceCents,
    startsAt: nullableStr(o.startsAt),
    endsAt: nullableStr(o.endsAt),
    weekly: asWeekly(o.weekly),
  };
}

export function asStaffItem(raw: unknown): StaffItem | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Record<string, unknown>;
  const id = str(i.id);
  if (!id) return null;
  const offer = asOffer(i.offer);
  return {
    id,
    name: str(i.name),
    description: nullableStr(i.description),
    priceCents: num(i.priceCents),
    currency: str(i.currency, "EUR"),
    // A server that predates the flag is assumed to be selling the dish.
    isAvailable: bool(i.isAvailable, true),
    photoUrl: rebaseUrl(nullableStr(i.photoUrl)),
    offer,
    // Without the server's own verdict, an offer that exists at all is
    // the safest reading: the badge is cosmetic, the price is not.
    offerActive: typeof i.offerActive === "boolean" ? i.offerActive : offer !== null,
    sourceItemId: nullableStr(i.sourceItemId),
  };
}

function asStaffCategory(raw: unknown): StaffMenuCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = str(c.id);
  if (!id) return null;
  return {
    id,
    name: str(c.name),
    items: Array.isArray(c.items)
      ? c.items.map(asStaffItem).filter((i): i is StaffItem => i !== null)
      : [],
  };
}

/** The owner's editable menu — the working copy, offers and all. */
export async function fetchStaffMenu(token: string): Promise<StaffResult<StaffMenuCategory[]>> {
  const res = await staffFetch(token, "/api/v1/staff/menu");
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  const raw = res.body.categories;
  return {
    ok: true,
    data: Array.isArray(raw)
      ? raw.map(asStaffCategory).filter((c): c is StaffMenuCategory => c !== null)
      : [],
  };
}

/**
 * Change one dish. LIVE: a 200 here means the guest menu already says so,
 * which is why every caller refetches it afterwards.
 *
 * A 400 carries the field the server rejected (`price`, `offer`, …) so
 * the sheet can point at it instead of showing a general failure.
 */
export async function updateStaffItem(
  token: string,
  itemId: string,
  patch: StaffItemPatch,
): Promise<StaffResult<StaffItem | null>> {
  const res = await staffFetch(token, `/api/v1/staff/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: patch,
  });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) {
    const error = failure(res.status);
    const field = res.body ? nullableStr(res.body.field) : null;
    return field ? { ok: false, error, field } : { ok: false, error };
  }
  // A server that answers 200 without echoing the item is fine: the
  // caller's refetch carries the truth.
  return { ok: true, data: asStaffItem(res.body.item) };
}

/**
 * A dish photo lives on its own two routes rather than in the item
 * patch: it is a file, not a field, so it travels as multipart and is
 * saved the moment it is picked (there is nothing sensible to "cancel"
 * once the bytes are on the server).
 *
 * `POST .../photo` replaces whatever the dish had; `DELETE .../photo`
 * takes it off. Both answer with the whole item, so the caller can drop
 * the new `photoUrl` straight into the list.
 */
export type StaffPhotoError =
  | "unauthorized"
  /** 400 — not an image, or not one of JPEG/PNG/WebP. */
  | "invalid_photo"
  /** 413 — over the server's 10 MB cap (or a proxy's own). */
  | "too_large"
  | "notfound"
  | "network"
  | "server";

export type StaffPhotoResult =
  /** Null when the server answered 200 without echoing the item — the
   *  caller's refetch carries the truth, exactly as for a patch. */
  { ok: true; data: StaffItem | null } | { ok: false; error: StaffPhotoError };

/** `MAX_ITEM_PHOTO_BYTES` on the server. Checked here too so an
 *  over-size photo is refused before it is uploaded. */
export const MAX_ITEM_PHOTO_BYTES = 10 * 1024 * 1024;

/** The server's own code when it sent one, the status when it didn't. */
function photoFailure(status: number, body: Record<string, unknown> | null): StaffPhotoError {
  const named = body ? str(body.error) : "";
  if (named === "invalid_photo" || named === "too_large") return named;
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 413) return "too_large";
  if (status === 404) return "notfound";
  if (status === 400 || status === 422) return "invalid_photo";
  return "server";
}

/**
 * Put a photo on one dish. LIVE, like every other edit here: a 200 means
 * the guest menu already shows it.
 *
 * The caller is expected to have shrunk the image first (see
 * `shrinkPhoto` in `photo.ts`) — this sends whatever it is given.
 */
export async function uploadStaffItemPhoto(
  token: string,
  itemId: string,
  file: { uri: string; name: string; type: string },
): Promise<StaffPhotoResult> {
  try {
    const form = new FormData();
    // The RN file descriptor: not a browser File, which is why this cast
    // exists at all (same shape `postIssueMessage` sends).
    form.append("photo", file as unknown as Blob);
    const res = await fetch(`${BASE_URL}/api/v1/staff/items/${encodeURIComponent(itemId)}/photo`, {
      method: "POST",
      // No Content-Type: `fetch` has to set the multipart boundary.
      headers: { "X-Staff-Token": token },
      body: form,
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    // Defensive like every other route here: a 200 is the verdict, and
    // an `ok` the server didn't send is not a failure it reported.
    if (res.status !== 200 || !body || body.ok === false) {
      return { ok: false, error: photoFailure(res.status, body) };
    }
    return { ok: true, data: asStaffItem(body.item) };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Take the photo off a dish. The row falls back to the empty tile. */
export async function removeStaffItemPhoto(
  token: string,
  itemId: string,
): Promise<StaffPhotoResult> {
  const res = await staffFetch(token, `/api/v1/staff/items/${encodeURIComponent(itemId)}/photo`, {
    method: "DELETE",
  });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body || res.body.ok === false) {
    return { ok: false, error: photoFailure(res.status, res.body) };
  }
  return { ok: true, data: asStaffItem(res.body.item) };
}

function asOrdering(raw: unknown): StaffOrdering {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // Absent means "on": the switches are how a venue turns a service OFF,
  // and an older server that doesn't answer has turned nothing off.
  return {
    dineIn: bool(o.dineIn, true),
    takeaway: bool(o.takeaway, true),
    delivery: bool(o.delivery, true),
  };
}

export async function fetchStaffOrdering(token: string): Promise<StaffResult<StaffOrdering>> {
  const res = await staffFetch(token, "/api/v1/staff/ordering");
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  return { ok: true, data: asOrdering(res.body.ordering) };
}

/** Dine-in is not the app's to change — it is the QR menu on the table. */
export async function updateStaffOrdering(
  token: string,
  patch: { takeaway?: boolean; delivery?: boolean },
): Promise<StaffResult<StaffOrdering>> {
  const res = await staffFetch(token, "/api/v1/staff/ordering", { method: "PATCH", body: patch });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  return { ok: true, data: asOrdering(res.body.ordering) };
}

function asMember(raw: unknown): StaffLoyaltyMember | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const customerId = str(m.customerId);
  const name = nullableStr(m.name);
  const email = nullableStr(m.email);
  // A row with nothing to call the guest by is a row nobody can read.
  if (!customerId && !name && !email) return null;
  return {
    customerId: customerId || (email ?? name ?? ""),
    name,
    email,
    balance: num(m.balance),
    vouchersAvailable: num(m.vouchersAvailable),
    lastOrderAt: nullableStr(m.lastOrderAt),
  };
}

/**
 * One loyalty payload, however the server chose to nest it.
 *
 * `enabled` is read from BOTH places on purpose: the overview has always
 * sent it at the top level, and the config object grew its own copy when
 * the switch became editable (P7 owner half). Top level wins when both
 * are present; the config's copy is the fallback, so neither shape can
 * leave the switch stuck off.
 */
function asStaffLoyalty(body: Record<string, unknown>): StaffLoyalty {
  const config = (body.config && typeof body.config === "object" ? body.config : {}) as Record<
    string,
    unknown
  >;
  const totals = (body.totals && typeof body.totals === "object" ? body.totals : {}) as Record<
    string,
    unknown
  >;
  return {
    enabled: bool(body.enabled, bool(config.enabled)),
    config: {
      minOrderCents: num(config.minOrderCents),
      pointsPerOrder: num(config.pointsPerOrder),
      rewardPoints: num(config.rewardPoints),
      rewardValueCents: num(config.rewardValueCents),
      voucherExpiryMonths: num(config.voucherExpiryMonths),
    },
    totals: {
      members: num(totals.members),
      pointsOutstanding: num(totals.pointsOutstanding),
      vouchersAvailable: num(totals.vouchersAvailable),
      vouchersRedeemed30d: num(totals.vouchersRedeemed30d),
    },
    members: Array.isArray(body.members)
      ? body.members.map(asMember).filter((m): m is StaffLoyaltyMember => m !== null)
      : [],
  };
}

/** The guests' side of the programme, as the restaurant sees it. */
export async function fetchStaffLoyalty(token: string): Promise<StaffResult<StaffLoyalty>> {
  const res = await staffFetch(token, "/api/v1/staff/loyalty");
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  return { ok: true, data: asStaffLoyalty(res.body) };
}

/* ------------------------------------------------------------------ *
 * The Google rating (P7-14, owner half).
 *
 * Two numbers and a switch: what guests see under the restaurant's name,
 * where it came from, and whether it is shown at all. The server keeps
 * two sources — the value FETCHED from Google (needs a Places API key
 * this deployment may not have) and the one the owner TYPED — and
 * decides between them; `effective` is that verdict, and the app never
 * re-derives it.
 * ------------------------------------------------------------------ */

/** A rating with its provenance. `source` is the server's own word for
 *  which of the two won. */
export interface StaffRatingValue {
  value: number;
  count: number;
}

export interface StaffRatingFetched extends StaffRatingValue {
  /** When we last asked Google. */
  fetchedAt: string | null;
}

export interface StaffRatingManual extends StaffRatingValue {
  /** When a human last typed it. */
  updatedAt: string | null;
}

export interface StaffRatingEffective extends StaffRatingValue {
  source: "fetched" | "manual";
}

export interface StaffRating {
  /** The owner's switch: off means no star line anywhere, whatever the
   *  numbers say. Absent on an older server = on, matching the column
   *  default. */
  enabled: boolean;
  placeId: string | null;
  fetched: StaffRatingFetched | null;
  manual: StaffRatingManual | null;
  /** What a guest sees right now — null when nothing is shown. */
  effective: StaffRatingEffective | null;
  /** Google's "write a review" form, or a Maps search for the venue.
   *  Always an http(s) URL when present. */
  reviewUrl: string | null;
  /** Whether the SERVER can talk to Google at all (it has a Places API
   *  key). False turns the fetch half into a hint. */
  canFetch: boolean;
}

/** One candidate from the Place ID search. */
export interface StaffPlace {
  id: string;
  name: string;
  address: string;
}

/**
 * What went wrong on a lookup, in the server's own vocabulary. Each maps
 * to one plain-language sentence in the catalogue — the same sentences
 * the dashboard's Google card shows.
 */
export type StaffRatingLookupError =
  | "no_api_key"
  | "no_place_id"
  | "api_not_enabled"
  | "key_invalid"
  | "quota"
  | "not_found"
  | "network"
  | "unknown";

const LOOKUP_ERRORS: readonly string[] = [
  "no_api_key",
  "no_place_id",
  "api_not_enabled",
  "key_invalid",
  "quota",
  "not_found",
  "network",
  "unknown",
];

function isLookupError(value: unknown): value is StaffRatingLookupError {
  return typeof value === "string" && LOOKUP_ERRORS.includes(value);
}

/**
 * The lookup routes fail in TWO vocabularies at once: the staff-wide one
 * (`unauthorized` when the session is gone) and Google's (`quota`, …).
 * Callers must keep handling the first — hence a result whose failure
 * carries both, with `reason` set only when the server named one.
 */
export type StaffRatingResult<T> =
  { ok: true; data: T } | { ok: false; error: StaffError; reason?: StaffRatingLookupError };

function asRatingValue(raw: unknown): StaffRatingValue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const value = num(r.value, -1);
  // A rating outside Google's own scale is a rating we can't render —
  // and putting a wrong number under the restaurant's name is worse than
  // showing none. Same strictness as the guest side's `asRating`.
  if (!(value >= 1 && value <= 5)) return null;
  const count = num(r.count, -1);
  if (count < 0) return null;
  return { value, count: Math.trunc(count) };
}

function httpUrl(value: unknown): string | null {
  const url = typeof value === "string" ? value.trim() : "";
  return /^https?:\/\//i.test(url) ? url : null;
}

function asPlace(raw: unknown): StaffPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = str(p.id);
  if (!id) return null;
  return { id, name: str(p.name), address: str(p.address) };
}

export function asStaffRating(raw: unknown): StaffRating {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fetchedValue = asRatingValue(r.fetched);
  const manualValue = asRatingValue(r.manual);
  const effectiveValue = asRatingValue(r.effective);
  const effectiveSource = str((r.effective as Record<string, unknown> | undefined)?.source);
  return {
    // Absent = on: the column defaults to true, and an older server that
    // doesn't know the flag has hidden nothing.
    enabled: bool(r.enabled, true),
    placeId: nullableStr(r.placeId),
    fetched: fetchedValue
      ? {
          ...fetchedValue,
          fetchedAt: nullableStr((r.fetched as Record<string, unknown>).fetchedAt),
        }
      : null,
    manual: manualValue
      ? {
          ...manualValue,
          updatedAt: nullableStr((r.manual as Record<string, unknown>).updatedAt),
        }
      : null,
    effective: effectiveValue
      ? {
          ...effectiveValue,
          // Unknown provenance is read as "typed": claiming Google said
          // something it may not have is the worse mistake.
          source: effectiveSource === "fetched" ? "fetched" : "manual",
        }
      : null,
    // Only an http(s) link is usable — this string goes straight to the
    // system browser, and the server is not the place to be handed an
    // app scheme from (same test as the guest side's `asRating`).
    reviewUrl: httpUrl(r.reviewUrl),
    canFetch: bool(r.canFetch),
  };
}

/** Failure shared by all four routes: the staff vocabulary, plus
 *  Google's `error` string when the body carries one. */
function ratingFailure(
  status: number,
  body: Record<string, unknown> | null,
): { ok: false; error: StaffError; reason?: StaffRatingLookupError } {
  const error = failure(status);
  const reason = body ? body.error : null;
  return isLookupError(reason) ? { ok: false, error, reason } : { ok: false, error };
}

export async function fetchStaffRating(token: string): Promise<StaffResult<StaffRating>> {
  const res = await staffFetch(token, "/api/v1/staff/rating");
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  return { ok: true, data: asStaffRating(res.body.rating) };
}

/**
 * Change one part of the rating. Only the keys present travel: an absent
 * `manual` leaves the typed numbers alone, while `manual: null` clears
 * them — the same "absent vs. null" contract as `StaffItemPatch`.
 *
 * A 400 names the offending field (`value`, `count`, `placeId`), which
 * the screen puts next to that input rather than at the top.
 */
export async function updateStaffRating(
  token: string,
  patch: {
    enabled?: boolean;
    manual?: { value: number; count: number } | null;
    placeId?: string | null;
  },
): Promise<StaffResult<StaffRating>> {
  const res = await staffFetch(token, "/api/v1/staff/rating", { method: "PATCH", body: patch });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) {
    const error = failure(res.status);
    const field = res.body ? nullableStr(res.body.field) : null;
    return field ? { ok: false, error, field } : { ok: false, error };
  }
  return { ok: true, data: asStaffRating(res.body.rating) };
}

/** Ask Google right now, instead of waiting for the once-a-day refresh —
 *  how the owner checks that a Place ID they just saved is theirs. */
export async function refreshStaffRating(token: string): Promise<StaffRatingResult<StaffRating>> {
  const res = await staffFetch(token, "/api/v1/staff/rating/refresh", { method: "POST", body: {} });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return ratingFailure(res.status, res.body);
  return { ok: true, data: asStaffRating(res.body.rating) };
}

/** Find the venue on Google by name — the whole Place ID setup without
 *  leaving the app. An empty list is a valid answer, not an error. */
export async function searchStaffRatingPlaces(
  token: string,
  query: string,
): Promise<StaffRatingResult<StaffPlace[]>> {
  const res = await staffFetch(token, "/api/v1/staff/rating/search", {
    method: "POST",
    body: { query },
  });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return ratingFailure(res.status, res.body);
  const raw = res.body.places;
  return {
    ok: true,
    data: Array.isArray(raw) ? raw.map(asPlace).filter((p): p is StaffPlace => p !== null) : [],
  };
}

/* ------------------------------------------------------------------ *
 * Contact details — the phone book a guest sees on their Account screen.
 *
 * Three raw numbers, and the SERVER normalises them: "0 7531 123456"
 * comes back as "+49…", an empty string clears the row. The app sends
 * what the owner typed and re-reads whatever the server made of it —
 * exactly like the rating's manual numbers, and for the same reason
 * (a phone-number grammar belongs in one place, not in two clients).
 * ------------------------------------------------------------------ */

/** Which of the three a message is about. */
export type StaffContactField = "landline" | "mobile" | "whatsapp";

export const CONTACT_FIELDS: readonly StaffContactField[] = ["landline", "mobile", "whatsapp"];

/** Each number in the server's own storage form (E.164), or null when
 *  the owner has not filled that row in. */
export interface StaffContact {
  landline: string | null;
  mobile: string | null;
  whatsapp: string | null;
}

export function isStaffContactField(value: unknown): value is StaffContactField {
  return typeof value === "string" && (CONTACT_FIELDS as readonly string[]).includes(value);
}

export function asStaffContact(raw: unknown): StaffContact {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    landline: nullableStr(c.landline),
    mobile: nullableStr(c.mobile),
    whatsapp: nullableStr(c.whatsapp),
  };
}

export async function fetchStaffContact(token: string): Promise<StaffResult<StaffContact>> {
  const res = await staffFetch(token, "/api/v1/staff/contact");
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  return { ok: true, data: asStaffContact(res.body.contact) };
}

/**
 * Save the numbers. PARTIAL: only the keys present travel, so a screen
 * that only touched the mobile leaves the other two alone, and an empty
 * string is the server's own "clear this one".
 *
 * A 400 names the offending row in `field` ("landline"), which the
 * screen puts under that input rather than at the top.
 */
export async function updateStaffContact(
  token: string,
  patch: Partial<Record<StaffContactField, string>>,
): Promise<StaffResult<StaffContact>> {
  const res = await staffFetch(token, "/api/v1/staff/contact", { method: "PATCH", body: patch });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) {
    const error = failure(res.status);
    const field = res.body ? nullableStr(res.body.field) : null;
    return field ? { ok: false, error, field } : { ok: false, error };
  }
  return { ok: true, data: asStaffContact(res.body.contact) };
}

/* ------------------------------------------------------------------ *
 * Opening hours — the week the venue is actually open.
 *
 * The server owns the clock: `timezone` is the VENUE's zone (not this
 * device's, which may be a phone roaming abroad) and `openNow` is the
 * server's own verdict against it. The app renders both and re-derives
 * neither — a tablet with a wrong system time must not be able to tell
 * a guest the kitchen is shut.
 *
 * Day keys are the server's: Monday-first, three letters, lower case.
 * ------------------------------------------------------------------ */

/** One open window. Both ends are "HH:MM", venue-local, 24-hour. */
export interface StaffHoursSlot {
  open: string;
  close: string;
}

export interface StaffDayHours {
  closed: boolean;
  /** Empty on a closed day. Normally one window, two on a venue that
   *  shuts between lunch and dinner. */
  slots: StaffHoursSlot[];
}

export const HOURS_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type StaffHoursDay = (typeof HOURS_DAYS)[number];
export type StaffHoursWeek = Record<StaffHoursDay, StaffDayHours>;

export interface StaffHours {
  /** IANA zone, e.g. "Europe/Berlin". Shown, never used to compute. */
  timezone: string;
  hours: StaffHoursWeek;
  /** The server's verdict right now. Null on a server that doesn't say,
   *  which hides the pill rather than guessing at it. */
  openNow: boolean | null;
}

/** "9:5" → "09:05"; anything that isn't a time of day → null. */
function asTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function asSlot(raw: unknown): StaffHoursSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const open = asTime(s.open);
  const close = asTime(s.close);
  // Half a window is not a window: rendering "09:00 – " invites the
  // owner to save a shape the server will reject anyway.
  if (!open || !close) return null;
  return { open, close };
}

function asDayHours(raw: unknown): StaffDayHours {
  if (!raw || typeof raw !== "object") return { closed: true, slots: [] };
  const d = raw as Record<string, unknown>;
  const slots = Array.isArray(d.slots)
    ? d.slots.map(asSlot).filter((s): s is StaffHoursSlot => s !== null)
    : [];
  // A day with no readable window IS closed, whatever the flag says —
  // and a day the server calls open with windows keeps them.
  const closed = bool(d.closed, slots.length === 0) || slots.length === 0;
  return { closed, slots: closed ? [] : slots };
}

export function asStaffHoursWeek(raw: unknown): StaffHoursWeek {
  const h = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // Always all seven, always in order: the editor renders a full week,
  // so a server that omits Sunday must not drop a row off the screen.
  return Object.fromEntries(HOURS_DAYS.map((day) => [day, asDayHours(h[day])])) as StaffHoursWeek;
}

function asStaffHours(body: Record<string, unknown>): StaffHours {
  return {
    timezone: str(body.timezone),
    hours: asStaffHoursWeek(body.hours),
    openNow: typeof body.openNow === "boolean" ? body.openNow : null,
  };
}

export async function fetchStaffHours(token: string): Promise<StaffResult<StaffHours>> {
  const res = await staffFetch(token, "/api/v1/staff/hours");
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  return { ok: true, data: asStaffHours(res.body) };
}

/**
 * Save the whole week at once — hours are read as a table, and a
 * per-day PATCH would let the owner leave half a change behind.
 *
 * A 400 names the offending DAY in `field` ("tue"), which the editor
 * highlights on that row instead of showing a general failure.
 */
export async function updateStaffHours(
  token: string,
  hours: StaffHoursWeek,
): Promise<StaffResult<StaffHours>> {
  const res = await staffFetch(token, "/api/v1/staff/hours", { method: "PATCH", body: { hours } });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) {
    const error = failure(res.status);
    const field = res.body ? nullableStr(res.body.field) : null;
    return field ? { ok: false, error, field } : { ok: false, error };
  }
  return { ok: true, data: asStaffHours(res.body) };
}

/**
 * The programme's rules, as the owner may change them from the counter.
 *
 * FLAT, and only the keys present travel — the same "absent means leave
 * it alone" contract as `StaffItemPatch` — so the switch can be saved on
 * its own without the settings form having to round-trip five numbers it
 * was not asked about.
 *
 * Every number is a non-negative INTEGER in the server's own unit: money
 * in cents, points as points, expiry in whole months. The euro inputs
 * the screen shows are converted before they get here, and the server
 * takes integers only — no floats, no numeric strings.
 */
export type StaffLoyaltyPatch = Partial<StaffLoyaltyConfig> & { enabled?: boolean };

/**
 * The server's own limits (`src/lib/loyalty-config.ts`), mirrored so a
 * typo is caught next to the input that made it rather than as a 400
 * the owner has to decode. Kept in one place because the screen and any
 * future caller must refuse exactly the same numbers the server does.
 */
export const LOYALTY_LIMITS: Record<keyof StaffLoyaltyConfig, number> = {
  minOrderCents: 1_000_000,
  pointsPerOrder: 10_000,
  rewardPoints: 1_000_000,
  rewardValueCents: 1_000_000,
  voucherExpiryMonths: 60,
};

/**
 * Change the programme. The switch is the one a venue reaches for
 * mid-service (stop giving points now, sort the numbers out later), so
 * it is saved on its own; the numbers are a pricing decision and travel
 * together from the settings form.
 *
 * A 400 names the offending key in `field` ("rewardPoints"), which the
 * screen puts under that input.
 */
export async function updateStaffLoyalty(
  token: string,
  patch: StaffLoyaltyPatch,
): Promise<StaffResult<StaffLoyalty>> {
  const res = await staffFetch(token, "/api/v1/staff/loyalty", { method: "PATCH", body: patch });
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) {
    const error = failure(res.status);
    const field = res.body ? nullableStr(res.body.field) : null;
    return field ? { ok: false, error, field } : { ok: false, error };
  }
  return { ok: true, data: asStaffLoyalty(res.body) };
}

/* ------------------------------------------------------------------ *
 * Kitchen tickets.
 *
 * The ONE staff route that does not answer JSON: the server renders a
 * self-contained HTML document (inline CSS, no external assets) and the
 * app hands it straight to the platform's print stack. Nothing here
 * parses or rewrites it — a ticket's layout is the server's business,
 * which is what lets a venue change its ticket without an app release.
 * ------------------------------------------------------------------ */

export async function fetchStaffTicketHtml(
  token: string,
  orderId: string,
): Promise<StaffResult<string>> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/v1/staff/orders/${encodeURIComponent(orderId)}/ticket`, {
      headers: { "X-Staff-Token": token, Accept: "text/html" },
    });
  } catch {
    return { ok: false, error: "network" };
  }
  if (!res.ok) return { ok: false, error: failure(res.status) };
  const html = await res.text().catch(() => "");
  // A 200 with nothing in it is a ticket nobody can print — and a blank
  // sheet out of the kitchen printer is worse than an error on screen.
  if (!html.trim()) return { ok: false, error: "server" };
  return { ok: true, data: html };
}

/* ------------------------------------------------------------------ *
 * The owner's own password.
 *
 * The staff credential IS a signed session value, and changing the
 * password invalidates every value issued before the change — including
 * the one this call is made with. The server therefore answers with a
 * FRESH token, and the caller must adopt it (`replaceStaffToken`) or the
 * next poll signs the counter out.
 *
 * `wrong_password` arrives as a 400, never a 401: a mistyped password
 * must not look like a dead session.
 * ------------------------------------------------------------------ */

/** The server's own floor (`OWNER_PASSWORD_MIN_LENGTH`), mirrored so the
 *  sheet can say the number before it spends a round trip on it. The
 *  server re-checks and may answer with its own `minLength`. */
export const STAFF_PASSWORD_MIN_LENGTH = 12;

export type StaffPasswordError =
  | "wrong_password"
  | "mismatch"
  | "too_short"
  | "same_as_current"
  | "rate_limited"
  /** The session itself is gone — the caller signs the device out. */
  | "unauthorized"
  | "network"
  | "server";

export type StaffPasswordResult =
  { ok: true; token: string } | { ok: false; error: StaffPasswordError; minLength?: number };

const PASSWORD_ERRORS: readonly string[] = [
  "wrong_password",
  "mismatch",
  "too_short",
  "same_as_current",
  "rate_limited",
];

export async function changeStaffPassword(
  token: string,
  currentPassword: string,
  newPassword: string,
  confirmPassword?: string,
): Promise<StaffPasswordResult> {
  const res = await staffFetch(token, "/api/v1/staff/password", {
    method: "POST",
    body: {
      currentPassword,
      newPassword,
      ...(confirmPassword === undefined ? {} : { confirmPassword }),
    },
  });
  if (!res) return { ok: false, error: "network" };

  const minLength = typeof res.body?.minLength === "number" ? res.body.minLength : undefined;

  if (res.status !== 200) {
    // The named reasons travel in the body; anything else falls back to
    // the shared status mapping ("unauthorized" for a dead session).
    const named = typeof res.body?.error === "string" ? res.body.error : "";
    if (PASSWORD_ERRORS.includes(named)) {
      return { ok: false, error: named as StaffPasswordError, minLength };
    }
    return { ok: false, error: failure(res.status) as StaffPasswordError, minLength };
  }

  const next = typeof res.body?.token === "string" ? res.body.token : "";
  // A 200 with no token would leave the app holding a value the server
  // has just killed — treat it as a server fault rather than a success.
  if (!next) return { ok: false, error: "server" };
  return { ok: true, token: next };
}
