import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { registry } from "./metrics";
import {
  DEFAULT_TOP_N,
  isPgStatStatementsAvailable,
  readTopSlowStatements,
  runSlowQueryReport,
  SLOW_QUERY_REPORT_TENANT,
} from "./slow-query-report";

/**
 * P2-13 slow-query-report. Runs against the superuser connection so
 * we can read `pg_stat_statements`, bypass RLS on `audit_events`, and
 * reset the stats view between runs. Skips gracefully when the
 * extension is not preloaded (CI on GH Actions services cannot set
 * `shared_preload_libraries` — skips gracefully when unavailable).
 *
 * Three invariants:
 *   1. The extension is loaded and pg_stat_statements is queryable.
 *   2. `readTopSlowStatements` returns typed rows sorted by
 *      total_exec_time descending.
 *   3. `runSlowQueryReport` writes an audit_events row with kind =
 *      `slow_query_report`, meta contains ONLY fingerprints + timing
 *      scalars (no raw query text), and the Prometheus gauge has at
 *      least one `pg_slow_query_ms{fingerprint=...}` sample.
 */

describe("slow-query report (P2-13)", () => {
  let db: PrismaClient;
  let skip = false;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required");
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    skip = !(await isPgStatStatementsAvailable(db));
    if (skip) {
      console.warn(
        "[P2-13] pg_stat_statements not loaded (shared_preload_libraries missing); " +
          "skipping report asserts.",
      );
      return;
    }
    // Reset the shared buffer so this suite starts from a clean slate,
    // then run a few queries so the top-N is non-empty. `pg_sleep`
    // returns void, which the driver adapter refuses to decode — hide
    // it under a scalar SELECT so the driver can decode a real column.
    await db.$executeRawUnsafe("SELECT pg_stat_statements_reset()");
    for (let i = 0; i < 3; i += 1) {
      await db.$queryRawUnsafe(`SELECT ${i}::int AS n, (SELECT 1 FROM pg_sleep(0.01)) AS s`);
    }
  });

  afterAll(async () => {
    // Every test cleans its own audit_events row; this is belt +
    // braces so a mid-test failure does not leave rows behind for the
    // partition manager to archive later.
    if (db) {
      try {
        await db.$executeRawUnsafe(
          `DELETE FROM audit_events WHERE kind = 'slow_query_report' AND tenant_id = $1`,
          SLOW_QUERY_REPORT_TENANT,
        );
      } catch {
        // Never let cleanup block the vitest exit path.
      }
      await db.$disconnect();
    }
  });

  it("pg_stat_statements is loaded and queryable", async () => {
    if (skip) return;
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_stat_statements`,
    );
    expect(rows[0]?.n ?? -1).toBeGreaterThanOrEqual(0);
  });

  it("readTopSlowStatements returns typed rows sorted by total_exec_time desc", async () => {
    if (skip) return;
    const top = await readTopSlowStatements(db, 5);
    expect(top.length).toBeGreaterThan(0);
    expect(top.length).toBeLessThanOrEqual(5);
    for (const row of top) {
      expect(typeof row.fingerprint).toBe("string");
      expect(row.fingerprint.length).toBeGreaterThan(0);
      expect(row.calls).toBeGreaterThanOrEqual(1);
      expect(row.meanExecMs).toBeGreaterThanOrEqual(0);
      expect(row.maxExecMs).toBeGreaterThanOrEqual(row.meanExecMs);
    }
    for (let i = 1; i < top.length; i += 1) {
      expect(top[i - 1]!.totalExecMs).toBeGreaterThanOrEqual(top[i]!.totalExecMs);
    }
  });

  it("runSlowQueryReport writes audit_events + updates gauge without leaking query text", async () => {
    if (skip) return;
    const now = new Date();
    const report = await runSlowQueryReport(db, now, { limit: 5 });
    expect(report.top.length).toBeGreaterThan(0);
    expect(report.top.length).toBeLessThanOrEqual(5);

    // audit_events row landed. Lookup by id (deterministic per run).
    const auditRows = await db.$queryRawUnsafe<{ meta: string; tenant_id: string }[]>(
      `SELECT meta::text AS meta, tenant_id FROM audit_events WHERE id = $1`,
      `sq-${now.toISOString()}`,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.tenant_id).toBe(SLOW_QUERY_REPORT_TENANT);
    const meta = JSON.parse(auditRows[0]!.meta) as { top: Record<string, unknown>[] };
    expect(Array.isArray(meta.top)).toBe(true);
    expect(meta.top.length).toBe(report.top.length);
    for (const row of meta.top) {
      expect(typeof row.fingerprint).toBe("string");
      // Explicitly assert the raw query text never made it through the
      // seam. `pg_stat_statements` exposes `query` as a column and it
      // would be tempting to include it "just for debugging" — this
      // check is the tripwire against that.
      expect(row.query).toBeUndefined();
      expect(row.query_text).toBeUndefined();
      expect(row.sql).toBeUndefined();
    }

    // Prometheus gauge updated with at least one fingerprint sample.
    const text = await registry.metrics();
    expect(text).toMatch(/pg_slow_query_ms\{fingerprint="[^"]+"\}/);

    await db.$executeRawUnsafe(`DELETE FROM audit_events WHERE id = $1`, `sq-${now.toISOString()}`);
  });

  it("DEFAULT_TOP_N is 20 (matches the backlog spec)", () => {
    expect(DEFAULT_TOP_N).toBe(20);
  });
});
