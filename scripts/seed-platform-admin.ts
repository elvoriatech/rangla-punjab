import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";

/**
 * Seed (or refresh) the Elvoria platform-admin account for local dev.
 *
 *   pnpm exec tsx --env-file=.env scripts/seed-platform-admin.ts
 *
 * Idempotent: re-running resets the password and re-asserts the flag.
 * The users table is not tenant-scoped, so a direct client works; same
 * connection pattern as seed-demo-venue.ts.
 */

// Production: set ADMIN_EMAIL + ADMIN_PASSWORD in the environment —
// the dev defaults are refused outside development so the well-known
// local password can never reach a real deployment.
const isProd = process.env.NODE_ENV === "production";
const EMAIL = process.env.ADMIN_EMAIL ?? (isProd ? "" : "admin@elvoria.local");
const PASSWORD = process.env.ADMIN_PASSWORD ?? (isProd ? "" : "Elvoria-Admin-2026!");

async function main(): Promise<void> {
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL (or DATABASE_URL) is not set");
  if (!EMAIL || !PASSWORD) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (required in production).");
  }
  if (PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const passwordHash = await hashPassword(PASSWORD);
    const user = await prisma.user.upsert({
      where: { email: EMAIL },
      create: {
        email: EMAIL,
        passwordHash,
        emailVerifiedAt: new Date(),
        isPlatformAdmin: true,
      },
      update: { passwordHash, isPlatformAdmin: true, deletedAt: null },
      select: { id: true, email: true },
    });
    console.log(`platform admin ready: ${user.email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
