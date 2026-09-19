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
  currency: string;
  items: StaffOrderItem[];
}

export interface StaffSummary {
  openOrders: number;
  unpaidOnline: number;
  pendingReservations: number;
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
    currency: str(o.currency, "EUR"),
    items: Array.isArray(o.items)
      ? o.items.map(asItem).filter((i): i is StaffOrderItem => i !== null)
      : [],
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
 * Move an order on. `to` always comes from that order's own `allowedNext`
 * — 409 (`invalid_transition`) therefore means the board is stale, not
 * that the app got the lifecycle wrong.
 */
export async function advanceStaffOrder(
  token: string,
  orderId: string,
  to: string,
): Promise<StaffResult<StaffOrder | null>> {
  const res = await staffFetch(
    token,
    `/api/v1/staff/orders/${encodeURIComponent(orderId)}/status`,
    {
      method: "POST",
      body: { to },
    },
  );
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
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
    },
  };
}

/** Best effort: the local session is cleared whatever the server says. */
export async function staffLogout(token: string): Promise<void> {
  await staffFetch(token, "/api/v1/staff/logout", { method: "POST" });
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

/** The guests' side of the programme, as the restaurant sees it. */
export async function fetchStaffLoyalty(token: string): Promise<StaffResult<StaffLoyalty>> {
  const res = await staffFetch(token, "/api/v1/staff/loyalty");
  if (!res) return { ok: false, error: "network" };
  if (res.status !== 200 || !res.body) return { ok: false, error: failure(res.status) };
  const body = res.body;
  const config = (body.config && typeof body.config === "object" ? body.config : {}) as Record<
    string,
    unknown
  >;
  const totals = (body.totals && typeof body.totals === "object" ? body.totals : {}) as Record<
    string,
    unknown
  >;
  return {
    ok: true,
    data: {
      enabled: bool(body.enabled),
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
    },
  };
}
