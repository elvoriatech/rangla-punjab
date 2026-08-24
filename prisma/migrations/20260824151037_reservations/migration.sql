-- Table reservations, requested from the public menu and confirmed by
-- the restaurant. Same tenant-isolation posture as every tenant table.
CREATE TYPE "ReservationStatus" AS ENUM ('requested', 'confirmed', 'declined', 'cancelled');

CREATE TABLE "reservations" (
  "id"         TEXT NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "venue_id"   TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "phone"      TEXT NOT NULL,
  "guests"     INTEGER NOT NULL,
  "at"         TIMESTAMP(3) NOT NULL,
  "date"       TEXT NOT NULL,
  "time"       TEXT NOT NULL,
  "note"       TEXT,
  "status"     "ReservationStatus" NOT NULL DEFAULT 'requested',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservations_venue_id_fkey" FOREIGN KEY ("venue_id")
    REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "reservations_tenant_id_at_idx" ON "reservations"("tenant_id", "at");

ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reservations"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "reservations" TO elvoria_app;
