-- migration:expand-contract
--
-- CONTRACT half: drop the platform-subscription table.
--
-- This build serves one restaurant. It is not a SaaS tenant paying the
-- platform a monthly fee, so nothing writes this table and nothing reads
-- it: resolveTenantAccess stopped consulting subscriptions some time ago
-- (it takes the argument and ignores it), and the same commit that adds
-- this migration removed the last four readers — order-service (x2),
-- venue-service and reservation-service each fetched a row only to hand
-- it to that function — along with billing-service and the Stripe
-- subscription/invoice webhook branches.
--
-- The EXPAND half is those code removals: by the time this runs, no
-- deployed code path touches `subscriptions`. Dropping the table is
-- therefore the contract step, not a destructive change racing live
-- readers.
--
-- Data: subscription rows are destroyed. On this deployment there are
-- none that matter — the restaurant is billed directly, never through
-- Stripe Billing in this app. Recovery, if ever needed, is the nightly
-- pg_dump (deploy/db-server-setup.md).
--
-- Policies and indexes on the table (including the partial unique on
-- tenant_id WHERE deleted_at IS NULL) drop with it; the enum is dropped
-- afterwards because the column that used it is gone.

DROP TABLE IF EXISTS "subscriptions";

DROP TYPE IF EXISTS "SubscriptionStatus";

-- admin_list_tenants() LEFT JOINed `subscriptions`, so the DROP above would
-- leave /admin raising `relation "subscriptions" does not exist` on every
-- load. Recreate it without that join and without the four sub_* output
-- columns. The paginated overload is dropped outright: it existed for the
-- /admin/restaurants table, which is gone.
DROP FUNCTION IF EXISTS admin_list_tenants(integer, integer, text);
DROP FUNCTION IF EXISTS admin_list_tenants();

CREATE FUNCTION admin_list_tenants()
RETURNS TABLE(
  id text, name text, status text, deleted_at timestamp without time zone,
  plan_override text, entitlement_overrides jsonb,
  created_at timestamp without time zone,
  owner_email text, owner_verified boolean,
  onboarding_state jsonb, has_published boolean,
  venue_name text, venue_slug text,
  orders_today bigint, orders_30d bigint, revenue_30d_cents bigint,
  scans_30d bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    t.id, t.name, t.status::text, t."deletedAt", t.plan, t.entitlement_overrides, t."createdAt",
    o.email, o.verified,
    t.onboarding_state,
    EXISTS (
      SELECT 1 FROM menus m
      WHERE m.tenant_id = t.id AND m.published_version IS NOT NULL AND m."deletedAt" IS NULL
    ),
    v.name, v.slug,
    (SELECT count(*) FROM orders ord
      WHERE ord.tenant_id = t.id
        AND ord."createdAt" >= date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'),
    (SELECT count(*) FROM orders ord
      WHERE ord.tenant_id = t.id AND ord."createdAt" >= now() - interval '30 days'),
    (SELECT coalesce(sum(ord.total_cents), 0) FROM orders ord
      WHERE ord.tenant_id = t.id AND ord."createdAt" >= now() - interval '30 days'),
    (SELECT count(*) FROM scan_stats sc
      WHERE sc.tenant_id = t.id AND sc.at >= now() - interval '30 days')
  FROM tenants t
  LEFT JOIN LATERAL (
    SELECT u.email::text AS email, (u.email_verified_at IS NOT NULL) AS verified
    FROM memberships m
    JOIN users u ON u.id = m.user_id AND u."deletedAt" IS NULL
    WHERE m.tenant_id = t.id AND m.role = 'owner'
    ORDER BY m."createdAt" ASC LIMIT 1
  ) o ON true
  LEFT JOIN LATERAL (
    SELECT vv.name, vv.slug FROM venues vv
    WHERE vv.tenant_id = t.id AND vv."deletedAt" IS NULL
    ORDER BY vv."createdAt" ASC LIMIT 1
  ) v ON true
  ORDER BY t."createdAt" DESC
$function$;

GRANT EXECUTE ON FUNCTION admin_list_tenants() TO elvoria_app;
