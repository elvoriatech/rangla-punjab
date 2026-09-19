-- P7-17: 'cancelled' joins the order lifecycle.
--
-- The status column is plain text guarded by a CHECK, so widening the
-- lifecycle means replacing that constraint. Postgres has no "ALTER
-- CONSTRAINT ... CHECK", and a second constraint would AND with the first
-- (rejecting exactly the value we are adding), so the old one is dropped
-- and re-added with the new member in the same statement pair.
--
-- Purely widening: every value the old constraint accepted the new one
-- accepts too, so no existing row can fail the re-add and there is no
-- window in which a valid write is refused (both statements run inside
-- the migration's transaction).
--
-- The service layer (src/lib/order-status.ts) stays the transition
-- authority — this is only the backstop that keeps a bug from writing a
-- status no surface knows how to render.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_status_check";

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_status_check"
  CHECK ("status" IN ('placed', 'preparing', 'ready', 'out_for_delivery', 'done', 'cancelled'));
