/**
 * The app's whole server contract — the /api/v1 reads plus the existing
 * order placement route. Money is integer cents, image URLs absolute,
 * and unknown enum values must be tolerated (the server may grow the
 * lifecycle after this build shipped).
 */
import { Platform } from "react-native";

// Dev default: the local web app. Android emulators can't see `localhost`,
// they reach the host via 10.0.2.2. Override per build with
// EXPO_PUBLIC_API_URL (baked at build time, expo convention).
const fallback = Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? fallback;

export interface ApiVariant {
  id: string;
  name: string;
  priceDeltaCents: number;
}
export interface ApiItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  /** Present while an offer is active: regular price for the strikethrough. */
  offer?: { basePriceCents: number; endsAt: string | null } | null;
  currency: string;
  isAvailable: boolean;
  allergens: string[];
  traces: string[];
  dietary: string[];
  spice: number;
  photoUrl: string;
  variants: ApiVariant[];
}
export interface ApiCategory {
  id: string;
  name: string;
  photoUrl: string | null;
  items: ApiItem[];
}
export interface ApiDeliveryArea {
  zip: string;
  locality?: string;
  feeCents?: number;
  minCents?: number;
  freeOverCents?: number;
}
export interface ApiOrdering {
  dineIn: boolean;
  takeaway: boolean;
  delivery: boolean;
  deliveryAreas: ApiDeliveryArea[];
  deliveryFeeCents: number;
  deliveryMinCents: number;
  acceptedPayments: string[];
  onlinePayment: boolean;
  paypal?: boolean;
}
export interface ApiMenu {
  ok: true;
  venue: {
    name: string;
    slug: string;
    currency: string;
    locale: string;
    logoUrl: string | null;
    hours: unknown;
  };
  ordering: ApiOrdering;
  categories: ApiCategory[];
}

/** The server emits absolute image URLs against its own origin; in dev
 *  that's `localhost`, which an Android emulator can't reach — rebase
 *  any localhost image onto BASE_URL (10.0.2.2 on Android). */
function rebaseUrl<T extends string | null>(url: T): T {
  if (!url) return url;
  return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, BASE_URL) as T;
}

export async function fetchMenu(locale?: string): Promise<ApiMenu> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const res = await fetch(`${BASE_URL}/api/v1/menu${qs}`);
  if (!res.ok) throw new Error(`menu ${res.status}`);
  const menu = (await res.json()) as ApiMenu;
  return {
    ...menu,
    venue: { ...menu.venue, logoUrl: rebaseUrl(menu.venue.logoUrl) },
    categories: menu.categories.map((c) => ({
      ...c,
      photoUrl: rebaseUrl(c.photoUrl),
      items: c.items.map((i) => ({ ...i, photoUrl: rebaseUrl(i.photoUrl) })),
    })),
  };
}

export type OrderType = "dine_in" | "takeaway" | "delivery";

export interface PlaceOrderInput {
  slug: string;
  items: { itemId: string; quantity: number }[];
  orderType: OrderType;
  tableNumber?: string;
  customerName?: string;
  customerPhone?: string;
  address?: { street: string; zip: string; city?: string; note?: string };
}
export interface PlacedOrder {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  receiptToken: string;
}

export async function placeOrder(
  input: PlaceOrderInput,
  customerToken?: string | null,
): Promise<{ ok: true; order: PlacedOrder } | { ok: false; error: string }> {
  const res = await fetch(`${BASE_URL}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Signed-in customers get the order linked to their account.
      ...(customerToken ? { "X-Customer-Token": customerToken } : {}),
    },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || typeof body.orderId !== "string") {
    return { ok: false, error: String(body?.error ?? `http_${res.status}`) };
  }
  return { ok: true, order: body as unknown as PlacedOrder };
}

export interface ApiTrackStep {
  key: string;
  labelDe: string;
  labelEn: string;
  reached: boolean;
}
export interface ApiTrackItem {
  name: string;
  quantity: number;
  priceCents: number;
  lineTotalCents: number;
}
export interface ApiTracking {
  id: string;
  orderNumber: number;
  status: string;
  currentStepIndex: number;
  steps: ApiTrackStep[];
  orderType: string;
  paymentStatus: string;
  /** Optional: older servers don't send the lines. */
  items?: ApiTrackItem[];
  totalCents: number;
  currency: string;
  tableNumber: string | null;
  placedAt: string;
}

export async function fetchOrderStatus(orderId: string, token: string): Promise<ApiTracking> {
  const res = await fetch(
    `${BASE_URL}/api/v1/orders/${encodeURIComponent(orderId)}/status?token=${encodeURIComponent(token)}`,
  );
  const body = (await res.json().catch(() => null)) as { ok?: boolean; order?: ApiTracking } | null;
  if (!res.ok || !body?.ok || !body.order) throw new Error(`status ${res.status}`);
  return body.order;
}

export function payPageUrl(orderId: string, token: string): string {
  return `${BASE_URL}/pay/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`;
}

export function receiptUrl(orderId: string, token: string): string {
  return `${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/receipt?token=${encodeURIComponent(token)}&locale=de`;
}
