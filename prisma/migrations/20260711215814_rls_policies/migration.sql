-- Row-Level Security: tenant isolation on every tenant-scoped table.
-- Isolation boundary = the database, not app code (roadmap §6, spec §5).
--
-- The active tenant is carried in the Postgres session GUC `app.current_tenant_id`,
-- set per request/transaction via `SET LOCAL app.current_tenant_id = '<id>'`.
-- current_setting(..., true) returns NULL when unset -> policy denies all rows
-- (safe by default). FORCE ROW LEVEL SECURITY makes the policy apply even to the
-- table owner, so a missing GUC can never leak data in any environment.

-- ---- tenants (keyed on id, since the tenant row IS the tenant) ----
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenants"
  USING (id = current_setting('app.current_tenant_id', true))
  WITH CHECK (id = current_setting('app.current_tenant_id', true));

-- ---- tenant_id-scoped tables ----
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'memberships','venues','menus','menu_versions','categories','items',
    'item_variants','translations','media','subscriptions','audit_events'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
      || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
      t
    );
  END LOOP;
END $$;