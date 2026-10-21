-- Durable capture (owner, 2026-10-21, final verification): an attempt is
-- marked "capturing" in its own committed transaction BEFORE the provider
-- is asked to take the money, so a crash between the capture and our
-- database write leaves a row the reconciler finds and finishes. The
-- 45-minute rule is judged on when the guest AUTHORIZED, recorded here.
ALTER TABLE "payment_attempts" ADD COLUMN "authorized_at" TIMESTAMPTZ(3);
ALTER TABLE "payment_attempts" ADD COLUMN "capture_started_at" TIMESTAMPTZ(3);
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_status_check";
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_status_check"
  CHECK ("status" IN ('open', 'capturing', 'succeeded', 'failed', 'expired', 'cancelled'));

-- The reconciler serves every tenant, so it runs with no tenant selected.
-- Production connects as the (non-superuser) database owner, and FORCE ROW
-- LEVEL SECURITY applies to it — a SECURITY DEFINER function would see no
-- rows either. So the reconciler gets one extra, READ-ONLY policy, enabled
-- only by a transaction-local setting it sets itself; it then does all of
-- its work inside each tenant's own scope (app.current_tenant_id).
CREATE POLICY payment_reconciler_read ON "payment_attempts"
  FOR SELECT
  USING (current_setting('app.payment_reconciler', true) = 'on');
