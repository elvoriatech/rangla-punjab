-- Link a reservation to the signed-in guest who requested it, so "my
-- reservations" can be read back on any device. Nullable: the menu's
-- reservation dialog still works signed out, and every row that exists
-- today was made anonymously.
--
-- ON DELETE SET NULL, not CASCADE: a guest deleting their account must
-- not delete the restaurant's book for tonight — the table request
-- simply loses its account link and stays an ordinary anonymous row.
--
-- RLS: `reservations` already has ENABLE/FORCE ROW LEVEL SECURITY and the
-- `tenant_isolation` policy from 20260824151037_reservations, and the
-- policy is column-agnostic, so a new column inherits it. Nothing to
-- re-grant either: the table-level GRANT to elvoria_app already covers
-- every column.
ALTER TABLE "reservations" ADD COLUMN "customer_id" TEXT;

CREATE INDEX "reservations_tenant_id_customer_id_idx"
  ON "reservations"("tenant_id", "customer_id");

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_customer_id_fkey" FOREIGN KEY ("customer_id")
  REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
