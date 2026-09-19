-- Loyalty points, round one: earning, balance, vouchers.
--
-- Points are per ORDER (not per dish): a qualifying settled order credits
-- a flat `pointsPerOrder`, and `rewardPoints` of them convert into one
-- voucher worth `rewardValueCents`. The owner's switches live in
-- venues.loyalty (src/lib/loyalty-config.ts); the default '{}' parses to
-- "off", so every existing venue keeps showing guests nothing.
ALTER TABLE "venues" ADD COLUMN "loyalty" JSONB NOT NULL DEFAULT '{}';

-- Redemption is round two. The two columns land now so the follow-up is
-- code only, never another ALTER on a hot orders table. Plain references:
-- round two decides the FK/restore semantics.
ALTER TABLE "orders" ADD COLUMN "discount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "voucher_id" TEXT;

-- Append-only points ledger. A customer's balance is SUM(delta) — no
-- cached total exists, so nothing can drift.
--
-- The UNIQUE on (order_id, reason) is what makes earning idempotent on a
-- path three callers race for (Stripe webhook, /pay/verify, the dashboard
-- reconcile): exactly one INSERT wins, the rest are no-ops. Postgres
-- treats NULLs as distinct, so voucher/adjust rows (order_id NULL) are
-- unconstrained.
CREATE TABLE "loyalty_ledger" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "order_id"    TEXT,
  "delta"       INTEGER NOT NULL,
  "reason"      TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loyalty_ledger_customer_id_fkey" FOREIGN KEY ("customer_id")
    REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loyalty_ledger_order_id_fkey" FOREIGN KEY ("order_id")
    REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "loyalty_ledger_reason_check"
    CHECK ("reason" IN ('order', 'reversal', 'voucher', 'adjust'))
);
CREATE UNIQUE INDEX "loyalty_ledger_order_id_reason_key"
  ON "loyalty_ledger"("order_id", "reason");
CREATE INDEX "loyalty_ledger_tenant_customer_idx"
  ON "loyalty_ledger"("tenant_id", "customer_id");

-- One earned reward. Expiry is applied LAZILY on read (getLoyaltySummary),
-- never by a cron nobody watches.
CREATE TABLE "loyalty_vouchers" (
  "id"                TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "customer_id"       TEXT NOT NULL,
  "value_cents"       INTEGER NOT NULL,
  "points_spent"      INTEGER NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'available',
  "expires_at"        TIMESTAMP(3) NOT NULL,
  "armed_at"          TIMESTAMP(3),
  "redeemed_order_id" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "loyalty_vouchers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_vouchers_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loyalty_vouchers_customer_id_fkey" FOREIGN KEY ("customer_id")
    REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loyalty_vouchers_status_check"
    CHECK ("status" IN ('available', 'armed', 'redeemed', 'expired', 'revoked'))
);
CREATE INDEX "loyalty_vouchers_tenant_customer_idx"
  ON "loyalty_vouchers"("tenant_id", "customer_id");

-- Same tenant-isolation posture as every other tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loyalty_ledger','loyalty_vouchers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
      || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
      t
    );
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON "loyalty_ledger", "loyalty_vouchers" TO elvoria_app;
