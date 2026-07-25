import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires a driver adapter. One pg pool + one client, cached on
// globalThis so Next.js HMR in dev doesn't spawn a new pool per reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  readDb: PrismaClient | undefined;
};

function createClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  // Interactive-transaction ceiling raised from Prisma's 5 s default:
  // bulk tree-copies (publishDraft, template apply) legitimately exceed
  // it under load, and a mid-transaction abort leaves later queries on a
  // GUC-less connection → spurious RLS violations. A ceiling, not a
  // target — short transactions behave exactly as before.
  return new PrismaClient({
    adapter,
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  });
}

function primaryUrl(): string {
  // The app connects as the least-privilege role (RLS applies) — never the
  // migration superuser. Falls back to DATABASE_URL only if APP_DATABASE_URL
  // is unset (e.g. a throwaway script), which is intentionally not RLS-safe.
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL (or DATABASE_URL) is not set");
  return url;
}

export const prisma = globalForPrisma.prisma ?? createClient(primaryUrl());

/**
 * P2-12 read-replica seam. When `DATABASE_URL_READ` is set, this returns a
 * distinct PrismaClient pointing at the replica; otherwise it returns the
 * primary unchanged so dev + CI need only one Postgres. Kept as a pure
 * function so tests can drive it with any URL without resetting modules.
 *
 * The RLS GUC (`app.current_tenant_id`) is set per transaction via
 * `asTenantRead` in tenant.ts, so cross-tenant reads are still blocked on
 * the replica — the seam does not weaken isolation.
 *
 * Only read paths (public-menu loader, sitemap) may use `readDb`. Every
 * write path stays on `prisma`.
 */
export function resolveReadDb(primary: PrismaClient, readUrl: string | undefined): PrismaClient {
  if (!readUrl) return primary;
  return createClient(readUrl);
}

export const readDb: PrismaClient =
  globalForPrisma.readDb ?? resolveReadDb(prisma, process.env.DATABASE_URL_READ);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.readDb = readDb;
}
