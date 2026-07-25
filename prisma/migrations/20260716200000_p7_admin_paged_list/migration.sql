-- P7: paged + searchable variant of the admin tenant listing, so the
-- console's default view stays fast at tens of thousands of tenants.
-- The zero-arg admin_list_tenants() stays for aggregate consumers
-- (dashboard totals, announcements); this overload serves the table.
-- The per-row order/scan subqueries only execute for the LIMITed rows.
-- Hand-written (partitioned-table constraint; see earlier migrations).

CREATE OR REPLACE FUNCTION admin_list_tenants(p_limit int, p_offset int, p_q text)
RETURNS TABLE(
  id                    text,
  name                  text,
  status                text,
  deleted_at            timestamp(3),
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
  scans_30d             bigint,
  total_count           bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT t.id AS tid, t."createdAt" AS created,
           o.email AS owner_email, o.verified AS owner_verified,
           v.name AS venue_name, v.slug AS venue_slug
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
    WHERE (p_q IS NULL OR p_q = ''
           OR t.name ILIKE '%' || p_q || '%'
           OR v.name ILIKE '%' || p_q || '%'
           OR v.slug ILIKE '%' || p_q || '%'
           OR o.email ILIKE '%' || p_q || '%')
  ),
  page AS (
    SELECT *, count(*) OVER () AS total_count FROM matched
    ORDER BY created DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
  )
  SELECT
    t.id, t.name, t.status::text, t."deletedAt", t.plan, t.entitlement_overrides, t."createdAt",
    page.owner_email, page.owner_verified,
    t.onboarding_state,
    EXISTS (
      SELECT 1 FROM menus m
      WHERE m.tenant_id = t.id AND m.published_version IS NOT NULL AND m."deletedAt" IS NULL
    ),
    s.plan_code, s.status::text, s.trial_end, s.current_period_end,
    page.venue_name, page.venue_slug,
    (SELECT count(*) FROM orders ord
      WHERE ord.tenant_id = t.id
        AND ord."createdAt" >= date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'),
    (SELECT count(*) FROM orders ord
      WHERE ord.tenant_id = t.id AND ord."createdAt" >= now() - interval '30 days'),
    (SELECT coalesce(sum(ord.total_cents), 0) FROM orders ord
      WHERE ord.tenant_id = t.id AND ord."createdAt" >= now() - interval '30 days'),
    (SELECT count(*) FROM scan_stats sc
      WHERE sc.tenant_id = t.id AND sc.at >= now() - interval '30 days'),
    page.total_count
  FROM page
  JOIN tenants t ON t.id = page.tid
  LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.deleted_at IS NULL
  ORDER BY t."createdAt" DESC
$$;

REVOKE ALL ON FUNCTION admin_list_tenants(int, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_tenants(int, int, text) TO elvoria_app;
