-- Grant the least-privilege app role access to webhook_events.
--
-- New tables are NOT covered by the ALTER DEFAULT PRIVILEGES in
-- prisma/dev-roles.sql (those apply only to tables created by the role
-- that set them), so every migration that adds a table also grants it —
-- same pattern as the reservations and customers migrations. Without
-- this the webhook route fails with "permission denied for table
-- webhook_events" and Stripe retries forever.
--
-- No RLS policy: webhook_events has no tenant_id. The de-duplication
-- guard is deliberately global, and an event id is opaque.
--
-- Guarded on the role existing, unlike the earlier migrations that name
-- elvoria_app unconditionally: production runs RLS-off with the app
-- connected as the database owner, where that role is absent and a bare
-- GRANT would abort `prisma migrate deploy`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_events" TO elvoria_app;
  END IF;
END
$$;
