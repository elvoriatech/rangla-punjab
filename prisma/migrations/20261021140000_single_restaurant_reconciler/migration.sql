-- Single-restaurant build (architect review, 2026-10-21): background jobs
-- and owner scripts resolve the ONE restaurant (RESTAURANT_SLUG →
-- resolve_public_venue) and work inside its tenant scope, like the public
-- menu does. No cross-tenant RLS policies: the reconciler's read-only
-- policy from 20261021130000 is removed. tenant_id + FORCE RLS stay on
-- every table, payment_attempts included.
DROP POLICY IF EXISTS payment_reconciler_read ON "payment_attempts";
