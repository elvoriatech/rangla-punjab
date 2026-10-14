-- The order log (owner, 2026-10-14): everything that came in for an order
-- and everything that happened to it — the guest's raw order, payment
-- provider messages, every status change — with exact timestamps and the
-- raw JSON, viewable for 6 months.
--
-- Append-only: the app role may read and insert, never update or delete.
-- `order_id` is a plain column (no foreign key), so the log survives the
-- order being deleted. Rows older than 6 months are removed only by
-- purge_order_events(), the one way the app can delete from this table.
CREATE TABLE "order_events" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "venue_id"    TEXT NOT NULL,
  "order_id"    TEXT NOT NULL,
  "order_label" TEXT,
  "kind"        TEXT NOT NULL,
  "actor"       TEXT NOT NULL,
  "summary"     TEXT,
  "payload"     JSONB,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_events_venue_id_fkey" FOREIGN KEY ("venue_id")
    REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "order_events_order_id_createdAt_idx" ON "order_events"("order_id", "createdAt");
CREATE INDEX "order_events_tenant_id_createdAt_idx" ON "order_events"("tenant_id", "createdAt");

ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "order_events"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- The 6-month retention. SECURITY DEFINER so it runs with the table
-- owner's rights; it can only ever remove rows older than 6 months.
CREATE OR REPLACE FUNCTION purge_order_events() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM "order_events" WHERE "createdAt" < now() - interval '6 months';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT ON "order_events" TO elvoria_app;
    GRANT EXECUTE ON FUNCTION purge_order_events() TO elvoria_app;
  END IF;
END
$$;
