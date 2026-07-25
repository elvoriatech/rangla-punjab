import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma, readDb } from "./db";

/**
 * Shared body for `asTenant` + `asTenantRead`. Opens a transaction on the
 * given client, sets the `app.current_tenant_id` GUC (transaction-local),
 * and runs `fn` with the transaction client. The tenant id is bound as a
 * parameter (never string-interpolated), so it is safe against injection.
 */
function runAsTenantOn<T>(
  db: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

/**
 * Run a unit of work scoped to a single tenant on the PRIMARY. Row-Level
 * Security policies filter every query to this tenant, so callers cannot
 * read or write another tenant's rows even with an explicit `where`. Use
 * this for every write path.
 */
export function asTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return runAsTenantOn(prisma, tenantId, fn);
}

/**
 * Read-only variant of {@link asTenant} that routes through `readDb`
 * (P2-12). When `DATABASE_URL_READ` is unset, `readDb === prisma` and
 * behaviour is identical to `asTenant`. When set, the transaction opens
 * on the replica but the RLS GUC is still set per-transaction, so
 * cross-tenant leaks are blocked on the replica the same way they are on
 * the primary. Callers MUST NOT issue writes inside `fn` — the replica
 * will reject them, and even on a same-server dev setup a write here
 * would defeat the "reads only" contract this function documents.
 */
export function asTenantRead<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return runAsTenantOn(readDb, tenantId, fn);
}

/**
 * Thrown when an authenticated user has no tenant to act as — either their
 * session refers to a deleted user, or the account has no membership. Callers
 * (route handlers, server actions) should treat this as 401/403.
 */
export class NoActiveTenantError extends Error {
  constructor(userId: string) {
    super(`user ${userId} has no active tenant`);
    this.name = "NoActiveTenantError";
  }
}

/**
 * Run a unit of work as an authenticated user. Resolves their active tenant
 * via `resolve_active_tenant(uid)` (SECURITY DEFINER, so the app role can
 * cross RLS for exactly this one lookup), then delegates to {@link asTenant}
 * so the same GUC and the same isolation guarantees apply. If the user has
 * no membership, throws {@link NoActiveTenantError} without opening the outer
 * work transaction.
 */
export async function asUser<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const tenantId = await resolveActiveTenantId(userId);
  if (!tenantId) throw new NoActiveTenantError(userId);
  return asTenant(tenantId, fn);
}

export async function resolveActiveTenantId(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ resolve_active_tenant: string | null }[]>`
    SELECT resolve_active_tenant(${userId})
  `;
  return rows[0]?.resolve_active_tenant ?? null;
}
