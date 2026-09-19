import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "./db";
import { asTenant } from "./tenant";

// Vitest runs test files in parallel. The P2-10 partition-manager
// suite may move the 2026 bootstrap children into archive between
// runs of this file; on a re-run we recreate them so this suite is
// self-healing. Runs as the migration superuser so `CREATE TABLE
// PARTITION OF` is allowed regardless of RLS.
beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const bootstrap: Array<[string, string, string, string]> = [
      ["scan_stats", "scan_stats_2026_07", "2026-07-01", "2026-08-01"],
      ["scan_stats", "scan_stats_2026_08", "2026-08-01", "2026-09-01"],
      ["scan_stats", "scan_stats_2026_09", "2026-09-01", "2026-10-01"],
      ["audit_events", "audit_events_2026_07", "2026-07-01", "2026-08-01"],
      ["audit_events", "audit_events_2026_08", "2026-08-01", "2026-09-01"],
      ["audit_events", "audit_events_2026_09", "2026-09-01", "2026-10-01"],
    ];
    for (const [parent, child, from, to] of bootstrap) {
      await admin.$executeRawUnsafe(`DROP TABLE IF EXISTS archive."${child}" CASCADE`);
      const rows = await admin.$queryRawUnsafe<{ exists: boolean }[]>(
        // relkind filter: only a real table counts as "the partition
        // already exists" — an index sharing the name must not make
        // us skip the CREATE TABLE below.
        `SELECT EXISTS (
           SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = $1 AND n.nspname = 'public'
              AND c.relkind IN ('r', 'p')
         ) AS "exists"`,
        child,
      );
      if (!rows[0]?.exists) {
        await admin.$executeRawUnsafe(
          `CREATE TABLE "${child}" PARTITION OF "${parent}" FOR VALUES FROM ('${from}') TO ('${to}')`,
        );
      }
    }
  } finally {
    await admin.$disconnect();
  }
});

/**
 * P2-9 partition sanity + RLS. Proves three things at once:
 *   1. An INSERT lands in the correct child partition (queried via
 *      `tableoid::regclass`) for two rows on different months.
 *   2. Cross-tenant reads are blocked by the RLS policy inherited
 *      from the parent — same guarantee every tenant_id table gives.
 *   3. A `WHERE at > now() - interval '1 day'` plan prunes down to a
 *      single child partition (asserted via EXPLAIN's text output).
 */

