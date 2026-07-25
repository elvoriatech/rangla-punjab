import { isPlatformAdmin } from "./platform-admin";
import { describeBackupPolicy, type BackupRow } from "./backup-policy";

/**
 * Resolver for `/admin/backups` (P3-3 — ops folded into the Operator
 * Console). Read-only surface (snapshots live on the managed Postgres,
 * not here). Operator-level, so gated on isPlatformAdmin. Splitting the
 * resolver from the React page keeps the auth path vitest-friendly.
 */

export type AdminBackupsResult =
  { ok: true; rows: BackupRow[] } | { ok: false; error: "unauthenticated" | "forbidden" };

export async function resolveAdminBackupsPage(userId: string | null): Promise<AdminBackupsResult> {
  if (!userId) return { ok: false, error: "unauthenticated" };
  if (!(await isPlatformAdmin(userId))) return { ok: false, error: "forbidden" };
  return { ok: true, rows: describeBackupPolicy() };
}
