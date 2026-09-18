import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../src/lib/db";
import { signupUser, loginUser } from "../src/lib/auth-service";
import { asTenant } from "../src/lib/tenant";
import { setOwnerLogin } from "./set-owner-login";

/**
 * The owner-login reset must make the env's OWNER_EMAIL / OWNER_PASSWORD
 * work at /login for an ALREADY-provisioned restaurant — the exact case
 * seed-restaurant.ts no-ops on.
 */
describe("setOwnerLogin", () => {
  // The script runs as the DB owner (deploy.sh hands it DATABASE_URL, not the
  // RLS-restricted app role), so the test drives it the same way — the app
  // client in src/lib/db.ts would hide every venue without a tenant GUC.
  const ownerDb = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
  });
  const userIds: string[] = [];
  const tenantIds: string[] = [];

  afterAll(async () => {
    await ownerDb.$disconnect();
  });

  afterEach(async () => {
    for (const tid of tenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    tenantIds.length = 0;
  });

  async function provisioned(): Promise<{ slug: string; tenantId: string; oldEmail: string }> {
    const oldEmail = `old-owner-${randomUUID()}@ex.com`;
    const s = await signupUser({
      email: oldEmail,
      password: "Original-Pass-2026!",
      tenantName: "Owner reset test",
    });
    if (!s.ok) throw new Error("signup failed");
    userIds.push(s.userId);
    tenantIds.push(s.tenantId);
    const slug = `owner-reset-${randomUUID().slice(0, 8)}`;
    await asTenant(s.tenantId, (tx) =>
      tx.venue.create({ data: { tenantId: s.tenantId, name: "V", slug, currency: "EUR" } }),
    );
    return { slug, tenantId: s.tenantId, oldEmail };
  }

  it("re-points the existing owner to the new email + password; old login stops working", async () => {
    const { slug, oldEmail } = await provisioned();
    const email = `new-owner-${randomUUID()}@rangla.example`;
    const password = "Owner@Rangla-Fresh1";

    const result = await setOwnerLogin(ownerDb, { slug, email, password });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previousEmail).toBe(oldEmail);

    expect((await loginUser(email, password)).ok).toBe(true);
    expect((await loginUser(oldEmail, "Original-Pass-2026!")).ok).toBe(false);

    // Idempotent: running it again with the same env is a no-op success.
    const again = await setOwnerLogin(ownerDb, { slug, email, password });
    expect(again.ok).toBe(true);
    expect((await loginUser(email, password)).ok).toBe(true);
  });

  it("clears a stray platform-admin flag on the owner when another admin exists", async () => {
    const { slug, tenantId } = await provisioned();
    const ownerUserId = (
      await asTenant(tenantId, (tx) =>
        tx.membership.findFirstOrThrow({ where: { role: "owner" }, select: { userId: true } }),
      )
    ).userId;
    await ownerDb.user.update({ where: { id: ownerUserId }, data: { isPlatformAdmin: true } });

    // No other admin → flag must be left alone (would lock everyone out of /admin).
    // The local DB may already hold a seeded admin, so assert relative to that.
    const others = await ownerDb.user.count({
      where: { isPlatformAdmin: true, deletedAt: null, NOT: { id: ownerUserId } },
    });
    const email = `demote-${randomUUID()}@rangla.example`;
    const result = await setOwnerLogin(ownerDb, { slug, email, password: "Owner@Rangla-Fresh1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = await ownerDb.user.findUniqueOrThrow({
      where: { id: ownerUserId },
      select: { isPlatformAdmin: true },
    });
    if (others > 0) {
      expect(result.demotedFromPlatformAdmin).toBe(true);
      expect(after.isPlatformAdmin).toBe(false);
    } else {
      expect(result.stillPlatformAdmin).toBe(true);
      expect(after.isPlatformAdmin).toBe(true);
    }
  });

  it("refuses to take an email that belongs to someone else", async () => {
    const { slug } = await provisioned();
    const takenEmail = `taken-${randomUUID()}@ex.com`;
    const other = await signupUser({
      email: takenEmail,
      password: "Other-Pass-2026!!",
      tenantName: "Other",
    });
    if (!other.ok) throw new Error("signup failed");
    userIds.push(other.userId);
    tenantIds.push(other.tenantId);

    const result = await setOwnerLogin(ownerDb, {
      slug,
      email: takenEmail,
      password: "Owner@Rangla-Fresh1",
    });
    expect(result).toMatchObject({ ok: false, error: "email_taken" });
  });

  it("rejects short passwords and unknown venues without touching anything", async () => {
    const { slug, oldEmail } = await provisioned();
    expect(await setOwnerLogin(ownerDb, { slug, email: "x@ex.com", password: "short" })).toEqual({
      ok: false,
      error: "weak_password",
    });
    expect(
      await setOwnerLogin(ownerDb, {
        slug: "no-such-venue",
        email: "x@ex.com",
        password: "Long-Enough-Pass1",
      }),
    ).toEqual({ ok: false, error: "venue_not_found" });
    expect((await loginUser(oldEmail, "Original-Pass-2026!")).ok).toBe(true);
  });
});
