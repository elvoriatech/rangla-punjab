import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * P2-10 partition manager. Pure, testable functions plus a
 * BullMQ-registration helper. `maintainPartitions(now, opts)` is the
 * only entry point the cron calls — pass a real `Date` from
 * production, pass a fixed one in vitest.
 *
 * Two things happen on each run:
 *
 *   1. Roll monthly children forward. For each of the two partitioned
 *      parents (`scan_stats`, `audit_events`), attach the current
 *      month plus the next `AHEAD_MONTHS` (3 by default) if they do
 *      not already exist. Attaching an existing partition would
 *      throw, so we look up `pg_inherits` first — idempotent by
 *      construction.
 *
 *   2. Move partitions older than the retention window to the
 *      `archive.` schema. Retention is env-configurable:
 *         SCAN_STATS_RETENTION_MONTHS   (default 12)
 *         AUDIT_EVENTS_RETENTION_MONTHS (default 24)
 *      A "move" is `ALTER TABLE ... DETACH PARTITION` followed by
 *      `ALTER TABLE ... SET SCHEMA archive`. Once detached, the
 *      table is a plain-standalone table under `archive.` and no
 *      longer participates in RLS on the parent (the archive schema
 *      is grant-scoped to the migration superuser + auditors only,
 *      never the RLS-app role).
 *
 * Uses the superuser connection because DETACH / SET SCHEMA require
 * owner permissions the RLS-app role does not have.
 */

export const PARTITIONED_TABLES = ["scan_stats", "audit_events"] as const;
export type PartitionedTable = (typeof PARTITIONED_TABLES)[number];

export const DEFAULT_AHEAD_MONTHS = 3;

export interface MaintainOptions {
  aheadMonths?: number;
  scanStatsRetentionMonths?: number;
  auditEventsRetentionMonths?: number;
}

export interface MaintainResult {
  created: string[];
  archived: string[];
}

/** Format the child partition name for a given parent + month. */
export function partitionName(parent: PartitionedTable, year: number, month: number): string {
  const mm = String(month).padStart(2, "0");
  return `${parent}_${year}_${mm}`;
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, delta: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface DbLike {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
}

/**
 * Idempotent partition maintenance. Returns the names of children
 * created and detached-to-archive this run so tests + logs can assert.
 */
export async function maintainPartitions(
  db: DbLike,
  now: Date,
  opts: MaintainOptions = {},
): Promise<MaintainResult> {
  const aheadMonths = opts.aheadMonths ?? DEFAULT_AHEAD_MONTHS;
  const scanRetention =
    opts.scanStatsRetentionMonths ?? Number(process.env.SCAN_STATS_RETENTION_MONTHS ?? 12);
  const auditRetention =
    opts.auditEventsRetentionMonths ?? Number(process.env.AUDIT_EVENTS_RETENTION_MONTHS ?? 24);

  const created: string[] = [];
  const archived: string[] = [];

  // ---- 1. Roll forward ------------------------------------------------
  const start = firstOfMonth(now);
  for (const parent of PARTITIONED_TABLES) {
    for (let i = 0; i <= aheadMonths; i += 1) {
      const monthStart = addMonths(start, i);
      const monthEnd = addMonths(start, i + 1);
      const name = partitionName(parent, monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1);
      if (await partitionExists(db, name)) continue;
      await db.$executeRawUnsafe(
        `CREATE TABLE "${name}" PARTITION OF "${parent}" FOR VALUES FROM ('${isoDate(monthStart)}') TO ('${isoDate(monthEnd)}')`,
      );
      created.push(name);
    }
  }

  // ---- 2. Archive old months -----------------------------------------
  for (const parent of PARTITIONED_TABLES) {
    const retention = parent === "scan_stats" ? scanRetention : auditRetention;
    const cutoff = addMonths(firstOfMonth(now), -retention);
    const olderChildren = await listChildrenOlderThan(db, parent, cutoff);
    for (const child of olderChildren) {
      await db.$executeRawUnsafe(`ALTER TABLE "${parent}" DETACH PARTITION "${child}"`);
      await db.$executeRawUnsafe(`ALTER TABLE "${child}" SET SCHEMA archive`);
      archived.push(child);
    }
  }

  return { created, archived };
}

async function partitionExists(db: DbLike, name: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = $1
          AND n.nspname IN ('public', 'archive')
     ) AS "exists"`,
    name,
  );
  return Boolean(rows[0]?.exists);
}

/**
 * List children of `parent` whose `FOR VALUES FROM (...)` lower bound
 * is strictly earlier than `cutoff`. Reads the child bound out of
 * `pg_get_expr(relpartbound, oid)` which returns text like
 * `FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00')`.
 */
async function listChildrenOlderThan(
  db: DbLike,
  parent: PartitionedTable,
  cutoff: Date,
): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ child: string; lower_bound: string }[]>(
    `SELECT c.relname AS child,
            pg_get_expr(c.relpartbound, c.oid) AS lower_bound
       FROM pg_inherits i
       JOIN pg_class c        ON c.oid = i.inhrelid
       JOIN pg_class p        ON p.oid = i.inhparent
       JOIN pg_namespace pn   ON pn.oid = p.relnamespace
      WHERE p.relname = $1
        AND pn.nspname = 'public'`,
    parent,
  );
  const cutoffIso = isoDate(cutoff);
  return rows
    .filter((r) => {
      const match = r.lower_bound.match(/FROM \('([^']+)'\)/);
      if (!match) return false;
      const from = match[1]!.slice(0, 10);
      return from < cutoffIso;
    })
    .map((r) => r.child);
}

/**
 * Convenience wrapper for the production cron: opens a fresh
 * superuser Prisma client (RLS-bypassing), runs maintenance, closes.
 * Do not import from a request-path — this is worker-only.
 */
export async function runPartitionMaintenance(
  now: Date = new Date(),
  opts: MaintainOptions = {},
): Promise<MaintainResult> {
  const superuserUrl = process.env.DATABASE_URL;
  if (!superuserUrl) throw new Error("DATABASE_URL required for partition maintenance");
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: superuserUrl }),
  });
  try {
    return await maintainPartitions(client, now, opts);
  } finally {
    await client.$disconnect();
  }
}
