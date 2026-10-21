import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Payments that need a person (owner, 2026-10-21) — no dashboard page, by
 * the owner's wish: run on the server.
 *
 *   ./deploy/deploy.sh payments                      list
 *   RESOLVE=<attempt id> NOTE="refunded in Stripe" \
 *     ./deploy/deploy.sh payments                    mark one handled
 *
 * Lists, oldest first:
 *   - NEEDS ACTION: money was taken but the order could not accept it
 *     (late on an old card page, order deleted/cancelled meanwhile, amount
 *     differs, a second payment) — refund it in Stripe / PayPal, then mark
 *     it handled here;
 *   - CAPTURING: a capture whose result is not recorded yet (the background
 *     reconciler finishes these within minutes; listed if older);
 *   - OPEN for more than an hour: a payment page never finished or still
 *     reserved (released or captured automatically; listed for insight).
 *
 * The same rows are visible per order in Dashboard → Order log.
 */

const STUCK_MS = 60 * 60 * 1000;

function euro(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} ${currency}`;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    // Reading across tenants uses the reconciler's read-only policy.
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.payment_reconciler', 'on', true)`;
      return tx.paymentAttempt.findMany({
        where: {
          OR: [
            { resolution: "needed" },
            { status: "capturing" },
            { status: "open", createdAt: { lt: new Date(Date.now() - STUCK_MS) } },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
    });

    const resolveId = process.env.RESOLVE;
    if (resolveId) {
      const row = rows.find((r) => r.id === resolveId);
      if (!row || row.resolution !== "needed") {
        throw new Error(`no payment needing action with id ${resolveId}`);
      }
      const note = (process.env.NOTE ?? "").trim();
      if (note.length < 3) throw new Error('NOTE="…" is required (what was done)');
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${row.tenantId}, true)`;
        await tx.paymentAttempt.update({
          where: { id: row.id },
          data: {
            resolution: "resolved",
            resolutionNote: note.slice(0, 300),
            resolvedBy: "owner (payments script)",
            resolvedAt: new Date(),
          },
        });
        await tx.orderEvent.create({
          data: {
            tenantId: row.tenantId,
            venueId: row.venueId,
            orderId: row.orderId,
            orderLabel: row.orderLabel,
            kind: "payment.resolved",
            actor: "owner",
            summary: `Payment marked handled: ${note.slice(0, 300)} · ${row.ref}`,
          },
        });
      });
      console.log(`✓ ${row.orderLabel ?? row.orderId} · ${row.ref} marked handled.`);
      return;
    }

    const needs = rows.filter((r) => r.resolution === "needed");
    const capturing = rows.filter((r) => r.status === "capturing");
    const open = rows.filter((r) => r.status === "open");
    const line = (r: (typeof rows)[number]) =>
      `  ${r.id}  #${r.orderLabel ?? "?"}  ${r.provider.padEnd(6)} ${euro(r.amountCents, r.currency).padStart(12)}  ${r.createdAt.toISOString()}  ${r.ref}`;

    console.log(`NEEDS ACTION (money taken, not accepted) — ${needs.length}`);
    for (const r of needs) console.log(`${line(r)}\n      reason: ${r.resolutionReason ?? "?"}`);
    console.log(`\nCAPTURING (result not recorded yet) — ${capturing.length}`);
    for (const r of capturing) console.log(line(r));
    console.log(`\nOPEN for over an hour — ${open.length}`);
    for (const r of open) console.log(line(r));
    if (needs.length > 0) {
      console.log(
        '\nRefund in Stripe / PayPal, then: RESOLVE=<id> NOTE="refunded in Stripe" ./deploy/deploy.sh payments',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("payments-report.ts")) {
  main().catch((err) => {
    console.error(`✗ payments: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
