import { createLogger } from "./logger";

const log = createLogger();

/**
 * Live payment keys only ever work in production (owner, 2026-10-21:
 * "on production we have live keys — test only locally"). Anywhere else —
 * a laptop, CI, a test run — a live Stripe key or a PayPal "live"
 * environment is refused and the caller falls back to the fake provider,
 * so a live key pasted into a local `.env` by mistake can never charge a
 * real card. Test-mode keys (sk_test_…, PayPal sandbox) work everywhere.
 */
export function liveKeysAllowed(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isLiveStripeKey(key: string | null | undefined): boolean {
  return !!key && /^(sk|rk)_live_/.test(key);
}

/** True when this Stripe key may be used here; logs when it is refused. */
export function stripeKeyUsableHere(key: string | null | undefined): boolean {
  if (!isLiveStripeKey(key) || liveKeysAllowed()) return true;
  log.warn("payments.live_key_refused_outside_production", { provider: "stripe" });
  return false;
}

/** True when this PayPal environment may be used here; logs when refused. */
export function payPalEnvUsableHere(envName: "sandbox" | "live"): boolean {
  if (envName !== "live" || liveKeysAllowed()) return true;
  log.warn("payments.live_key_refused_outside_production", { provider: "paypal" });
  return false;
}
