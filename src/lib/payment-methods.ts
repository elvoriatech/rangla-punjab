/**
 * Payment-method registry: stable ids in the DB, label + optional emoji
 * for display. Informational (how you can pay on site / at the door) —
 * online payment is its own Stripe-Connect-gated feature.
 *
 * This is a LEAF module on purpose: no imports, no zod. It used to live in
 * `ordering-config.ts`, which is the right home for the *schema* but the
 * wrong one for a constant the guest page needs — `payment-marks.tsx` is a
 * client component, so value-importing the registry from there dragged
 * `ordering-config` and therefore the whole of zod into the guest's cart
 * chunk (~23 kB gzipped of parser nobody runs in the browser), which
 * `lighthouserc.json`'s `resource-summary:script:size` budget pays for.
 *
 * `ordering-config.ts` re-exports everything here, so server-side callers
 * can keep importing it from there.
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

/** What a typical German restaurant takes — the onboarding default. */
export const DEFAULT_PAYMENTS: PaymentMethodId[] = ["cash", "girocard", "visa", "mastercard"];
