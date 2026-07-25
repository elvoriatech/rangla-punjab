/**
 * The operator support-fee plan.
 *
 * White-label, one deploy per restaurant: there are no SaaS tiers
 * (Starter/Growth/Scale are gone). A restaurant on the `upfront` fee
 * model pays a single flat monthly support fee; a restaurant on the
 * `percentage` model pays nothing recurring (the operator earns from the
 * per-order Connect application fee instead — see connect-service.ts).
 *
 * Stripe is the source of truth for what is actually charged; the price
 * lives in Stripe under the id held in `stripePriceIdEnv`. The amount
 * below is display-only (billing page copy).
 */

export type PlanCode = "support";

export interface PlanDefinition {
  code: PlanCode;
  /** Display name shown on the billing page. */
  label: string;
  /** Display-only monthly price in cents. Stripe is authoritative. */
  priceMonthlyCents: number;
  blurb: string;
  features: string[];
  /** Env var holding the Stripe recurring price id at runtime. Absent in
   *  dev/CI (which ride on the fake provider) → a stable sentinel. */
  stripePriceIdEnv: string;
}

export const SUPPORT_PLAN: Readonly<PlanDefinition> = Object.freeze({
  code: "support",
  label: "Support & hosting",
  priceMonthlyCents: 2000,
  blurb: "Covers hosting, updates, and support for your ordering site.",
  features: [
    "Hosted QR ordering site",
    "Menu & branding management",
    "Kitchen display + order notifications",
    "Software updates & maintenance",
    "Email support",
  ],
  stripePriceIdEnv: "STRIPE_PRICE_ID_SUPPORT",
});

/** Single-plan catalogue, keyed by code so existing lookups keep working. */
export const PLANS: Readonly<Record<PlanCode, Readonly<PlanDefinition>>> = Object.freeze({
  support: SUPPORT_PLAN,
});

export const PLAN_CODES = Object.keys(PLANS) as readonly PlanCode[];
