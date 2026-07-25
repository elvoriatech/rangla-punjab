-- P1-1: `resolve_active_tenant(uid)` — the one function permitted to read the
-- memberships table without a tenant GUC set.
--
-- Why SECURITY DEFINER: `memberships` is RLS-locked to the active tenant, but
-- the auth pipeline needs to *pick* the tenant before any GUC has been set.
-- A SECURITY DEFINER function owned by the migration/superuser role bypasses
-- RLS for exactly this one, narrowly-scoped read. `EXECUTE` is granted only
-- to the least-privilege app role, so no other path around RLS is opened.
--
-- Ordering: owner memberships beat staff; ties broken by oldest membership.

CREATE OR REPLACE FUNCTION resolve_active_tenant(uid text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id
  FROM memberships
  WHERE user_id = uid
  ORDER BY (CASE role WHEN 'owner' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END),
           "createdAt"
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_active_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_active_tenant(text) TO elvoria_app;