describe("analytics partitions (P2-9)", () => {
  const tenantIds: string[] = [];
  const venueIds: string[] = [];

  afterEach(async () => {
    // scan_stats / audit_events are partitioned — DELETE cascades to
    // every child through the parent, no per-partition cleanup needed.
    for (const t of tenantIds) {
      await asTenant(t, (tx) => tx.scanStat.deleteMany({}));
      await asTenant(t, (tx) => tx.auditEvent.deleteMany({}));
    }
    if (venueIds.length) {
      await prisma.$executeRawUnsafe(`DELETE FROM venues WHERE id = ANY($1::text[])`, venueIds);
    }
    if (tenantIds.length) {
      await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1::text[])`, tenantIds);
    }
    tenantIds.length = 0;
    venueIds.length = 0;
  });

  async function seedTenant(): Promise<{ tenantId: string; venueId: string }> {
    const tenantId = `t-${randomUUID().slice(0, 8)}`;
    const venueId = `v-${randomUUID().slice(0, 8)}`;
    tenantIds.push(tenantId);
    venueIds.push(venueId);
    // Bootstrap the tenant + venue under its own GUC so the FK check
    // and the RLS write policy both accept the rows.
    await asTenant(tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: tenantId } }));
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: {
          id: venueId,
          tenantId,
          name: "P2-9 test venue",
          slug: `p2-9-${randomUUID().slice(0, 8)}`,
        },
      }),
    );
    return { tenantId, venueId };
  }

  it("inserts at 2026-07-15 and 2026-09-15 land in their correct monthly children", async () => {
    const { tenantId, venueId } = await seedTenant();

    await asTenant(tenantId, (tx) =>
      tx.scanStat.createMany({
        data: [
          {
            id: `s-jul-${randomUUID().slice(0, 6)}`,
            tenantId,
            venueId,
            path: "/r/demo",
            uaClass: "mobile-safari",
            referrerClass: "direct",
            at: new Date("2026-07-15T12:00:00Z"),
          },
          {
            id: `s-sep-${randomUUID().slice(0, 6)}`,
            tenantId,
            venueId,
            path: "/r/demo",
            uaClass: "mobile-safari",
            referrerClass: "search",
            at: new Date("2026-09-15T12:00:00Z"),
          },
        ],
      }),
    );

    const rows = await asTenant(tenantId, (tx) =>
      tx.$queryRawUnsafe<{ path: string; child: string }[]>(
        `SELECT path, tableoid::regclass::text AS child
           FROM scan_stats
          WHERE tenant_id = $1
          ORDER BY at`,
        tenantId,
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.child).toBe("scan_stats_2026_07");
    expect(rows[1]!.child).toBe("scan_stats_2026_09");
  });

  it("blocks cross-tenant reads on scan_stats and audit_events (RLS inherited)", async () => {
    const a = await seedTenant();
    const b = await seedTenant();

    await asTenant(a.tenantId, (tx) =>
      tx.scanStat.create({
        data: {
          id: `s-a-${randomUUID().slice(0, 6)}`,
          tenantId: a.tenantId,
          venueId: a.venueId,
          path: "/r/a",
          uaClass: "mobile-safari",
          referrerClass: "direct",
          at: new Date("2026-08-01T10:00:00Z"),
        },
      }),
    );
    await asTenant(a.tenantId, (tx) =>
      tx.auditEvent.create({
        data: {
          id: `e-a-${randomUUID().slice(0, 6)}`,
          tenantId: a.tenantId,
          kind: "menu.publish",
          targetKind: "MenuVersion",
          targetId: "mv-1",
          at: new Date("2026-08-01T10:00:00Z"),
        },
      }),
    );

    // Under tenant B's GUC, the parent + all children hide A's rows.
    const leakedScans = await asTenant(b.tenantId, (tx) =>
      tx.scanStat.findMany({ where: { tenantId: a.tenantId } }),
    );
    expect(leakedScans).toHaveLength(0);
    const leakedAudits = await asTenant(b.tenantId, (tx) =>
      tx.auditEvent.findMany({ where: { tenantId: a.tenantId } }),
    );
    expect(leakedAudits).toHaveLength(0);

    // And a WITH CHECK cross-tenant insert throws.
    await expect(
      asTenant(a.tenantId, (tx) =>
        tx.scanStat.create({
          data: {
            id: `s-evil-${randomUUID().slice(0, 6)}`,
            tenantId: b.tenantId, // wrong tenant
            venueId: a.venueId,
            path: "/r/evil",
            uaClass: "mobile-safari",
            referrerClass: "direct",
            at: new Date("2026-08-01T10:00:00Z"),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("EXPLAIN shows partition pruning to a single child for a bounded WHERE", async () => {
    const { tenantId, venueId } = await seedTenant();
    await asTenant(tenantId, (tx) =>
      tx.scanStat.create({
        data: {
          id: `s-plan-${randomUUID().slice(0, 6)}`,
          tenantId,
          venueId,
          path: "/r/demo",
          uaClass: "mobile-safari",
          referrerClass: "direct",
          at: new Date("2026-09-15T12:00:00Z"),
        },
      }),
    );

    const plan = await asTenant(tenantId, (tx) =>
      tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN SELECT * FROM scan_stats
           WHERE tenant_id = $1
             AND at >= '2026-09-10'::timestamptz
             AND at <  '2026-09-20'::timestamptz`,
        tenantId,
      ),
    );
    const text = plan.map((p) => p["QUERY PLAN"]).join("\n");
    // The planner should touch exactly the 2026_09 child and prune
    // 07 + 08. We look for "scan_stats_2026_09" in the plan and
    // assert 07/08 are NOT scanned.
    expect(text).toContain("scan_stats_2026_09");
    expect(text).not.toContain("scan_stats_2026_07");
    expect(text).not.toContain("scan_stats_2026_08");
  });
});
