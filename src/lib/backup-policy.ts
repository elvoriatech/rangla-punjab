/**
 * Backup + point-in-time-recovery policy, codified. IONOS Managed
 * Postgres holds the actual snapshots; this module is the app-side
 * source of truth for what the retention is *supposed* to be, so the
 * operator `/admin/backups` page and the P2-7 restore-
 * drill script both read the same numbers.
 *
 * Retention matches roadmap §6 "Backups: daily automated + PITR;
 * restore drill documented and rehearsed" and the concrete windows
 * agreed with the architect in P2-6:
 *   - daily snapshots kept 30 days
 *   - weekly snapshots kept 8 weeks
 *   - monthly snapshots kept 12 months
 *   - point-in-time-recovery window 7 days
 *
 * The map is deep-frozen so a route handler cannot mutate the
 * displayed retention at runtime and drift the operator's expectation
 * away from what IONOS is actually configured to hold.
 */

export type BackupTier = "daily" | "weekly" | "monthly" | "pitr";

export interface BackupRow {
  readonly tier: BackupTier;
  readonly label: string;
  readonly retentionValue: number;
  readonly retentionUnit: "days" | "weeks" | "months";
  readonly description: string;
}

const RAW_POLICY: Record<BackupTier, BackupRow> = {
  daily: {
    tier: "daily",
    label: "Daily snapshots",
    retentionValue: 30,
    retentionUnit: "days",
    description:
      "Full-cluster snapshot taken every 24h off the primary, held for a rolling month. Restore target = anything up to yesterday.",
  },
  weekly: {
    tier: "weekly",
    label: "Weekly snapshots",
    retentionValue: 8,
    retentionUnit: "weeks",
    description:
      "One snapshot from each of the last 8 weeks kept in warm storage. Restore target = 'roughly N weeks ago' when the daily window is not enough.",
  },
  monthly: {
    tier: "monthly",
    label: "Monthly snapshots",
    retentionValue: 12,
    retentionUnit: "months",
    description:
      "One snapshot per month for the last year, kept in cold storage. Restore target = year-over-year audit + compliance requests.",
  },
  pitr: {
    tier: "pitr",
    label: "Point-in-time recovery",
    retentionValue: 7,
    retentionUnit: "days",
    description:
      "Continuous WAL archive lets restores land at any second within the last week. This is the tool for incident recovery ('roll back 40 minutes').",
  },
};

const TIER_ORDER: readonly BackupTier[] = ["daily", "weekly", "monthly", "pitr"];

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

export const BACKUP_POLICY: Readonly<Record<BackupTier, BackupRow>> = deepFreeze(RAW_POLICY);

/**
 * Return the backup policy as an ordered array shaped for a status
 * page / runbook render. Same objects the frozen map holds, so any
 * attempt to mutate a row from the caller throws.
 */
export function describeBackupPolicy(): BackupRow[] {
  return TIER_ORDER.map((tier) => BACKUP_POLICY[tier]);
}
