import { writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The official launch: every order so far was a test, and numbering must
 * start again at B-1 / O-1 (owner, 2026-10-11: "reset the orders so we
 * start from one as we launch officially"; scope chosen: orders + deletion
 * log only, all current orders are test orders).
 *
 * Order numbers continue from the highest number in `orders` AND in
 * `deleted_orders` (so a deleted number is never handed out twice). To
 * restart at 1 both go:
 *
 *   - every order of the restaurant created before BEFORE, with its lines
 *     and any complaint thread (cascade);
 *   - every `deleted_orders` line of the restaurant (the log of test
 *     deletions);
 *   - the order log (`order_events`) from before BEFORE — it has no foreign
 *     key, so it would otherwise outlive the deleted test orders;
 *   - the app bell's order and complaint notifications from before BEFORE.
 *
 * Kept: menu, settings, team, customer accounts, loyalty points (their
 * order reference is cleared), reservations, catering, gift cards, and the
 * bell's reservation / catering notifications. Online
 * payments stay in Stripe / PayPal: this only touches our books.
 *
 *   RESTAURANT_SLUG   default "rangla-punjab"
 *   BEFORE            ISO time; orders created before it go. The dry run
 *                     prints the exact value to use.
 *   APPLY=1           write; without it the script only prints the plan
 *
 *   ./deploy/deploy.sh launchreset                              (dry run)
 *   APPLY=1 BEFORE=… ./deploy/deploy.sh launchreset
 *
 * Before writing it saves every order, line, deletion-log row, order-log
 * row and notification it deletes to
 * `launch-reset-backup-<time>.json` in the current directory.
 */

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

    // FORCE ROW LEVEL SECURITY: every read and write runs with the tenant set.
    const tenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${venue.tenantId}, true)`;
        return fn(tx);
      });

    const bellKinds = ["order", "issue"];
    const { orders, log, events, bell, later } = await tenantTx(async (tx) => ({
      orders: await tx.order.findMany({
        where: { venueId: venue.id, createdAt: { lt: before } },
        orderBy: { createdAt: "asc" },
        include: { items: true },
      }),
      log: await tx.deletedOrder.findMany({ where: { venueId: venue.id } }),
      events: await tx.orderEvent.findMany({
        where: { venueId: venue.id, createdAt: { lt: before } },
      }),
      bell: await tx.staffNotification.findMany({
        where: { kind: { in: bellKinds }, createdAt: { lt: before } },
      }),
      later: await tx.order.count({ where: { venueId: venue.id, createdAt: { gte: before } } }),
    }));

    const euro = (cents: number): string => (cents / 100).toFixed(2).replace(".", ",") + " €";
    const byPayment = new Map<string, { n: number; cents: number }>();
    for (const o of orders) {
      const key = `${o.paymentStatus}${o.paymentProvider ? ` (${o.paymentProvider})` : ""}`;
      const row = byPayment.get(key) ?? { n: 0, cents: 0 };
      byPayment.set(key, { n: row.n + 1, cents: row.cents + o.totalCents });
    }

    console.log(`Restaurant "${slug}" — launch reset, cut-off ${before.toISOString()}:`);
    console.log(
      `  ${orders.length} order(s), ${orders.reduce((s, o) => s + o.items.length, 0)} line(s)`,
    );
    for (const [key, row] of [...byPayment].sort()) {
      console.log(`    payment ${key}: ${row.n} order(s), ${euro(row.cents)}`);
    }
    console.log(`  ${log.length} deletion-log row(s)`);
    console.log(`  ${events.length} order-log row(s)`);
    console.log(`  ${bell.length} order/complaint notification(s) in the app bell`);
    if (later > 0) {
      console.log(
        `  ! ${later} order(s) placed after the cut-off stay — numbering then continues from them`,
      );
    }

    if (!apply) {
      console.log(
        "\nDry run — nothing was changed. If every order above is a test order, run:\n" +
          `  APPLY=1 BEFORE=${before.toISOString()} ./deploy/deploy.sh launchreset`,
      );
      return;
    }

    const backup = `launch-reset-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(
      backup,
      JSON.stringify(
        {
          before: before.toISOString(),
          orders,
          deletedOrders: log,
          orderEvents: events,
          staffNotifications: bell,
        },
        null,
        2,
      ),
    );

    const ids = orders.map((o) => o.id);
    await tenantTx(async (tx) => {
      const gone = await tx.order.deleteMany({ where: { id: { in: ids } } });
      // A policy that silently filters rows would delete fewer than listed;
      // roll everything back rather than leave half the books.
      if (gone.count !== ids.length) {
        throw new Error(`deleted ${gone.count} of ${ids.length} orders — rolled back`);
      }
      const cleared = await tx.deletedOrder.deleteMany({ where: { venueId: venue.id } });
      if (cleared.count !== log.length) {
        throw new Error(`cleared ${cleared.count} of ${log.length} log rows — rolled back`);
      }
      const evGone = await tx.orderEvent.deleteMany({
        where: { id: { in: events.map((e) => e.id) } },
      });
      if (evGone.count !== events.length) {
        throw new Error(`deleted ${evGone.count} of ${events.length} order-log rows — rolled back`);
      }
      const bellGone = await tx.staffNotification.deleteMany({
        where: { id: { in: bell.map((n) => n.id) } },
      });
      if (bellGone.count !== bell.length) {
        throw new Error(`deleted ${bellGone.count} of ${bell.length} notifications — rolled back`);
      }
    });
    console.log(
      `✓ Deleted ${orders.length} order(s), ${log.length} deletion-log row(s), ` +
        `${events.length} order-log row(s), ${bell.length} notification(s). Backup: ${backup}\n` +
        "  The next cash order is B-1, the next online order O-1.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("launch-reset.ts")) {
  main().catch((err) => {
    console.error(`✗ launch-reset failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
