import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resetSlowQueryGauge, setSlowQueryGauge } from "./metrics";

/**
 * P2-13 slow-query monitoring. `pg_stat_statements` collects a per-plan
 * execution profile inside Postgres; this module reads the top-N by
 * `total_exec_time`, updates a Prometheus gauge keyed on the stable
 * `queryid` fingerprint, and writes a rolled report to `audit_events`
 * (kind = `slow_query_report`). The raw query text NEVER leaves the
 * database — only the fingerprint + timing scalars.
 *
 * The extension must be preloaded via `shared_preload_libraries` at
 * server start. dev docker-compose + prod (IONOS Managed Postgres) do
 * this; CI cannot override the command on a GH Actions service, so
 * `isPgStatStatementsAvailable` returns false there and the report
 * degrades to a no-op.
 */

interface DbLike {
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<unknown>;
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
}

export const DEFAULT_TOP_N = 20;

// audit_events.tenant_id is NOT NULL and has no FK — a synthetic
// system tenant is fine for cross-cutting reports and never resolves
// to a real Guesto customer.
export const SLOW_QUERY_REPORT_TENANT = "system";

export interface SlowQueryRow {
  /** `pg_stat_statements.queryid` as a decimal string. This IS the
   *  fingerprint — a stable 64-bit hash Postgres computes from the
   *  normalised query text. Parameter values are already stripped. */
  fingerprint: string;
  calls: number;
  totalExecMs: number;
  meanExecMs: number;
  maxExecMs: number;
}

export interface SlowQueryReport {
  generatedAt: Date;
  top: SlowQueryRow[];
}

/** Detect whether `pg_stat_statements` is available. Returns false on
 *  a fresh CI postgres that did not preload the shared library, so
 *  callers can skip the report or the test suite can skip its asserts. */
export async function isPgStatStatementsAvailable(db: DbLike): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ ok: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS ok`,
  );
  return Boolean(rows[0]?.ok);
}

/** Read the top-N slow statements by `total_exec_time`. Excludes the
 *  report's own `pg_stat_statements` scans so the job cannot compound
 *  itself into its own top-N on later runs. */
export async function readTopSlowStatements(
  db: DbLike,
  limit: number = DEFAULT_TOP_N,
): Promise<SlowQueryRow[]> {
  const rows = await db.$queryRawUnsafe<
    {
      queryid: bigint | null;
      calls: bigint;
      total_exec_time: number;
      mean_exec_time: number;
      max_exec_time: number;
    }[]
  >(
    `SELECT queryid,
            calls,
            total_exec_time,
            mean_exec_time,
            max_exec_time
       FROM pg_stat_statements
      WHERE query NOT ILIKE '%pg_stat_statements%'
      ORDER BY total_exec_time DESC
      LIMIT $1`,
    limit,
  );
  return rows.map((r) => ({
    fingerprint: r.queryid === null ? "0" : r.queryid.toString(),
    calls: Number(r.calls),
    totalExecMs: Number(r.total_exec_time),
    meanExecMs: Number(r.mean_exec_time),
    maxExecMs: Number(r.max_exec_time),
  }));
}

/** Read the top slow statements, publish them as gauge samples, and
 *  persist an `audit_events` row for post-hoc dashboards / ETL. Returns
 *  the report body (also written to the DB). No raw query text is ever
 *  included — only the fingerprint + timing scalars. */
export async function runSlowQueryReport(
  db: DbLike,
  now: Date = new Date(),
  opts: { limit?: number } = {},
): Promise<SlowQueryReport> {
  const limit = opts.limit ?? DEFAULT_TOP_N;
  const top = await readTopSlowStatements(db, limit);

  // Drop stale samples first so a fingerprint that fell out of the
  // top-N does not keep exporting yesterday's number.
  resetSlowQueryGauge();
  for (const row of top) {
    setSlowQueryGauge({ fingerprint: row.fingerprint, meanMs: row.meanExecMs });
  }

  await db.$executeRawUnsafe(
    `INSERT INTO audit_events (id, tenant_id, kind, target_kind, target_id, meta, at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    `sq-${now.toISOString()}`,
    SLOW_QUERY_REPORT_TENANT,
    "slow_query_report",
    "pg_stat_statements",
    `top-${limit}`,
    JSON.stringify({ top }),
    now,
  );

  return { generatedAt: now, top };
}

/** Convenience wrapper for the production cron: opens a fresh
 *  superuser Prisma client (BYPASSRLS + pg_read_all_stats), runs the
 *  report, closes. Worker-only — never call from a request path. */
export async function runScheduledSlowQueryReport(
  now: Date = new Date(),
  opts: { limit?: number } = {},
): Promise<SlowQueryReport | null> {
  const superuserUrl = process.env.DATABASE_URL;
  if (!superuserUrl) throw new Error("DATABASE_URL required for slow-query report");
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: superuserUrl }),
  });
  try {
    if (!(await isPgStatStatementsAvailable(client))) return null;
    return await runSlowQueryReport(client, now, opts);
  } finally {
    await client.$disconnect();
  }
}
