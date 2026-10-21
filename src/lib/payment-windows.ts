/**
 * Payment timing (owner, 2026-10-21, after order O-6).
 *
 * Neither Stripe nor PayPal prescribes these — they are the restaurant's
 * rules. A card page can be paid for 30 minutes (Stripe's minimum Checkout
 * expiry); a payment is captured and sent to the kitchen automatically only
 * within 45 minutes of its attempt starting (the 30-minute page plus margin
 * for a slow webhook). Later, the reserved money is released instead — the
 * guest is never charged for an order the restaurant stopped expecting.
 */
export const CHECKOUT_EXPIRY_MS = 30 * 60 * 1000;
export const AUTO_ACCEPT_WINDOW_MS = 45 * 60 * 1000;

/** Stripe refuses an `expires_at` under 30 minutes from ITS clock; a
 *  minute of slack keeps a request that takes a moment from failing. */
export function checkoutExpiresAtSeconds(now = Date.now()): number {
  return Math.floor((now + CHECKOUT_EXPIRY_MS + 60_000) / 1000);
}
