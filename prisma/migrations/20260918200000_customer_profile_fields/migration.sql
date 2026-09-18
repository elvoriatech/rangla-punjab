-- Guest profile fields the checkout actually needs. `phone` already exists
-- (created with the table, never written); this adds the address half so a
-- returning guest never re-types where the food goes. Same JSON shape as
-- orders.delivery_address ({street, zip, city?, note?}); "last used"
-- semantics — every delivery order overwrites it.
--
-- Purely additive: the customers table already carries tenant_id and the
-- tenant_isolation RLS policy from 20260816180000_customers, and column
-- privileges are table-wide, so no policy or GRANT change is needed.
ALTER TABLE "customers" ADD COLUMN "last_delivery_address" JSONB;
