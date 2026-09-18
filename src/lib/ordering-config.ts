import { z } from "zod";
import type { Entitlements } from "./plan-state";

/**
 * Per-venue ordering switches — the owner's layer beneath the plan
 * entitlements (see entitlements.ts for the three-layer model). Stored
 * in `venues.ordering` JSONB.
 *
 * Defaults are ON: when a tenant upgrades, the new modes light up
 * immediately and the owner switches off what they don't want.
 */

/** Cents field that tolerates missing/null/garbage by falling to 0 —
 *  a half-filled admin form must never break parsing or ordering. */
const centsField = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0),
    z.number().int().min(0).max(max).catch(0),
  );

/**
 * One delivery area = one ZIP row (Lieferando-style): its own fee,
 * minimum order, and optional free-delivery threshold (0 = disabled).
 * The guest picks their ZIP from these rows at checkout.
 */
export const deliveryAreaSchema = z.object({
  zip: z.string().trim().min(3).max(10),
  locality: z.string().trim().max(80).catch("").default(""),
  feeCents: centsField(50_000).default(0),
  minCents: centsField(500_000).default(0),
  freeOverCents: centsField(1_000_000).default(0),
});

export type DeliveryArea = z.infer<typeof deliveryAreaSchema>;

/**
 * Payment-method registry: stable ids in the DB, label + optional emoji
 * for display. Informational (how you can pay on site / at the door) —
 * online payment is its own Stripe-Connect-gated feature. Brand marks
 * (Visa, Mastercard, Apple Pay, …) are deliberately TEXT chips: we don't
 * recreate trademarked logos; emoji only where generic.
 */
export const PAYMENT_METHODS = [
  { id: "cash", label: "Cash", emoji: "💶" },
  { id: "girocard", label: "Girocard / EC", emoji: "💳" },
  { id: "visa", label: "Visa", emoji: "" },
  { id: "mastercard", label: "Mastercard", emoji: "" },
  { id: "amex", label: "American Express", emoji: "" },
  { id: "apple_pay", label: "Apple Pay", emoji: "📱" },
  { id: "google_pay", label: "Google Pay", emoji: "📱" },
  { id: "paypal", label: "PayPal", emoji: "" },
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

const PAYMENT_IDS = PAYMENT_METHODS.map((m) => m.id) as readonly string[];

/** What a typical German restaurant takes — the onboarding default. */
export const DEFAULT_PAYMENTS: PaymentMethodId[] = ["cash", "girocard", "visa", "mastercard"];

/** Owner inboxes that get a "new order" email. Up to five, so a shift
 *  lead and the office can both be on it; junk is dropped per address
 *  rather than failing the whole save. Accepts the comma/newline-separated
 *  string the settings form posts as well as a stored array. */
export const MAX_NOTIFY_EMAILS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const notifyEmailsField = z.preprocess((v) => {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]/) : [];
  const out: string[] = [];
  for (const item of raw) {
    const email = String(item).trim().toLowerCase();
    if (email && email.length <= 254 && EMAIL_RE.test(email) && !out.includes(email)) {
      out.push(email);
    }
    if (out.length === MAX_NOTIFY_EMAILS) break;
  }
  return out;
}, z.array(z.string()).max(MAX_NOTIFY_EMAILS));

export const orderingConfigSchema = z.object({
  dineIn: z.boolean().default(true),
  takeaway: z.boolean().default(true),
  delivery: z.boolean().default(true),
  // Table reservations from the public menu — restaurants that don't take
  // them switch the whole surface off (button hidden, API rejects).
  reservations: z.boolean().default(true),
  // Per-ZIP delivery areas (one row per ZIP). When present they are
  // authoritative: the guest must pick one, fee/minimum come from the
  // row. When empty, the flat fields below apply to any address.
  deliveryAreas: z.array(deliveryAreaSchema).max(200).default([]),
  // Legacy flat config, kept as the fallback when no areas are defined;
  // old deliveryZips configs are converted to areas on read.
  deliveryZips: z.array(z.string().trim().min(3).max(10)).default([]),
  deliveryFeeCents: centsField(50_000).default(0),
  deliveryMinCents: centsField(500_000).default(0),
  // Owner-side only — never reaches EffectiveOrdering, which is what the
  // public menu and /api/v1/menu see.
  notifyEmails: notifyEmailsField,
  // Shown in the public menu footer. Per-item sanitised (one unknown
  // value never nukes the list): legacy "credit" expands to
  // Visa + Mastercard, junk is dropped, absent → German-typical default.
  acceptedPayments: z.preprocess(
    (v) => {
      if (!Array.isArray(v)) return DEFAULT_PAYMENTS;
      const out: string[] = [];
      for (const raw of v) {
        const id = String(raw);
        if (id === "credit") out.push("visa", "mastercard");
        else if (PAYMENT_IDS.includes(id)) out.push(id);
      }
      return [...new Set(out)];
    },
    z.array(z.enum(PAYMENT_METHODS.map((m) => m.id) as [PaymentMethodId, ...PaymentMethodId[]])),
  ),
});

