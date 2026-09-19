-- Publishable key (pk_…) for the restaurant's own Stripe account. Unlike
-- the secret/webhook keys next to it, this one is public by design: the
-- mobile app's native PaymentSheet receives it verbatim, so it is stored
-- in plain text and shown unmasked in the dashboard. Unset ⇒ the
-- deployment's STRIPE_PUBLISHABLE_KEY.
ALTER TABLE "tenants"
  ADD COLUMN "stripe_own_publishable" TEXT;
