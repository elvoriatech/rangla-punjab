-- P1-12: `list_public_venues()` — enumerate every venue that has ever
-- published, so the public sitemap.xml can include them without an
-- authenticated tenant GUC.
--
-- Same posture as P1-9's `resolve_public_venue(slug)`: SECURITY DEFINER,
-- narrow projection (slug + enabled locales + last-updated), EXECUTE
-- granted only to the least-privilege app role. Unpublished venues are
-- excluded — the sitemap must not leak an in-progress restaurant name
-- via URL enumeration.

CREATE OR REPLACE FUNCTION list_public_venues()
RETURNS TABLE(
  slug             text,
  default_locale   text,
  enabled_locales  text[],
  updated_at       timestamp(3)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.slug, v.default_locale, v.enabled_locales, v."updatedAt"
  FROM venues v
  JOIN menus m ON m.venue_id = v.id
  WHERE v."deletedAt" IS NULL
    AND m.published_version IS NOT NULL
    AND m."deletedAt" IS NULL
$$;

REVOKE ALL ON FUNCTION list_public_venues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_public_venues() TO elvoria_app;
