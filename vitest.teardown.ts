import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Global teardown: drop the throwaway tenants the suite created.
 *
 * The integration tests run against a real Postgres and mint tenants named
 * `t-<8 hex>`. Nothing used to remove them, so a dev database silently
 * accumulated hundreds of fixtures and buried the real restaurant in
 * /admin/restaurants. Same guard as scripts/purge-test-tenants.ts: only
 * fixture-named tenants, and only ones holding no real content.
 *
 * Best effort — a cleanup failure must never fail a green test run.
 * Exported as `teardown` (not a default export) so vitest runs it AFTER
 * the suite rather than as global setup.
 */

const FIXTURE_NAME = /^t-[0-9a-f]{8}$/;

export async function teardown(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
    const ids: string[] = [];
    for (const tenant of tenants.filter((t) => FIXTURE_NAME.test(t.name))) {
      const [orders, media, memberships] = await Promise.all([
        prisma.order.count({ where: { tenantId: tenant.id } }),
        prisma.media.count({ where: { tenantId: tenant.id } }),
        prisma.membership.count({ where: { tenantId: tenant.id } }),
      ]);
      if (orders + media + memberships === 0) ids.push(tenant.id);
    }
    if (ids.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  } catch {
    // Never turn a passing suite red over housekeeping.
  } finally {
    await prisma.$disconnect();
  }
}
