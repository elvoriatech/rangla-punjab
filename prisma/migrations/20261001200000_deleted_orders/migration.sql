-- Deleted orders (owner, 2026-10-01): the owner may DELETE a cancelled
-- order on which no money moved — test orders, mis-taps, no-shows. The
-- order row and its lines really go; what stays is this one line saying
-- that order #N existed, when, for how much, who removed it and why.
--
-- It is also what keeps order numbers from being handed out twice:
-- numbering takes the highest number across orders AND this table.
CREATE TABLE "deleted_orders" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "venue_id"       TEXT NOT NULL,
  "order_number"   INTEGER NOT NULL,
  "order_type"     TEXT NOT NULL,
  "payment_status" TEXT NOT NULL,
  "total_cents"    INTEGER NOT NULL,
  "currency"       TEXT NOT NULL,
  "placed_at"      TIMESTAMP(3) NOT NULL,
  "reason"         TEXT NOT NULL,
  "deleted_by"     TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deleted_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deleted_orders_venue_id_fkey" FOREIGN KEY ("venue_id")
    REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "deleted_orders_reason_check" CHECK (char_length(btrim("reason")) >= 3)
);
CREATE INDEX "deleted_orders_tenant_id_createdAt_idx" ON "deleted_orders"("tenant_id", "createdAt");
CREATE INDEX "deleted_orders_venue_id_order_number_idx" ON "deleted_orders"("venue_id", "order_number");

ALTER TABLE "deleted_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deleted_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deleted_orders"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT ON "deleted_orders" TO elvoria_app;
  END IF;
END
$$;
