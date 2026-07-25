-- P6: guest online payments via Stripe Connect (Scale tier).
--  · tenants: the connected account (money belongs to the restaurant;
--    Elvoria takes an application fee per order) + charges_enabled
--    mirror kept fresh by onboarding/webhooks.
--  · orders: payment lifecycle. "none" = pay at restaurant (default,
--    unchanged behaviour); pending → paid via provider webhook.
-- Hand-written (partitioned-table constraint; see earlier migrations).

ALTER TABLE tenants ADD COLUMN stripe_account_id text;
ALTER TABLE tenants ADD COLUMN stripe_charges_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE orders ADD COLUMN payment_status text NOT NULL DEFAULT 'none';
ALTER TABLE orders ADD COLUMN payment_ref text;
ALTER TABLE orders ADD COLUMN application_fee_cents int NOT NULL DEFAULT 0;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('none', 'pending', 'paid', 'failed'));
