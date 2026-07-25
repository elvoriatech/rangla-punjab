import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant, asUser } from "./tenant";
import { resolveAdminBackupsPage } from "./admin-backups-page";
import { BACKUP_POLICY } from "./backup-policy";

describe("resolveAdminBackupsPage (P2-6)", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  });

  async function signup(label: string, opts: { demote?: boolean } = {}): Promise<string> {
    const s = await signupUser({
      email: `p2-6-${label}-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: `Backups ${label}`,
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);
    if (opts.demote) {
      await asUser(s.userId, (tx) =>
        tx.membership.updateMany({ where: { userId: s.userId }, data: { role: "staff" } }),
      );
    }
    return s.userId;
  }

  it("returns unauthenticated for a null userId", async () => {
    const r = await resolveAdminBackupsPage(null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("unauthenticated");
  });

  it("returns forbidden for a user with no membership", async () => {
    const r = await resolveAdminBackupsPage("no-such-user");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("forbidden");
  });

  it("returns forbidden for a staff user", async () => {
    const userId = await signup("staff", { demote: true });
    const r = await resolveAdminBackupsPage(userId);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("forbidden");
  });

  it("returns every retention row for a platform admin", async () => {
    const userId = await signup("admin");
    await prisma.user.update({ where: { id: userId }, data: { isPlatformAdmin: true } });
    const r = await resolveAdminBackupsPage(userId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((row) => row.tier)).toEqual(["daily", "weekly", "monthly", "pitr"]);
    // Rows are the same frozen objects the map holds — mutations
    // through the resolver's result must still throw.
    for (const row of r.rows) {
      expect(row).toBe(BACKUP_POLICY[row.tier]);
    }
  });
});
