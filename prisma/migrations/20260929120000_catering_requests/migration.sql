-- Catering enquiries from the app's "Catering" tile: a party, a wedding,
-- an office lunch. Same shape of lead as a table reservation, looser
-- rules — any guest count, any date up to four months out, optional
-- time, and the restaurant settles menu and price by phone. `status`
-- is a plain string with a CHECK (the gift-card convention) rather
-- than a new enum: the words match the reservation book's.
CREATE TABLE "catering_requests" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "venue_id"    TEXT NOT NULL,
  "customer_id" TEXT,
  "name"        TEXT NOT NULL,
  "phone"       TEXT NOT NULL,
  "email"       TEXT,
  "guests"      INTEGER NOT NULL,
  "date"        TEXT NOT NULL,
  "time"        TEXT,
  "location"    TEXT,
  "message"     TEXT,
  "status"      TEXT NOT NULL DEFAULT 'requested',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "catering_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catering_requests_venue_id_fkey" FOREIGN KEY ("venue_id")
    REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "catering_requests_customer_id_fkey" FOREIGN KEY ("customer_id")
    REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "catering_requests_status_check"
    CHECK ("status" IN ('requested', 'confirmed', 'declined', 'cancelled')),
  CONSTRAINT "catering_requests_guests_check" CHECK ("guests" > 0)
);
CREATE INDEX "catering_requests_tenant_id_date_idx" ON "catering_requests"("tenant_id", "date");

-- Same tenant-isolation posture as every other tenant table.
ALTER TABLE "catering_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catering_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catering_requests"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- Guarded on the role existing: production connects as the owner, where
-- elvoria_app is absent and a bare GRANT would abort `migrate deploy`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "catering_requests" TO elvoria_app;
  END IF;
END
$$;
