import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";

/**
 * Set (or reset) the restaurant owner's /dashboard login from the
 * environment — the fix for "OWNER_EMAIL / OWNER_PASSWORD are in prod.env
 * but the login page says they don't match".
 *
 * Why this exists: seed-restaurant.ts only creates the owner on a brand-new
 * database and no-ops as soon as the venue exists, so changing OWNER_* in
 * prod.env after the first deploy changes nothing. This script is the
 * idempotent counterpart: it finds the venue's owner and makes that account
 * match the env, every time it runs.
 *
 *   RESTAURANT_SLUG   default "rangla-punjab"   which venue's owner
 *   OWNER_EMAIL       required                  new login email
 *   OWNER_PASSWORD    required, ≥ 12 chars      new password
 *
 *   ./deploy/deploy.sh owner                     (on the VPS, reads prod.env)
 *   pnpm exec tsx --env-file=.env scripts/set-owner-login.ts   (local)
 *
 * Outstanding sessions for that user are invalidated (sessions_valid_from),
 * exactly like the in-app password reset does.
 */

export interface SetOwnerLoginInput {
  slug: string;
  email: string;
  password: string;
}

export type SetOwnerLoginResult =
  | { ok: true; userId: string; previousEmail: string; email: string }
  | {
      ok: false;
      error: "venue_not_found" | "owner_not_found" | "email_taken" | "weak_password";
      detail?: string;
    };

export async function setOwnerLogin(
  prisma: PrismaClient,
  input: SetOwnerLoginInput,
): Promise<SetOwnerLoginResult> {
  const email = input.email.trim();
  if (input.password.length < 12) return { ok: false, error: "weak_password" };

  const venue = await prisma.venue.findUnique({
    where: { slug: input.slug },
    select: { tenantId: true },
  });
  if (!venue) return { ok: false, error: "venue_not_found" };

  const membership = await prisma.membership.findFirst({
    where: { tenantId: venue.tenantId, role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!membership) return { ok: false, error: "owner_not_found" };

  // The email column is citext-unique. If someone ELSE already holds the
  // requested address we must not silently steal or merge it.
  const clash = await prisma.user.findFirst({
    where: { email, NOT: { id: membership.userId } },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "email_taken", detail: `user ${clash.id}` };

  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  await prisma.user.update({
    where: { id: membership.userId },
    data: {
      email,
      passwordHash,
      emailVerifiedAt: now,
      deletedAt: null,
      sessionsValidFrom: now,
    },
  });
  return {
    ok: true,
    userId: membership.userId,
    previousEmail: membership.user.email,
    email,
  };
}

async function main(): Promise<void> {
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL (or DATABASE_URL) is not set");
  const slug = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) throw new Error("Set OWNER_EMAIL and OWNER_PASSWORD first.");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const result = await setOwnerLogin(prisma, { slug, email, password });
    if (!result.ok) {
      const why: Record<typeof result.error, string> = {
        venue_not_found: `venue "${slug}" does not exist — run seed-restaurant.ts first`,
        owner_not_found: `venue "${slug}" has no owner membership`,
        email_taken: `${email} already belongs to another account (${result.detail})`,
        weak_password: "OWNER_PASSWORD must be at least 12 characters",
      };
      throw new Error(why[result.error]);
    }
    const changed = result.previousEmail === result.email ? "" : ` (was ${result.previousEmail})`;
    process.stdout.write(
      `✓ owner login for /r/${slug}: ${result.email}${changed} — password reset, old sessions signed out\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(
      `✗ set-owner-login failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
