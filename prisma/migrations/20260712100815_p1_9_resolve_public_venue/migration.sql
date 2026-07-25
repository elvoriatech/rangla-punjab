-- P1-9 / P1-10: `resolve_public_venue(slug)` — the one narrow crack in
-- venues RLS that lets a public request map a URL slug to (venue_id,
-- tenant_id) without an authenticated tenant GUC yet.
--
-- Same posture as `resolve_active_tenant(uid)` from P1-1: SECURITY DEFINER
-- owned by the superuser, EXECUTE granted only to the least-privilege app
-- role, and the query is narrow (slug lookup, one row). Once the caller
-- has (venue_id, tenant_id), it sets the tenant GUC and normal RLS kicks
-- back in for every subsequent read.

CREATE OR REPLACE FUNCTION resolve_public_venue(venue_slug text)
RETURNS TABLE(venue_id text, tenant_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id
  FROM venues
  WHERE slug = venue_slug AND "deletedAt" IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_public_venue(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_public_venue(text) TO elvoria_app;
