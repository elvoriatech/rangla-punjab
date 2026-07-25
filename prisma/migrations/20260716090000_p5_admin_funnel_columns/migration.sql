-- P5: admin_list_tenants v4 — onboarding-funnel columns for the platform
-- console (onboarding step, owner email verified, menu published, scans).
-- Return type changes, so drop + recreate. Hand-written (partitioned-
-- table constraint; see earlier migrations).

DROP FUNCTION IF EXISTS admin_list_tenants();
CREATE FUNCTION admin_list_tenants()
RETURNS TABLE(
  id                    text,
  name                  text,
  status                text,
  plan_override         text,
  entitlement_overrides jsonb,
  created_at            timestamp(3),
  owner_email           text,
  owner_verified        boolean,
  onboarding_state      jsonb,
  has_published         boolean,
  sub_plan              text,
  sub_status            text,
  sub_trial_end         timestamp(3),
  sub_period_end        timestamp(3),
  venue_name            text,
  venue_slug            text,
  orders_today          bigint,
  orders_30d            bigint,
  revenue_30d_cents     bigint,
  scans_30d             bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.name, t.status::text, t.plan, t.entitlement_overrides, t."createdAt",
    o.email, o.verified,
    t.onboarding_state,
    EXISTS (
      SELECT 1 FROM menus m
      WHERE m.tenant_id = t.id AND m.published_version IS NOT NULL AND m."deletedAt" IS NULL
    ),
    s.plan_code, s.status::text, s.trial_end, s.current_period_end,
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
  LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.deleted_at IS NULL
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
  WHERE t."deletedAt" IS NULL
  ORDER BY t."createdAt" DESC
$$;

REVOKE ALL ON FUNCTION admin_list_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_tenants() TO elvoria_app;
