-- Payment attempts (owner, 2026-10-21, after order O-6): one row per
-- Stripe Checkout Session / PaymentIntent / PayPal order, with the exact
-- amount the guest was asked for. Every settlement is validated against
-- it, and the amount, currency, ref, provider and order can never change.
CREATE TABLE "payment_attempts" (
  "id"                TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "venue_id"          TEXT NOT NULL,
  "order_id"          TEXT NOT NULL,
  "order_label"       TEXT,
  "provider"          TEXT NOT NULL,
  "ref"               TEXT NOT NULL,
  "amount_cents"      INTEGER NOT NULL,
  "currency"          TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'open',
  "settled"           BOOLEAN NOT NULL DEFAULT false,
  "resolution"        TEXT NOT NULL DEFAULT 'none',
  "resolution_reason" TEXT,
  "resolution_note"   TEXT,
  "resolved_by"       TEXT,
  "resolved_at"       TIMESTAMPTZ(3),
  "succeeded_at"      TIMESTAMPTZ(3),
  "created_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_attempts_venue_id_fkey" FOREIGN KEY ("venue_id")
    REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payment_attempts_provider_check" CHECK ("provider" IN ('stripe', 'paypal')),
  CONSTRAINT "payment_attempts_status_check"
    CHECK ("status" IN ('open', 'succeeded', 'failed', 'expired', 'cancelled')),
  CONSTRAINT "payment_attempts_resolution_check"
    CHECK ("resolution" IN ('none', 'needed', 'resolved')),
  CONSTRAINT "payment_attempts_amount_check" CHECK ("amount_cents" >= 0)
);
CREATE UNIQUE INDEX "payment_attempts_provider_ref_key" ON "payment_attempts"("provider", "ref");
CREATE INDEX "payment_attempts_order_id_idx" ON "payment_attempts"("order_id");
CREATE INDEX "payment_attempts_tenant_id_resolution_idx" ON "payment_attempts"("tenant_id", "resolution");
CREATE INDEX "payment_attempts_tenant_id_status_created_at_idx"
  ON "payment_attempts"("tenant_id", "status", "created_at");

-- The attempt's identity and amount are immutable.
CREATE OR REPLACE FUNCTION payment_attempts_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.ref IS DISTINCT FROM OLD.ref
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'payment_attempts: amount, currency, ref, provider, order and tenant are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_attempts_immutable
  BEFORE UPDATE ON "payment_attempts"
  FOR EACH ROW EXECUTE FUNCTION payment_attempts_immutable();

ALTER TABLE "payment_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_attempts"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- Existing online orders get their current attempt, at the amount they
-- carry now, so payments already under way are validated too.
INSERT INTO "payment_attempts"
  ("id", "tenant_id", "venue_id", "order_id", "order_label", "provider", "ref",
   "amount_cents", "currency", "status", "settled", "succeeded_at", "created_at", "updated_at")
SELECT 'pa_' || md5(o."id" || o."payment_ref"), o."tenant_id", o."venue_id", o."id",
       CASE WHEN o."order_series" IS NULL THEN o."order_number"::text
            ELSE o."order_series" || '-' || o."order_number" END,
       o."payment_provider", o."payment_ref", o."total_cents", o."currency",
       CASE WHEN o."payment_status" = 'paid' THEN 'succeeded'
            WHEN o."payment_status" = 'failed' THEN 'failed' ELSE 'open' END,
       o."payment_status" = 'paid',
       CASE WHEN o."payment_status" = 'paid' THEN o."paid_at" END,
       -- When the order was last changed — for an unpaid order, when its
       -- payment was started — so the 45-minute rule is not tighter than it
       -- should be for an order that waited before being paid.
       o."updatedAt", CURRENT_TIMESTAMP
FROM "orders" o
WHERE o."payment_ref" IS NOT NULL
  AND o."payment_provider" IN ('stripe', 'paypal')
ON CONFLICT ("provider", "ref") DO NOTHING;

-- Webhook claims: a delivery is "processing" until it commits; a failed
-- one deletes its claim so the provider's retry runs again.
ALTER TABLE "webhook_events" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'done';
ALTER TABLE "webhook_events" ADD COLUMN "claimed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "payment_attempts" TO elvoria_app;
  END IF;
END
$$;
