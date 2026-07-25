-- P2-10: cold-storage schema for detached analytics partitions.
--
-- The partition-manager job detaches monthly children older than the
-- retention window (12 months for scan_stats, 24 for audit_events by
-- default, see env in `src/lib/partition-manager.ts`) and moves them
-- here. Kept under a separate schema so read-only ETL / auditors can
-- be granted USAGE on `archive` without ever touching `public`.

CREATE SCHEMA IF NOT EXISTS archive;

-- The app role (RLS-enforced) never queries archive — only migration
-- + partition-manager code touches it. Grants are scoped so the app
-- role literally cannot read archived data through Prisma.
GRANT USAGE ON SCHEMA archive TO elvoria;
