-- P1-19a: extend subscriptions for the P1-19 Stripe integration.
--
-- Schema changes:
--   • Rename `plan` → `plan_code` so the meaning matches the PLANS map key
--     it references (`starter`|`growth`|`scale`).
--   • Add `trial_end`, `cancel_at`, `deleted_at` — needed by the dunning +
--     cancel state machine (P1-19c/d) and the soft-delete convention
--     (CLAUDE.md).
--   • Swap the tenant-wide `@unique` for a *partial* unique that skips
--     soft-deleted rows: `UNIQUE (tenant_id) WHERE deleted_at IS NULL`.
--     Otherwise a soft-deleted subscription would block re-subscribing.
--
-- Enum changes: add `grace` + `incomplete` (dunning states), rename the
-- existing `cancelled` to `canceled` to match Stripe's US spelling.

ALTER TABLE "subscriptions" RENAME COLUMN "plan" TO "plan_code";
ALTER TABLE "subscriptions" ADD COLUMN "trial_end" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- PG 10+ can rename enum values in place. Safe because there are no rows yet.
ALTER TYPE "SubscriptionStatus" RENAME VALUE 'cancelled' TO 'canceled';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'grace' AFTER 'past_due';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'incomplete' AFTER 'canceled';

-- Replace the total-uniqueness with a partial one that lets a soft-deleted
-- subscription coexist with an active one for the same tenant.
DROP INDEX IF EXISTS "subscriptions_tenant_id_key";
CREATE UNIQUE INDEX "subscriptions_tenant_id_active"
  ON "subscriptions"("tenant_id")
  WHERE "deleted_at" IS NULL;
