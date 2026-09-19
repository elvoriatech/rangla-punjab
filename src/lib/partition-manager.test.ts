import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PARTITIONED_TABLES, maintainPartitions } from "./partition-manager";

/**
 * P2-10 partition-maintain job. Operates on a distinct year range
 * (2029/2030) that the P2-9 test file never touches — vitest runs
 * files in parallel by default, so any overlap on the 2026 bootstrap
 * partitions would race. Each test in this suite creates + cleans up
 * its own children, so the file is self-contained.
 */

const YEAR = 2029; // "current" year for the roll-forward tests
const RETENTION_YEAR = 2031; // "future" year for the archive test — 12 months past YEAR

function makeSuperClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

async function dropTestChildren(db: PrismaClient, year: number): Promise<void> {
  for (const parent of PARTITIONED_TABLES) {
    const rows = await db.$queryRawUnsafe<{ relname: string }[]>(
      `SELECT c.relname FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
         JOIN pg_namespace pn ON pn.oid = p.relnamespace
        WHERE p.relname = $1 AND pn.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname LIKE $2`,
      parent,
      `${parent}_${year}_%`,
    );
    for (const { relname } of rows) {
      await db.$executeRawUnsafe(`ALTER TABLE "${parent}" DETACH PARTITION "${relname}"`);
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${relname}" CASCADE`);
    }
    // Archive sweep — any archive TABLE for this parent + year. The
    // relkind filter matters: `ALTER TABLE ... SET SCHEMA archive`
    // moves the partition's indexes across too, so a bare LIKE also
    // matches e.g. `scan_stats_2029_05_pkey` and `DROP TABLE` on that
    // index fails with 42809 ("is not a table").
    const archived = await db.$queryRawUnsafe<{ relname: string }[]>(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'archive'
          AND c.relkind IN ('r', 'p')
          AND c.relname LIKE $1`,
      `${parent}_${year}_%`,
    );
    for (const { relname } of archived) {
      // Tolerant: CASCADE on an earlier sibling may already have taken
      // this one with it, and a parallel suite may be sweeping too.
      try {
        await db.$executeRawUnsafe(`DROP TABLE IF EXISTS archive."${relname}" CASCADE`);
      } catch {
        // best-effort cleanup — leftovers are re-swept next run
      }
    }
  }
}

async function listPublicChildren(db: PrismaClient, parent: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ relname: string }[]>(
    `SELECT c.relname FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       JOIN pg_namespace pn ON pn.oid = p.relnamespace
      WHERE p.relname = $1 AND pn.nspname = 'public'
      ORDER BY c.relname`,
    parent,
  );
  return rows.map((r) => r.relname);
}

async function listArchiveTables(db: PrismaClient): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ relname: string }[]>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'archive' ORDER BY c.relname`,
  );
  return rows.map((r) => r.relname);
}

describe("partition manager (P2-10)", () => {
  let db: PrismaClient;

  beforeEach(async () => {
    db = makeSuperClient();
    // Sweep any leftovers from a prior run — the year is unique to
    // this suite so we cannot collide with P2-9's 2026 bootstrap.
    await dropTestChildren(db, YEAR);
    await dropTestChildren(db, RETENTION_YEAR);
  });

  afterEach(async () => {
    await dropTestChildren(db, YEAR);
    await dropTestChildren(db, RETENTION_YEAR);
    await db.$disconnect();
  });

  it("creates the current + next 3 monthly partitions at a fixed clock", async () => {
    const now = new Date(`${YEAR}-04-15T00:00:00Z`);
    const result = await maintainPartitions(db, now, {
      aheadMonths: 3,
      scanStatsRetentionMonths: 240,
      auditEventsRetentionMonths: 240,
    });
    // ahead=3 → 04, 05, 06, 07 for each of the two parents = 8 new.
    const expected = ["04", "05", "06", "07"].flatMap((mm) => [
      `scan_stats_${YEAR}_${mm}`,
      `audit_events_${YEAR}_${mm}`,
    ]);
    expect(result.created.sort()).toEqual(expected.sort());
    expect(result.archived).toEqual([]);

    const scanChildren = await listPublicChildren(db, "scan_stats");
    for (const mm of ["04", "05", "06", "07"]) {
      expect(scanChildren).toContain(`scan_stats_${YEAR}_${mm}`);
    }
  });

  it("is a no-op on a second identical run (idempotent)", async () => {
    const now = new Date(`${YEAR}-04-15T00:00:00Z`);
    const opts = {
      aheadMonths: 3,
      scanStatsRetentionMonths: 240,
      auditEventsRetentionMonths: 240,
    };
    await maintainPartitions(db, now, opts);
    const second = await maintainPartitions(db, now, opts);
    expect(second.created).toEqual([]);
    expect(second.archived).toEqual([]);
  });

  it("moves partitions older than the retention window to archive.", async () => {
    // Bootstrap: create four 2029 partitions the retention test can archive.
    const bootstrap = new Date(`${YEAR}-04-15T00:00:00Z`);
    await maintainPartitions(db, bootstrap, {
      aheadMonths: 3,
      scanStatsRetentionMonths: 240,
      auditEventsRetentionMonths: 240,
    });

    // Fast-forward: now = RETENTION_YEAR-04-15 = 24 months past
    // YEAR-04-15. With scan retention 12mo, every 2029 scan
    // partition is older than the cutoff. Audit retention stays
    // huge so audit children are untouched.
    const now = new Date(`${RETENTION_YEAR}-04-15T00:00:00Z`);
    const result = await maintainPartitions(db, now, {
      aheadMonths: 0,
      scanStatsRetentionMonths: 12,
      auditEventsRetentionMonths: 240,
    });

    for (const mm of ["04", "05", "06", "07"]) {
      expect(result.archived).toContain(`scan_stats_${YEAR}_${mm}`);
    }
    const scanChildren = await listPublicChildren(db, "scan_stats");
    for (const mm of ["04", "05", "06", "07"]) {
      expect(scanChildren).not.toContain(`scan_stats_${YEAR}_${mm}`);
    }
    const archived = await listArchiveTables(db);
    for (const mm of ["04", "05", "06", "07"]) {
      expect(archived).toContain(`scan_stats_${YEAR}_${mm}`);
    }
    // Audit stays put.
    const auditChildren = await listPublicChildren(db, "audit_events");
    for (const mm of ["04", "05", "06", "07"]) {
      expect(auditChildren).toContain(`audit_events_${YEAR}_${mm}`);
    }
  });
});
