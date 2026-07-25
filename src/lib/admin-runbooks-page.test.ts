import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant, asUser } from "./tenant";
import { resolveAdminRunbooksPage } from "./admin-runbooks-page";
import { SLO_IDS } from "./slo";
import { RUNBOOK_NAMES } from "./runbooks";

describe("resolveAdminRunbooksPage (P2-5)", () => {
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
    const signup = await signupUser({
      email: `p2-5-${label}-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: `Admin ${label}`,
    });
    if (!signup.ok) throw new Error("signup failed");
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);
    // Signup creates an owner membership. For non-owner tests we demote
    // the row to `staff` under the tenant's own RLS scope.
    if (opts.demote) {
      await asUser(signup.userId, (tx) =>
        tx.membership.updateMany({ where: { userId: signup.userId }, data: { role: "staff" } }),
      );
    }
    return signup.userId;
  }

  it("returns forbidden when the user has no active membership", async () => {
    const result = await resolveAdminRunbooksPage("no-such-user-id");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("forbidden");
  });

  it("returns unauthenticated when no user id is provided", async () => {
    const result = await resolveAdminRunbooksPage(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unauthenticated");
  });

  it("returns forbidden for a staff user (non-owner)", async () => {
    const userId = await signup("staff", { demote: true });
    const result = await resolveAdminRunbooksPage(userId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("forbidden");
  });

  it("returns every SLO + every runbook for a platform admin", async () => {
    const userId = await signup("admin");
    await prisma.user.update({ where: { id: userId }, data: { isPlatformAdmin: true } });
    const result = await resolveAdminRunbooksPage(userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slos.map((s) => s.id).sort()).toEqual([...SLO_IDS].sort());
    expect(result.runbooks.map((r) => r.name).sort()).toEqual([...RUNBOOK_NAMES].sort());
  });
});
