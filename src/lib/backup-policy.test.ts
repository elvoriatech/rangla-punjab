import { describe, expect, it } from "vitest";
import { BACKUP_POLICY, describeBackupPolicy } from "./backup-policy";

// The retention windows the task spec locks in. Any drift trips the
// vitest gate so the app-side policy cannot silently disagree with
// what IONOS is holding.
const EXPECTED_RETENTION = {
  daily: { value: 30, unit: "days" },
  weekly: { value: 8, unit: "weeks" },
  monthly: { value: 12, unit: "months" },
  pitr: { value: 7, unit: "days" },
} as const;

describe("backup policy (P2-6)", () => {
  it("declares exactly four tiers in the P2-6 spec order", () => {
    const arr = describeBackupPolicy();
    expect(arr.map((r) => r.tier)).toEqual(["daily", "weekly", "monthly", "pitr"]);
  });

  it.each(
    Object.entries(EXPECTED_RETENTION) as Array<
      [keyof typeof EXPECTED_RETENTION, { value: number; unit: string }]
    >,
  )("%s tier retention matches the P2-6 spec", (tier, expected) => {
    expect(BACKUP_POLICY[tier].retentionValue).toBe(expected.value);
    expect(BACKUP_POLICY[tier].retentionUnit).toBe(expected.unit);
  });

  it("every row carries a non-empty label + description", () => {
    for (const row of describeBackupPolicy()) {
      expect(row.label).toBeTruthy();
      expect(row.description.length).toBeGreaterThan(30);
    }
  });

  it("frozen map mutation throws (defence against runtime drift)", () => {
    expect(() => {
      (BACKUP_POLICY as unknown as Record<string, unknown>).annual = "nope";
    }).toThrow();
    expect(() => {
      (BACKUP_POLICY.daily as unknown as { retentionValue: number }).retentionValue = 9999;
    }).toThrow();
  });

  it("describeBackupPolicy returns the same frozen objects as the map", () => {
    for (const row of describeBackupPolicy()) {
      expect(row).toBe(BACKUP_POLICY[row.tier]);
    }
  });
});
