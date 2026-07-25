-- Operator-managed platform Stripe keys (encrypted at rest). *_enc holds
-- AES-GCM ciphertext, *_mask a safe display hint. Additive + nullable; a
-- NULL column falls back to the corresponding env var.
ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "stripe_secret_enc" TEXT; -- migration:safe
ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "stripe_secret_mask" TEXT; -- migration:safe
ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "stripe_webhook_enc" TEXT; -- migration:safe
ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "stripe_webhook_mask" TEXT; -- migration:safe
ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "stripe_connect_webhook_enc" TEXT; -- migration:safe
ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "stripe_connect_webhook_mask" TEXT; -- migration:safe
