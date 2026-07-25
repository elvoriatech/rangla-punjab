-- P4: order types (dine-in / takeaway / delivery), plan-based
-- entitlements, and the platform-admin seam.
--
-- Hand-written (see 20260714145857 note: `prisma migrate dev` chokes on
-- the partitioned audit/scan tables, so migrations are authored by hand
-- and applied with `prisma migrate deploy`).

-- Tenants carry a plan; Elvoria admin can override individual features
-- per tenant (trials, abuse shut-offs) without inventing a new plan.
ALTER TABLE tenants ADD COLUMN plan text NOT NULL DEFAULT 'standard';
ALTER TABLE tenants ADD COLUMN entitlement_overrides jsonb NOT NULL DEFAULT '{}';
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check
  CHECK (plan IN ('starter', 'standard', 'pro'));

-- Platform staff flag. Deliberately on users, not memberships: Elvoria
-- admins are not members of any tenant.
ALTER TABLE users ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

-- Per-venue ordering configuration (owner's own switches + delivery
-- zones/fees). JSONB so the shape can evolve like onboarding_state.
ALTER TABLE venues ADD COLUMN ordering jsonb NOT NULL DEFAULT '{}';

-- Orders learn their fulfilment context.
ALTER TABLE orders ADD COLUMN order_type text NOT NULL DEFAULT 'dine_in';
ALTER TABLE orders ADD COLUMN customer_name text;
ALTER TABLE orders ADD COLUMN customer_phone text;
ALTER TABLE orders ADD COLUMN delivery_address jsonb;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check
  CHECK (order_type IN ('dine_in', 'takeaway', 'delivery'));

-- Platform-admin read seam. Same posture as list_public_venues():
-- SECURITY DEFINER because every tenant table is FORCE RLS; narrow
-- projection; EXECUTE granted to the app role only. The app gates the
-- calling route behind users.is_platform_admin.
CREATE OR REPLACE FUNCTION admin_list_tenants()
RETURNS TABLE(
  id                    text,
  name                  text,
  status                text,
  plan                  text,
  entitlement_overrides jsonb,
  created_at            timestamp(3),
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
    v.name, v.slug,
    (SELECT count(*) FROM orders o
      WHERE o.tenant_id = t.id
        AND o."createdAt" >= date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'),
    (SELECT count(*) FROM orders o
      WHERE o.tenant_id = t.id AND o."createdAt" >= now() - interval '30 days'),
    (SELECT coalesce(sum(o.total_cents), 0) FROM orders o
      WHERE o.tenant_id = t.id AND o."createdAt" >= now() - interval '30 days')
  FROM tenants t
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

-- Plan changes from the admin panel. DEFINER for the same RLS reason;
-- validated by the same CHECK constraint as direct writes.
CREATE OR REPLACE FUNCTION admin_set_tenant_plan(p_tenant_id text, p_plan text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE tenants SET plan = p_plan, "updatedAt" = now()
  WHERE id = p_tenant_id AND "deletedAt" IS NULL
$$;

REVOKE ALL ON FUNCTION admin_set_tenant_plan(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_tenant_plan(text, text) TO elvoria_app;
