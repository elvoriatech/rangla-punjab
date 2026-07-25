-- Local-dev least-privilege application role.
-- RLS is bypassed by superusers and BYPASSRLS roles, so the app must connect as a
-- plain LOGIN role for tenant isolation to hold. Migrations still run as the
-- superuser (DATABASE_URL); the app/tests connect as this role (APP_DATABASE_URL).
-- In production this role is provisioned by IaC, not by this script.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    CREATE ROLE elvoria_app LOGIN PASSWORD 'elvoria_app_dev';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO elvoria_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO elvoria_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO elvoria_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO elvoria_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO elvoria_app;
