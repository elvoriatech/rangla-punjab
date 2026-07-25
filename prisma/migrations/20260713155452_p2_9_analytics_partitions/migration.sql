-- migration:expand-contract
-- P2-9: reshape analytics tables into monthly range-partitioned parents.
--
-- The two existing tables (`scan_stats` as aggregate counters, `audit_events`
-- as a flat log) were both empty in every environment we've touched (no
-- prod launch yet). PARTITION BY has no `ALTER TABLE ... PARTITION BY`
-- variant in Postgres, so the tables must be DROPped and recreated from
-- scratch. The whole-file `-- migration:expand-contract` marker at the
-- very top tells the P2-8 gate this is a deliberate destructive change
-- with no data to preserve.
--
-- Partition management (auto-create next months, detach old ones) lands
-- in P2-10 as a BullMQ cron. This migration just ships the parent
-- tables + a bootstrap set of children covering July/August/September
-- 2026 so the app boots on today's clock without an empty-partition
-- error.

-- ---------- Drop the old shape --------------------------------------

ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "audit_events_tenant_id_fkey";
ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "audit_events_user_id_fkey";
ALTER TABLE "scan_stats" DROP CONSTRAINT IF EXISTS "scan_stats_venue_id_fkey";
DROP TABLE IF EXISTS "audit_events";
DROP TABLE IF EXISTS "scan_stats";

-- ---------- scan_stats: partitioned parent + monthly children -------

CREATE TABLE "scan_stats" (
    "id"              TEXT        NOT NULL,
    "tenant_id"       TEXT        NOT NULL,
    "venue_id"        TEXT        NOT NULL,
    "path"            TEXT        NOT NULL,
    "ua_class"        TEXT        NOT NULL,
    "referrer_class"  TEXT        NOT NULL,
    "at"              TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "scan_stats_pkey" PRIMARY KEY ("id", "at")
) PARTITION BY RANGE ("at");

CREATE INDEX "scan_stats_venue_id_at_idx"  ON "scan_stats" ("venue_id", "at");
CREATE INDEX "scan_stats_tenant_id_at_idx" ON "scan_stats" ("tenant_id", "at");

-- Bootstrap child partitions. P2-10 will roll these forward monthly.
CREATE TABLE "scan_stats_2026_07" PARTITION OF "scan_stats"
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "scan_stats_2026_08" PARTITION OF "scan_stats"
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "scan_stats_2026_09" PARTITION OF "scan_stats"
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

-- ---------- audit_events: same shape, longer retention window -------

CREATE TABLE "audit_events" (
    "id"             TEXT        NOT NULL,
    "tenant_id"      TEXT        NOT NULL,
    "actor_user_id"  TEXT,
    "kind"           TEXT        NOT NULL,
    "target_kind"    TEXT        NOT NULL,
    "target_id"      TEXT        NOT NULL,
    "meta"           JSONB       NOT NULL DEFAULT '{}',
    "at"             TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id", "at")
) PARTITION BY RANGE ("at");

CREATE INDEX "audit_events_tenant_id_at_idx"     ON "audit_events" ("tenant_id", "at");
CREATE INDEX "audit_events_actor_user_id_at_idx" ON "audit_events" ("actor_user_id", "at");

CREATE TABLE "audit_events_2026_07" PARTITION OF "audit_events"
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "audit_events_2026_08" PARTITION OF "audit_events"
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "audit_events_2026_09" PARTITION OF "audit_events"
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

-- ---------- RLS -----------------------------------------------------
-- Same policy shape every other tenant-scoped table uses (see
-- 20260711215814_rls_policies). Applied to the parent — Postgres 13+
-- propagates the policy to every child partition automatically.

ALTER TABLE "scan_stats"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scan_stats"   FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scan_stats"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_events"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
