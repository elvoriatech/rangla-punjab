import { env } from "../env";

/**
 * Which publishable key does the native payment sheet get?
 *
 * The rule mirrors the secret-key routing one level up: keys pasted in
 * Dashboard → Payments describe the restaurant's own Stripe account and
 * win; otherwise the deployment's STRIPE_PUBLISHABLE_KEY is that account
 * (single-restaurant build). Kept in one place so the intent endpoint and
 * anything that follows it cannot drift apart — a publishable key that
 * belongs to a different account than the PaymentIntent's secret makes
 * Stripe reject the confirmation with a confusing client-side error.
 *
 * Publishable keys are public identifiers: safe to ship to an app, safe
 * to log. The pairing is what matters, not the secrecy.
 */
export interface PublishableKeySource {
  stripeOwnEnabled: boolean;
  stripeOwnPublishable: string | null;
}

export function resolvePublishableKey(tenant: PublishableKeySource): string | null {
  if (tenant.stripeOwnEnabled && tenant.stripeOwnPublishable) {
    return tenant.stripeOwnPublishable;
  }
  return env.STRIPE_PUBLISHABLE_KEY ?? null;
}
