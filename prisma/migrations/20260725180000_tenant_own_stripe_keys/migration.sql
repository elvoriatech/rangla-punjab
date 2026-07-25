-- Restaurant "own keys" payout mode (upfront plans): encrypted Stripe keys so
-- the restaurant collects 100% directly. Additive + nullable/defaulted.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_own_secret_enc" TEXT; -- migration:safe
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_own_secret_mask" TEXT; -- migration:safe
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_own_webhook_enc" TEXT; -- migration:safe
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_own_webhook_mask" TEXT; -- migration:safe
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_own_enabled" BOOLEAN NOT NULL DEFAULT false; -- migration:safe