export type OrderingConfig = z.infer<typeof orderingConfigSchema>;

export function parseOrderingConfig(raw: unknown): OrderingConfig {
  const parsed = orderingConfigSchema.safeParse(raw ?? {});
  const config = parsed.success ? parsed.data : orderingConfigSchema.parse({});
  // Legacy conversion: a pre-areas config listed ZIPs with one shared
  // fee/minimum. Each ZIP becomes its own row so the settings editor
  // and checkout select see one shape only.
  if (config.deliveryAreas.length === 0 && config.deliveryZips.length > 0) {
    config.deliveryAreas = config.deliveryZips.map((zip) => ({
      zip,
      locality: "",
      feeCents: config.deliveryFeeCents,
      minCents: config.deliveryMinCents,
      freeOverCents: 0,
    }));
  }
  return config;
}

export type OrderType = "dine_in" | "takeaway" | "delivery";
export const ORDER_TYPES: readonly OrderType[] = ["dine_in", "takeaway", "delivery"];

export interface EffectiveOrdering {
  dineIn: boolean;
  takeaway: boolean;
  delivery: boolean;
  /** Table reservations — pure owner switch, not plan-gated. */
  reservations: boolean;
  deliveryAreas: DeliveryArea[];
  deliveryFeeCents: number;
  deliveryMinCents: number;
  acceptedPayments: PaymentMethodId[];
}

/** Effective capability = plan/override entitlement AND owner switch. */
export function effectiveOrdering(
  entitlements: Entitlements,
  config: OrderingConfig,
): EffectiveOrdering {
  return {
    dineIn: entitlements.dineIn && config.dineIn,
    takeaway: entitlements.takeaway && config.takeaway,
    delivery: entitlements.delivery && config.delivery,
    reservations: config.reservations,
    deliveryAreas: config.deliveryAreas,
    deliveryFeeCents: config.deliveryFeeCents,
    deliveryMinCents: config.deliveryMinCents,
    acceptedPayments: config.acceptedPayments,
  };
}

/**
 * Delivery pricing for one order: per-area when areas exist (unknown
 * ZIP → null = outside the delivery area), flat fallback otherwise.
 * Free-delivery threshold zeroes the fee once the basket reaches it.
 */
export function deliveryQuote(
  mode: EffectiveOrdering,
  zip: string,
  itemsCents: number,
): { feeCents: number; minCents: number; locality: string } | null {
  if (mode.deliveryAreas.length > 0) {
    const area = mode.deliveryAreas.find((a) => a.zip === zip.trim());
    if (!area) return null;
    const free = area.freeOverCents > 0 && itemsCents >= area.freeOverCents;
    return { feeCents: free ? 0 : area.feeCents, minCents: area.minCents, locality: area.locality };
  }
  return { feeCents: mode.deliveryFeeCents, minCents: mode.deliveryMinCents, locality: "" };
}

export function orderTypeAllowed(mode: EffectiveOrdering, type: OrderType): boolean {
  if (type === "dine_in") return mode.dineIn;
  if (type === "takeaway") return mode.takeaway;
  return mode.delivery;
}

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

/**
 * Human lines describing where an order goes — shared by the kitchen
 * screen, orders list, 80mm ticket, and PDF receipt so staff read the
 * same words everywhere.
 */
export function fulfilmentLines(
  order: {
    orderType: string;
    tableNumber: string | null;
    customerName: string | null;
    customerPhone: string | null;
    requestedFor?: Date | null;
    deliveryAddress: { street?: string; zip?: string; city?: string; note?: string } | null;
  },
  timezone = "Europe/Berlin",
): string[] {
  // Scheduled orders lead with the requested time — it's the single
  // most important line for the kitchen's planning.
  const timeLine = order.requestedFor
    ? [
        `⏰ Planned for ${new Intl.DateTimeFormat("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: timezone,
        }).format(order.requestedFor)}`,
      ]
    : [];
  if (order.orderType === "takeaway") {
    return [
      ...timeLine,
      `PICKUP${order.customerName ? ` — ${order.customerName}` : ""}`,
      ...(order.customerPhone ? [order.customerPhone] : []),
    ];
  }
  if (order.orderType === "delivery") {
    const a = order.deliveryAddress;
    return [
      ...timeLine,
      `DELIVERY${order.customerName ? ` — ${order.customerName}` : ""}`,
      ...(order.customerPhone ? [order.customerPhone] : []),
      ...(a?.street ? [`${a.street}, ${a.zip ?? ""} ${a.city ?? ""}`.trim()] : []),
      ...(a?.note ? [`Note: ${a.note}`] : []),
    ];
  }
  return order.tableNumber ? [`Table ${order.tableNumber}`] : [];
}
