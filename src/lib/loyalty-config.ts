import { z } from "zod";

export { pointsForFood } from "./loyalty-points";

/**
 * Per-venue loyalty switches — the owner's "Loyalty" section in
 * Dashboard → Settings, stored in `venues.loyalty` JSONB.
 *
 * Points are earned per ORDER, never per dish: one qualifying order is
 * worth `pointsPerOrder`, and `rewardPoints` of them convert into one
 * voucher worth `rewardValueCents`. That keeps the rule explainable on a
 * single line of the cart ("You'll earn 5 points with this order") and
 * keeps the ledger honest without pricing every item twice.
 *
 * Defaults are OFF: a venue that never opens this section shows guests
 * nothing at all — no cart line, no account card, no `/api/v1/menu` claim
 * that points exist.
 *
 * Same posture as `ordering-config.ts`: a half-filled or hand-edited JSON
 * blob must never break parsing. Every field falls back to its default
 * rather than failing the whole config, because a settings row that fails
 * to parse would silently turn ordering surfaces off.
 */

export const LOYALTY_DEFAULTS = {
  enabled: false,
  minOrderCents: 2000,
  pointsPerOrder: 5,
  rewardPoints: 100,
  rewardValueCents: 2000,
  voucherExpiryMonths: 12,
} as const;

/** Non-negative integer that tolerates null/garbage by falling back. */
const intField = (max: number, fallback: number) =>
  z.preprocess((v) => {
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && v.trim() !== ""
          ? Number(v.trim().replace(",", "."))
          : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
  }, z.number().int().min(0).max(max).catch(fallback));

/**
 * Voucher lifetime, in whole months — the one field where 0 is not a
 * number but a legacy.
 *
 * It used to mean "dies at the end of the calendar month it was earned in"
 * AND it was the default, so every venue that has ever opened the Loyalty
 * form and pressed Save has a stored 0: an explicit choice and "never
 * chose" are indistinguishable in the data. A reward earned on the 28th
 * that expires on the 31st is what the owner asked us to stop, so 0 — and
 * anything below 1 — now reads as "never chose" and becomes the new
 * default of a year. The option is gone from both editors, so nothing can
 * write a fresh 0 back.
 */
const expiryMonthsField = z.preprocess((v) => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v.trim().replace(",", "."))
        : NaN;
  if (!Number.isFinite(n)) return LOYALTY_DEFAULTS.voucherExpiryMonths;
  const months = Math.round(n);
  // Anything ABOVE the ceiling is left for zod to refuse, so it falls
  // back to the default exactly like every other junk value — a 999 is a
  // typo, not a request for an 83-year voucher.
  return months < 1 ? LOYALTY_DEFAULTS.voucherExpiryMonths : months;
}, z.number().int().min(1).max(60).catch(LOYALTY_DEFAULTS.voucherExpiryMonths));

export const loyaltyConfigSchema = z.object({
  /** Master switch. Off = guests never see loyalty anywhere. */
  enabled: z
    .preprocess((v) => (typeof v === "boolean" ? v : undefined), z.boolean())
    .default(false),
  /** The order's FOOD value must reach this to earn (delivery fee excluded). */
  minOrderCents: intField(1_000_000, LOYALTY_DEFAULTS.minOrderCents).default(
    LOYALTY_DEFAULTS.minOrderCents,
  ),
  /** Flat points for one qualifying order. */
  pointsPerOrder: intField(10_000, LOYALTY_DEFAULTS.pointsPerOrder).default(
    LOYALTY_DEFAULTS.pointsPerOrder,
  ),
  /** Points that convert into one voucher. 0 would mean "reward on every
   *  point", which is a config accident, so the service treats <1 as off. */
  rewardPoints: intField(1_000_000, LOYALTY_DEFAULTS.rewardPoints).default(
    LOYALTY_DEFAULTS.rewardPoints,
  ),
  /** What one voucher is worth — the free-meal value. */
  rewardValueCents: intField(1_000_000, LOYALTY_DEFAULTS.rewardValueCents).default(
    LOYALTY_DEFAULTS.rewardValueCents,
  ),
  /** How long a minted voucher lives, in whole months: 1 = the end of the
   *  month AFTER the one it was earned in (venue timezone, 23:59:59), 12 =
   *  a year. See `expiryMonthsField` for why 0 is no longer a value. */
  voucherExpiryMonths: expiryMonthsField.default(LOYALTY_DEFAULTS.voucherExpiryMonths),
});

export type LoyaltyConfig = z.infer<typeof loyaltyConfigSchema>;

export function parseLoyaltyConfig(raw: unknown): LoyaltyConfig {
  const parsed = loyaltyConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : loyaltyConfigSchema.parse({});
}

/**
 * The subset every public surface may see (`/api/v1/menu`, the web cart).
 * Deliberately excludes nothing today — it exists so a future owner-only
 * field cannot leak by being added to the schema.
 */
export interface PublicLoyalty {
  enabled: boolean;
  minOrderCents: number;
  pointsPerOrder: number;
  rewardPoints: number;
  rewardValueCents: number;
}

export function publicLoyalty(config: LoyaltyConfig): PublicLoyalty {
  return {
    enabled: config.enabled,
    minOrderCents: config.minOrderCents,
    pointsPerOrder: config.pointsPerOrder,
    rewardPoints: config.rewardPoints,
    rewardValueCents: config.rewardValueCents,
  };
}

/** Loyalty can actually award something. A venue with `enabled` on but
 *  zeroed numbers earns nothing, and must not promise points in the UI. */
export function loyaltyActive(config: LoyaltyConfig): boolean {
  return config.enabled && config.pointsPerOrder > 0 && config.rewardPoints > 0;
}
