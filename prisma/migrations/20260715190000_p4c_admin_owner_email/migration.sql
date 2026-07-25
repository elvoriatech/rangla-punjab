-- P4c: admin_list_tenants v3 — adds the owner's email so the platform
-- console can send plan/trial reminders with one click. Return type
-- changes, so drop + recreate. Hand-written (partitioned-table
-- constraint; see earlier migrations).

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
  sub_plan              text,
  sub_status            text,
  sub_trial_end         timestamp(3),
  sub_period_end        timestamp(3),
  venue_name            text,
  venue_slug            text,
  orders_today          bigint,
  orders_30d            bigint,
  revenue_30d_cents     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.name, t.status::text, t.plan, t.entitlement_overrides, t."createdAt",
    o.email,
    s.plan_code, s.status::text, s.trial_end, s.current_period_end,
    v.name, v.slug,
    (SELECT count(*) FROM orders ord
      WHERE ord.tenant_id = t.id
        AND ord."createdAt" >= date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'),
    (SELECT count(*) FROM orders ord
      WHERE ord.tenant_id = t.id AND ord."createdAt" >= now() - interval '30 days'),
    (SELECT coalesce(sum(ord.total_cents), 0) FROM orders ord
      WHERE ord.tenant_id = t.id AND ord."createdAt" >= now() - interval '30 days')
  FROM tenants t
  LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT u.email::text AS email
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
