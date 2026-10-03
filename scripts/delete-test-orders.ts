import { writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Remove the test orders placed before launch (owner, 2026-10-03: "every
 * order up to now is a test order — delete them, paid ones too").
 *
 * This is the one-off, bulk exception to the dashboard rule that only
 * cancelled, money-free orders may be deleted (docs/DECISIONS.md). Every
 * order of the restaurant created BEFORE the cut-off goes, whatever its
 * status or payment:
 *
 *   - the order, its lines and any complaint thread on it (cascade);
 *   - the loyalty points those orders earned or reversed, so test points
 *     do not stay on anyone's balance;
 *   - one `deleted_orders` line per order (number, date, amount, reason),
 *     the same trace the dashboard leaves — order numbers are therefore
 *     never reused, the next order continues the count.
 *
 * Online payments stay in Stripe / PayPal: this only touches our books.
 *
 *   RESTAURANT_SLUG   default "rangla-punjab"
 *   BEFORE            ISO time; orders created before it go. The dry run
 *                     prints the exact value to use, so an order placed
 *                     between the dry run and APPLY is never caught.
 *   APPLY=1           write; without it the script only prints the plan
 *
 *   ./deploy/deploy.sh testorders                              (dry run)
 *   APPLY=1 BEFORE=2026-10-03T19:30:00.000Z ./deploy/deploy.sh testorders
 *
 * Before writing it saves every order, line and points row to
 * `test-orders-backup-<time>.json` in the current directory.
 */

const REASON = "Testbestellung – Bereinigung vor dem Start";

async function main(): Promise<void> {
  const slug = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
  const apply = process.env.APPLY === "1";
  const beforeRaw = process.env.BEFORE;
  const before = beforeRaw ? new Date(beforeRaw) : new Date();
  if (Number.isNaN(before.getTime())) throw new Error(`BEFORE is not a date: "${beforeRaw}"`);
  if (apply && !beforeRaw) {
    throw new Error(
      "APPLY=1 needs BEFORE=… — run the dry run first and copy the command it prints",
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const venue = await prisma.venue.findUnique({
      where: { slug },
      select: { id: true, tenantId: true },
    });
    if (!venue) throw new Error(`no venue with slug "${slug}"`);

    // Reads and writes all run with the tenant set: the tables have FORCE
    // ROW LEVEL SECURITY, so without it a role that obeys the policies
    // sees no rows and may write none (2026-10-03: the first live run was
    // refused on `deleted_orders` for exactly this reason).
    const tenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${venue.tenantId}, true)`;
        return fn(tx);
      });

    const { orders, points } = await tenantTx(async (tx) => {
      const found = await tx.order.findMany({
        where: { venueId: venue.id, createdAt: { lt: before } },
        orderBy: { createdAt: "asc" },
        include: { items: true },
      });
      const ledger = await tx.loyaltyLedger.findMany({
        where: { orderId: { in: found.map((o) => o.id) } },
      });
      return { orders: found, points: ledger };
    });
    const ids = orders.map((o) => o.id);

    const euro = (cents: number): string => (cents / 100).toFixed(2).replace(".", ",") + " €";
    const byPayment = new Map<string, { n: number; cents: number }>();
    for (const o of orders) {
      const key = `${o.paymentStatus}${o.paymentProvider ? ` (${o.paymentProvider})` : ""}`;
      const row = byPayment.get(key) ?? { n: 0, cents: 0 };
      byPayment.set(key, { n: row.n + 1, cents: row.cents + o.totalCents });
    }

    console.log(`Restaurant "${slug}" — orders created before ${before.toISOString()}:`);
    console.log(
      `  ${orders.length} order(s), ${orders.reduce((s, o) => s + o.items.length, 0)} line(s)`,
    );
    for (const [key, row] of [...byPayment].sort()) {
      console.log(`    payment ${key}: ${row.n} order(s), ${euro(row.cents)}`);
    }
    console.log(`  ${points.length} loyalty points row(s) from these orders`);
    if (orders.length > 0) {
      const first = orders[0]!;
      const last = orders[orders.length - 1]!;
      console.log(`  oldest: #${first.orderNumber} ${first.createdAt.toISOString()}`);
      console.log(`  newest: #${last.orderNumber} ${last.createdAt.toISOString()}`);
    }

    if (!apply) {
      console.log(
        "\nDry run — nothing was changed. If every order above is a test order, run:\n" +
          `  APPLY=1 BEFORE=${before.toISOString()} ./deploy/deploy.sh testorders`,
      );
      return;
    }
    if (orders.length === 0) return;

    const backup = `test-orders-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(
      backup,
      JSON.stringify({ before: before.toISOString(), orders, points }, null, 2),
    );

    await tenantTx(async (tx) => {
      await tx.deletedOrder.createMany({
        data: orders.map((o) => ({
          tenantId: o.tenantId,
          venueId: o.venueId,
          orderNumber: o.orderNumber,
          orderType: o.orderType,
          paymentStatus: o.paymentStatus,
          totalCents: o.totalCents,
          currency: o.currency,
          placedAt: o.createdAt,
          reason: REASON,
          deletedBy: "script:delete-test-orders",
        })),
      });
      await tx.loyaltyLedger.deleteMany({ where: { orderId: { in: ids } } });
      const gone = await tx.order.deleteMany({ where: { id: { in: ids } } });
      // A policy that silently filters rows would delete fewer than listed;
      // roll the whole thing back rather than leave half the books.
      if (gone.count !== ids.length) {
        throw new Error(
          `deleted ${gone.count} of ${ids.length} orders — rolled back, nothing changed`,
        );
      }
    });
    console.log(
      `✓ Deleted ${orders.length} order(s) and ${points.length} points row(s). Backup: ${backup}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("delete-test-orders.ts")) {
  main().catch((err) => {
    console.error(
      `✗ delete-test-orders failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  });
}
