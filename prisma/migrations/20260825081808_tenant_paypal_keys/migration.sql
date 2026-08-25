-- Per-restaurant PayPal credentials, mirroring the Stripe own-keys columns.
-- Unset ⇒ the deployment-wide PAYPAL_* env vars still apply.
ALTER TABLE "tenants"
  ADD COLUMN "paypal_client_id_enc"  TEXT,
  ADD COLUMN "paypal_client_id_mask" TEXT,
  ADD COLUMN "paypal_secret_enc"     TEXT,
  ADD COLUMN "paypal_secret_mask"    TEXT,
  ADD COLUMN "paypal_env"            TEXT    NOT NULL DEFAULT 'sandbox',
  ADD COLUMN "paypal_own_enabled"    BOOLEAN NOT NULL DEFAULT false;
