-- P1-4: server-persisted onboarding wizard state.
--
-- `onboarding_state` holds the partial form: which step the user is on, the
-- venue name they typed, the import branch they chose, and their branding
-- picks. Every step writes here; the final step materialises a `venues` row
-- from the state and stamps `onboarding_completed_at`, at which point the
-- state can be ignored (kept for audit rather than deleted).
--
-- JSONB (not one column per field) so the shape can evolve as we add steps
-- without a migration each time. RLS still applies via the `tenants` policy.

ALTER TABLE "tenants"
  ADD COLUMN "onboarding_state" JSONB NOT NULL DEFAULT '{"step":1}',
  ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);
