-- P4b: one plan system. `tenants.plan` becomes a nullable ADMIN OVERRIDE
-- (NULL = follow the Stripe subscription, the normal state). Vocabulary
-- unifies on the billing plan codes: starter / growth / scale — the
-- interim standard/pro values from P4 are retired.
--
-- Hand-written (partitioned-table constraint; see earlier migrations).

ALTER TABLE tenants ALTER COLUMN plan DROP DEFAULT;
ALTER TABLE tenants ALTER COLUMN plan DROP NOT NULL;
ALTER TABLE tenants DROP CONSTRAINT tenants_plan_check;
UPDATE tenants SET plan = CASE plan
  WHEN 'pro'  THEN 'scale'   -- manual Pro grants keep their features
  ELSE NULL                  -- standard/starter defaults → follow subscription
END;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check
  CHECK (plan IS NULL OR plan IN ('starter', 'growth', 'scale'));

-- admin_list_tenants v2: subscription context for the console. Return
-- type changes, so drop + recreate.
DROP FUNCTION IF EXISTS admin_list_tenants();
CREATE FUNCTION admin_list_tenants()
RETURNS TABLE(
  id                    text,
  name                  text,
  status                text,
  plan_override         text,
  entitlement_overrides jsonb,
  created_at            timestamp(3),
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
    s.plan_code, s.status::text, s.trial_end, s.current_period_end,
    v.name, v.slug,
    (SELECT count(*) FROM orders o
      WHERE o.tenant_id = t.id
        AND o."createdAt" >= date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'),
    (SELECT count(*) FROM orders o
      WHERE o.tenant_id = t.id AND o."createdAt" >= now() - interval '30 days'),
    (SELECT coalesce(sum(o.total_cents), 0) FROM orders o
      WHERE o.tenant_id = t.id AND o."createdAt" >= now() - interval '30 days')
  FROM tenants t
  LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.deleted_at IS NULL
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

-- admin_set_tenant_plan v2: 'follow' clears the override (NULL).
CREATE OR REPLACE FUNCTION admin_set_tenant_plan(p_tenant_id text, p_plan text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE tenants SET plan = NULLIF(p_plan, 'follow'), "updatedAt" = now()
  WHERE id = p_tenant_id AND "deletedAt" IS NULL
    AND p_plan IN ('follow', 'starter', 'growth', 'scale')
$$;

REVOKE ALL ON FUNCTION admin_set_tenant_plan(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_tenant_plan(text, text) TO elvoria_app;
