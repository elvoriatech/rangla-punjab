-- Per-restaurant PayPal webhook id, so /api/paypal/webhook can verify a
-- delivery against the restaurant's own app (verify-webhook-signature
-- needs the webhook id the endpoint was registered under). Encrypted +
-- masked like the other PayPal credentials. Unset ⇒ PAYPAL_WEBHOOK_ID.
ALTER TABLE "tenants"
  ADD COLUMN "paypal_webhook_id_enc"  TEXT,
  ADD COLUMN "paypal_webhook_id_mask" TEXT;
