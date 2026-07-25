import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { loginUser, signupUser } from "./auth-service";
import { asTenant, asUser } from "./tenant";

// Integration test for P1-2a's auth service. Uses the real DB so RLS,
// migrations, and the Argon2id path all run end-to-end.

describe("signupUser + loginUser", () => {
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

  it("signup creates user + tenant + owner membership and hashes with argon2id", async () => {
    const email = `p1-2a-${randomUUID()}@ex.com`;
    const result = await signupUser({
      email,
      password: "correct horse battery staple",
      tenantName: "Acme",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdUserIds.push(result.userId);
    createdTenantIds.push(result.tenantId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.emailVerifiedAt).toBeNull();

    const memberships = await asUser(result.userId, (tx) => tx.membership.findMany());
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe("owner");
    expect(memberships[0]!.tenantId).toBe(result.tenantId);
  });

  it("signup rejects duplicate email (case-insensitive via citext)", async () => {
    const base = `p1-2a-dup-${randomUUID()}@ex.com`;
    const first = await signupUser({ email: base, password: "12345678901234", tenantName: "One" });
    expect(first.ok).toBe(true);
    if (first.ok) {
      createdUserIds.push(first.userId);
      createdTenantIds.push(first.tenantId);
    }

    // Uppercase — must still collide because email is `citext`.
    const dupe = await signupUser({
      email: base.toUpperCase(),
      password: "12345678901234",
      tenantName: "Two",
    });
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) expect(dupe.error).toBe("email_taken");
  });

  it("login accepts the right password and rejects the wrong one", async () => {
    const email = `p1-2a-login-${randomUUID()}@ex.com`;
    const signup = await signupUser({
      email,
      password: "S3cureP4ssPhrase!",
      tenantName: "Login Co",
    });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);

    const good = await loginUser(email, "S3cureP4ssPhrase!");
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.userId).toBe(signup.userId);

    const bad = await loginUser(email, "wrong");
    expect(bad.ok).toBe(false);
  });

  it("login for an unknown email returns invalid_credentials (no user-existence leak)", async () => {
    const result = await loginUser(`does-not-exist-${randomUUID()}@ex.com`, "whatever");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_credentials");
  });
});
