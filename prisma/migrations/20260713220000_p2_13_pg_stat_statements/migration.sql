-- P2-13: enable the pg_stat_statements extension for slow-query monitoring.
--
-- pg_stat_statements collects its samples inside a shared-memory hook that
-- must be attached at server start via `shared_preload_libraries`. dev
-- (docker-compose) + prod (IONOS Managed Postgres) both set the preload;
-- GitHub Actions services do not support a CMD override, so CI runs
-- without the preload. The DO block below lets `CREATE EXTENSION` fail
-- gracefully in CI so `prisma migrate deploy` stays green there — the
-- slow-query-report code in `src/lib/slow-query-report.ts` checks
-- `isPgStatStatementsAvailable()` before touching the view, and the
-- vitest suite skips on CI when the extension is not loaded (mirrors
-- the pgbouncer skip pattern from P2-11).

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_stat_statements unavailable (shared_preload_libraries?): %', SQLERRM;
END $$;
