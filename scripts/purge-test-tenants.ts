import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Remove the tenants the test suite leaves behind.
 *
 * `pnpm test` runs against a real Postgres and creates throwaway tenants
 * named `t-<8 hex>` (see the `t-${randomUUID().slice(0, 8)}` factories in
 * the *.test.ts files). Nothing deletes them, so a dev database that has
 * run the suite a few times buries the real restaurant under dozens of
 * fixtures in /admin/restaurants.
 *
 * Safety: only rows whose NAME matches the fixture pattern are eligible,
 * and any candidate that owns real content (orders, media, memberships,
 * reservations) is skipped and reported — a tenant with real data is by
 * definition not a discarded fixture. Deleting a tenant cascades to its
 * venues, menus, categories and items via the schema's FKs.
 *
 * Dry run by default; pass --apply to delete:
 *   pnpm exec tsx --env-file=.env scripts/purge-test-tenants.ts
 *   pnpm exec tsx --env-file=.env scripts/purge-test-tenants.ts --apply
 */

const FIXTURE_NAME = /^t-[0-9a-f]{8}$/;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
    const candidates = tenants.filter((t) => FIXTURE_NAME.test(t.name));

    const deletable: string[] = [];
    const skipped: { name: string; why: string }[] = [];
    for (const tenant of candidates) {
      const [orders, media, memberships, reservations] = await Promise.all([
        prisma.order.count({ where: { tenantId: tenant.id } }),
        prisma.media.count({ where: { tenantId: tenant.id } }),
        prisma.membership.count({ where: { tenantId: tenant.id } }),
        prisma.reservation.count({ where: { tenantId: tenant.id } }),
      ]);
      const holds = [
        orders && `${orders} orders`,
        media && `${media} media`,
        memberships && `${memberships} members`,
        reservations && `${reservations} reservations`,
      ].filter(Boolean);
      if (holds.length > 0) skipped.push({ name: tenant.name, why: holds.join(", ") });
      else deletable.push(tenant.id);
    }

    process.stdout.write(
      `${tenants.length} tenants · ${candidates.length} match the fixture pattern · ` +
        `${deletable.length} deletable · ${skipped.length} skipped (hold real data)\n`,
    );
    for (const s of skipped) process.stdout.write(`  ! kept ${s.name} — ${s.why}\n`);

    if (!apply) {
      process.stdout.write("dry run — re-run with --apply to delete\n");
      return;
    }
    if (deletable.length === 0) {
      process.stdout.write("nothing to delete\n");
      return;
    }
    const { count } = await prisma.tenant.deleteMany({ where: { id: { in: deletable } } });
    process.stdout.write(`✓ deleted ${count} test tenants (venues + menus cascaded)\n`);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(
      `✗ purge-test-tenants failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
