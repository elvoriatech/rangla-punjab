import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { voucherExpiry } from "../src/lib/loyalty-service";

/**
 * One-off: give the rewards a venue has ALREADY handed out the new
 * year-long life.
 *
 * Rewards used to expire at the end of the calendar month they were
 * earned in — a guest who earned one on the 28th lost it on the 31st.
 * Newly minted vouchers now last a year (see `loyalty-config.ts`), but
 * the ledger is the truth for the ones already out there: their
 * `expires_at` was written at mint time and nothing recomputes it. This
 * moves every voucher that is still LIVE to the date it would have got
 * under the new rule — twelve months from the month it was created, at
 * 23:59:59 venue-local, exactly as `voucherExpiry` computes for a fresh
 * one.
 *
 * Only `available` and `armed` vouchers are touched. A `redeemed` one is
 * spent and an `expired` one has already been reported to its guest as
 * gone (and may well have been replaced by a goodwill order) — quietly
 * resurrecting those would be the restaurant honouring rewards it does
 * not know about.
 *
 * Idempotent: a voucher already sitting on its new date is counted as
 * unchanged and rewritten to the same value. Safe to run twice.
 *
 * Operator import, like the other scripts here — needs the
 * migration-privilege DATABASE_URL, and runs OUTSIDE the tenant RLS
 * session, so the venue slug is the only scope:
 *
 *   pnpm exec tsx --env-file=.env scripts/extend-loyalty-vouchers.ts rangla-punjab
 *
 * The slug may also come from RESTAURANT_SLUG; with neither, it refuses
 * rather than guessing which venue's rewards to extend. Add `--dry-run`
 * to print what it would do and write nothing.
 */

/** The new life, in months. Mirrors `LOYALTY_DEFAULTS.voucherExpiryMonths`
 *  — hard-coded rather than read from the venue's config so a venue that
 *  deliberately chose 3 months still gets the year this script exists to
 *  grant; pass MONTHS=n to override. */
const MONTHS = Number(process.env.MONTHS ?? 12);

/** Spent or already written off — see the doc comment. */
const LIVE_STATUSES = ["available", "armed"];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const slug = args.find((a) => !a.startsWith("--")) ?? process.env.RESTAURANT_SLUG;
  if (!slug) {
    throw new Error(
      "no venue slug — pass one (scripts/extend-loyalty-vouchers.ts <slug>) or set RESTAURANT_SLUG",
    );
  }
  if (!Number.isInteger(MONTHS) || MONTHS < 1 || MONTHS > 60) {
    throw new Error(`MONTHS must be a whole number between 1 and 60 (got ${process.env.MONTHS})`);
  }

  const venue = await prisma.venue.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, name: true, tenantId: true, timezone: true },
  });
  if (!venue) throw new Error(`no venue with slug '${slug}'`);

  const vouchers = await prisma.loyaltyVoucher.findMany({
    where: { tenantId: venue.tenantId, status: { in: LIVE_STATUSES } },
    select: { id: true, createdAt: true, expiresAt: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `${venue.name} (${slug}, ${venue.timezone}): ${vouchers.length} live voucher(s), ` +
      `extending to ${MONTHS} month(s) from the month each was earned${dryRun ? " — DRY RUN" : ""}`,
  );

  let moved = 0;
  let unchanged = 0;
  for (const voucher of vouchers) {
    // Computed from `createdAt`, not from today: a voucher earned in
    // March gets March + 12, which is what a guest would have been
    // promised had the new rule been in force when they earned it.
    const next = voucherExpiry(venue.timezone, MONTHS, voucher.createdAt);
    if (next.getTime() === voucher.expiresAt.getTime()) {
      unchanged += 1;
      continue;
    }
    if (!dryRun) {
      await prisma.loyaltyVoucher.update({
        where: { id: voucher.id },
        data: { expiresAt: next },
      });
    }
    moved += 1;
  }

  console.log(
    `done — ${moved} voucher(s) ${dryRun ? "would be" : ""} moved, ${unchanged} already on the new date`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
