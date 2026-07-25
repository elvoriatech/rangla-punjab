-- Restore-drill input fixture (P2-7). Left intentionally empty today —
-- `scripts/restore-drill.ts` treats an empty file as "no pre-existing
-- data to restore, start from scratch, then apply migrations + seed".
-- In production this file is replaced by a real `pg_dump` of a known
-- prod state; the drill then confirms that a restore of that dump
-- through the current migrations still lands at the checksum
-- committed in `restore-drill.golden.json`. Anything a `pg_dump`
-- would carry on top of an empty schema is legal here; the SQL is
-- executed by `psql` after the scratch database is created but before
-- migrations run.

-- placeholder statement so `psql -f` on an "empty" file is a no-op.
SELECT 1 WHERE FALSE;
