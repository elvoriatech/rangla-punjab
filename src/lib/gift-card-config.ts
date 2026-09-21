import { z } from "zod";

/**
 * Per-venue gift-card switches — the owner's "Gift cards" section in
 * Dashboard → Settings, stored in `venues.gift_cards` JSONB.
 *
 * Same posture as `loyalty-config.ts` and `ordering-config.ts`: a
 * half-filled or hand-edited blob must never fail the whole parse,
 * because a settings row that throws would silently take a paid product
 * off sale. Every field falls back to its default instead.
 *
 * The one deliberate difference from loyalty is that `enabled` defaults
 * to TRUE. Loyalty is a scheme a venue opts into; a gift card is a
 * product the owner asked for, and the three seeded products already
 * gate visibility on their own `active` flag — a venue with no active
 * products shows guests nothing regardless of this switch.
 *
 * LEGAL (DE): a purchased gift card is a multi-purpose voucher
 * (Mehrzweckgutschein, § 3 Abs. 14 UStG). VAT falls due at REDEMPTION,
 * not at sale, so the sale is not a taxable turnover — which is why the
 * dashboard report exists: the accountant needs the redemption dates,
 * not the purchase dates. Shortening the expiry below the statutory
 * limitation period (§ 195 BGB, three years from the end of the year of
 * purchase) is contestable for a PAID voucher; the settings hint says so
 * and 36 is the recommended value.
 */

export const GIFT_CARD_DEFAULTS = {
  enabled: true,
  /**
   * Three years. Matches the regelmäßige Verjährungsfrist a court would
   * apply anyway, so it is the value least likely to be struck down.
   */
  expiryMonths: 36,
} as const;

/**
 * What a guest is allowed to load onto a card.
 *
 * The buyer names the amount, not the design: `GiftCardProduct.priceCents`
 * is now a SUGGESTION (the placeholder the app shows for that artwork),
 * and the card's `valueCents` is whatever the guest asked for. The
 * bounds below are the only thing standing between that and an absurd
 * card, so they live here, once, and are enforced BOTH at the route
 * (zod, so the app gets a precise error) and inside
 * `createGiftCardPurchase` (so no other caller can skip them).
 *
 * - `minCents` €5 — below a coffee the card costs more to process than
 *   it is worth, and payment providers charge a floor per transaction.
 * - `maxCents` €500 — a paid voucher is stored value we owe for three
 *   years (§ 195 BGB); a five-figure card is a money-laundering shape,
 *   not a birthday present, and the owner should sell it by hand.
 * - `stepCents` 100 — whole euros only. Nobody gifts €47.63, and a
 *   round number keeps the printed card legible.
 */
export const GIFT_CARD_AMOUNT = {
  minCents: 500,
  maxCents: 50_000,
  stepCents: 100,
} as const;

/**
 * Buying a gift card is discounted: the guest pays this much less than the
 * card is worth (owner decision 2026-09-21). A €25 card costs €23.75 and
 * still spends as €25 — the discount is on the purchase, never on the
 * card's value.
 */
export const GIFT_CARD_PURCHASE_DISCOUNT_PERCENT = 5;

/** What the buyer is charged for a card worth `valueCents`. Rounded to
 *  the cent; whole-euro values make every result exact to 5 cents. */
export function giftCardChargeCents(valueCents: number): number {
  return Math.round((valueCents * (100 - GIFT_CARD_PURCHASE_DISCOUNT_PERCENT)) / 100);
}

/** True when `cents` is an amount a guest may actually buy. */
export function isValidGiftCardAmount(cents: number): boolean {
  return (
    Number.isInteger(cents) &&
    cents >= GIFT_CARD_AMOUNT.minCents &&
    cents <= GIFT_CARD_AMOUNT.maxCents &&
    cents % GIFT_CARD_AMOUNT.stepCents === 0
  );
}

/** The value the settings form marks as "recommended". */
export const GIFT_CARD_RECOMMENDED_EXPIRY_MONTHS = GIFT_CARD_DEFAULTS.expiryMonths;

/**
 * Anything below a year is legally risky for a PAID voucher, so the
 * dashboard warns rather than silently accepting it. We still store it —
 * the owner, not us, carries that call — but the hint has to have been
 * shown. 1 is the floor: a zero-month card is a bug, not a choice.
 */
export const GIFT_CARD_RISKY_EXPIRY_BELOW_MONTHS = 12;

const expiryMonthsField = z.preprocess((v) => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v.trim().replace(",", "."))
        : NaN;
  if (!Number.isFinite(n)) return GIFT_CARD_DEFAULTS.expiryMonths;
  const months = Math.round(n);
  // Below the floor reads as "never chose" and becomes the default, the
  // same way `loyalty-config.ts` treats its legacy 0. Above the ceiling
  // is left for zod to refuse so a 999 falls back like any other typo.
  return months < 1 ? GIFT_CARD_DEFAULTS.expiryMonths : months;
}, z.number().int().min(1).max(120).catch(GIFT_CARD_DEFAULTS.expiryMonths));

export const giftCardConfigSchema = z.object({
  /** Master switch. Off = no buy surface in the app, no public product list. */
  enabled: z
    .preprocess((v) => (typeof v === "boolean" ? v : undefined), z.boolean())
    .default(GIFT_CARD_DEFAULTS.enabled),
  /** Card lifetime in whole months, counted from the PAYMENT date. */
  expiryMonths: expiryMonthsField.default(GIFT_CARD_DEFAULTS.expiryMonths),
});

export type GiftCardConfig = z.infer<typeof giftCardConfigSchema>;

export function parseGiftCardConfig(raw: unknown): GiftCardConfig {
  const parsed = giftCardConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : giftCardConfigSchema.parse({});
}

/** True when the chosen term is short enough to warrant the legal warning. */
export function isRiskyExpiry(months: number): boolean {
  return months < GIFT_CARD_RISKY_EXPIRY_BELOW_MONTHS;
}
