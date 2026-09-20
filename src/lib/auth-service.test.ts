import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import {
  changeUserPassword,
  loginUser,
  OWNER_PASSWORD_MIN_LENGTH,
  signupUser,
} from "./auth-service";
import { verifySessionValue } from "./auth";
import { signSession } from "./session";
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

/**
 * Changing your own password (owner + restaurant app share this one call).
 *
 * The assertions worth having are the ones a form can't make for itself:
 * that the CURRENT password is genuinely required, that the policy is the
 * reset form's own `min(12)` rather than a softer one, and that a success
 * both re-credentials the account and pulls the rug from every session
 * issued before it.
 */
describe("changeUserPassword", () => {
  const CURRENT = "S3cureP4ssPhrase!";
  const NEXT = "An3ntirelyNewPhrase!";
  let userId: string;
  let tenantId: string;

  beforeEach(async () => {
    const signup = await signupUser({
      email: `pw-change-${randomUUID()}@ex.com`,
      password: CURRENT,
      tenantName: "Password Co",
    });
    if (!signup.ok) throw new Error("signup failed");
    userId = signup.userId;
    tenantId = signup.tenantId;
  });

  afterEach(async () => {
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const snapshot = (): Promise<{ passwordHash: string; sessionsValidFrom: Date }> =>
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, sessionsValidFrom: true },
    });

  it("changes the password, and the OLD one stops working", async () => {
    const before = await snapshot();
    const result = await changeUserPassword(userId, {
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmPassword: NEXT,
    });
    expect(result.ok).toBe(true);

    const after = await snapshot();
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash).toMatch(/^\$argon2id\$/);

    const email = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email;
    expect((await loginUser(email, NEXT)).ok).toBe(true);
    expect((await loginUser(email, CURRENT)).ok).toBe(false);
  });

  it("signs other sessions out: the cutoff moves, old tokens die, new ones live", async () => {
    const before = await snapshot();
    const otherDevice = signSession(userId);
    expect(await verifySessionValue(otherDevice)).not.toBeNull();

    // `sessions_valid_from` is compared against a token's whole-second
    // `iat` (see `issuedBeforeCutoff`), so a token minted in the SAME
    // second as the change legitimately survives. Cross the boundary
    // first, or this asserts nothing.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = await changeUserPassword(userId, {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await snapshot();
    expect(after.sessionsValidFrom.getTime()).toBeGreaterThan(before.sessionsValidFrom.getTime());
    expect(after.sessionsValidFrom.getTime()).toBe(result.sessionsValidFrom.getTime());

    // The phone that was left on the pass is signed out …
    expect(await verifySessionValue(otherDevice)).toBeNull();
    // … and the device that did the changing can be kept signed in by
    // re-issuing AFTER the write. This is what both surfaces do.
    const reissued = signSession(userId);
    expect((await verifySessionValue(reissued))?.userId).toBe(userId);
  });

  it("refuses a wrong current password, and writes nothing", async () => {
    const before = await snapshot();
    const result = await changeUserPassword(userId, {
      currentPassword: "not-my-password",
      newPassword: NEXT,
    });
    expect(result).toEqual({ ok: false, error: "wrong_password" });
    expect(await snapshot()).toEqual(before);
  });

  it("checks the current password BEFORE the policy — a stranger learns nothing", async () => {
    // Short AND mismatched AND wrong: the answer is still the one that
    // says least.
    const result = await changeUserPassword(userId, {
      currentPassword: "not-my-password",
      newPassword: "short",
      confirmPassword: "different",
    });
    expect(result).toEqual({ ok: false, error: "wrong_password" });
  });

  it("refuses a new password that doesn't match its confirmation", async () => {
    const before = await snapshot();
    const result = await changeUserPassword(userId, {
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmPassword: `${NEXT}x`,
    });
    expect(result).toEqual({ ok: false, error: "mismatch" });
    expect(await snapshot()).toEqual(before);
  });

  it("enforces the reset form's own minimum length", async () => {
    expect(OWNER_PASSWORD_MIN_LENGTH).toBe(12);
    const tooShort = "a".repeat(OWNER_PASSWORD_MIN_LENGTH - 1);
    const result = await changeUserPassword(userId, {
      currentPassword: CURRENT,
      newPassword: tooShort,
      confirmPassword: tooShort,
    });
    expect(result).toEqual({ ok: false, error: "too_short" });

    // Exactly at the floor is accepted.
    const atFloor = "b".repeat(OWNER_PASSWORD_MIN_LENGTH);
    expect(
      await changeUserPassword(userId, { currentPassword: CURRENT, newPassword: atFloor }),
    ).toMatchObject({ ok: true });
  });

  it("refuses re-saving the password that is already set", async () => {
    const before = await snapshot();
    const result = await changeUserPassword(userId, {
      currentPassword: CURRENT,
      newPassword: CURRENT,
      confirmPassword: CURRENT,
    });
    expect(result).toEqual({ ok: false, error: "same_as_current" });
    // Crucially the cutoff did NOT move: a no-op must not sign the
    // restaurant's other devices out.
    expect(await snapshot()).toEqual(before);
  });

  it("answers wrong_password for a user that isn't there", async () => {
    const result = await changeUserPassword(`cuid-that-does-not-exist-${randomUUID()}`, {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
    expect(result).toEqual({ ok: false, error: "wrong_password" });
  });
});
