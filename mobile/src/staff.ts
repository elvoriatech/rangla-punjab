import { BASE_URL } from "./api";

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

/** "conflict" is only ever an invalid status transition (409): someone
 *  else moved the order on first. */
export type StaffError = "unauthorized" | "conflict" | "network" | "server";

export type StaffResult<T> = { ok: true; data: T } | { ok: false; error: StaffError };

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
