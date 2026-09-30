import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loginUser, signupUser } from "./auth-service";
import { prisma } from "./db";
import { asTenant } from "./tenant";
import { can, getAccess } from "./team-access";
import {
  createStaffMember,
  listTeam,
  removeStaffMember,
  setStaffPassword,
  updateStaffMember,
} from "./team-service";

/**
 * Team logins (owner, 2026-09-30): the owner creates a login with a
 * password they set and ticks what it may open. What must hold:
 * - a team member gets exactly the ticked areas, nothing else;
 * - only the owner manages the team — a team member cannot, and another
 *   restaurant's owner cannot touch this one's team;
 * - a new password or a removal ends the old login.
 */

describe("team logins", () => {
  let ownerId: string;
  let tenantId: string;
  let otherOwnerId: string;
  let otherTenantId: string;
  const created: string[] = [];

  beforeAll(async () => {
    const a = await signupUser({
      email: `team-owner-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Team Test House",
    });
    const b = await signupUser({
      email: `team-other-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Other House",
    });
    if (!a.ok || !b.ok) throw new Error("signup failed");
    ownerId = a.userId;
    tenantId = a.tenantId;
    otherOwnerId = b.userId;
    otherTenantId = b.tenantId;
  });

  afterAll(async () => {
    for (const t of [tenantId, otherTenantId]) {
      await asTenant(t, (tx) => tx.membership.deleteMany({}));
      await asTenant(t, (tx) => tx.tenant.deleteMany({}));
    }
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, ...created] } } });
  });

  async function addStaff(permissions: string[], password = "kitchen-2026") {
    const email = `staff-${randomUUID().slice(0, 8)}@ex.com`;
    const r = await createStaffMember(ownerId, { name: "Ali", email, password, permissions });
    if (!r.ok) throw new Error(r.error);
    created.push(r.value.userId);
    const team = await listTeam(ownerId);
    const m = team.ok ? team.value.find((x) => x.userId === r.value.userId) : undefined;
    if (!m) throw new Error("member missing");
    return { ...m, password };
  }

  it("the owner has every area", async () => {
    const access = await getAccess(ownerId);
    expect(access?.isOwner).toBe(true);
    expect(can(access, "settings")).toBe(true);
    expect(can(access, "menu")).toBe(true);
  });

  it("a team member gets exactly the ticked areas and can sign in with the owner's password", async () => {
    const m = await addStaff(["orders", "kitchen", "qr", "made-up-area"]);
    expect(m.permissions).toEqual(["orders", "kitchen", "qr"]);
    const access = await getAccess(m.userId);
    expect(access?.isOwner).toBe(false);
    expect(access?.tenantId).toBe(tenantId);
    expect(can(access, "orders")).toBe(true);
    expect(can(access, "kitchen")).toBe(true);
    expect(can(access, "qr")).toBe(true);
    expect(can(access, "menu")).toBe(false);
    expect(can(access, "settings")).toBe(false);
    expect(can(access, "overview")).toBe(false);
    const login = await loginUser(m.email, m.password);
    expect(login.ok).toBe(true);
  });

  it("changing the ticked areas applies at once", async () => {
    const m = await addStaff(["orders"]);
    expect(
      (await updateStaffMember(ownerId, m.membershipId, { name: "Ali K.", permissions: ["menu"] }))
        .ok,
    ).toBe(true);
    const access = await getAccess(m.userId);
    expect(can(access, "menu")).toBe(true);
    expect(can(access, "orders")).toBe(false);
  });

  it("only the owner manages the team", async () => {
    const m = await addStaff(["orders", "settings"]);
    // A team member — even with Settings ticked — cannot see or change it.
    expect(await listTeam(m.userId)).toEqual({ ok: false, error: "forbidden" });
    expect(
      await createStaffMember(m.userId, {
        name: "Sneaky",
        email: `x-${randomUUID()}@ex.com`,
        password: "whatever-123",
        permissions: ["settings"],
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await updateStaffMember(m.userId, m.membershipId, {
        name: "Me",
        permissions: ["menu", "reports", "giftcards"],
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    // Another restaurant's owner cannot reach this team.
    expect(await setStaffPassword(otherOwnerId, m.membershipId, "taken-over-1")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await removeStaffMember(otherOwnerId, m.membershipId)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("the owner's own membership cannot be edited or removed from the Team page", async () => {
    const team = await listTeam(ownerId);
    const self = team.ok ? team.value.find((x) => x.isOwner) : undefined;
    expect(self).toBeDefined();
    expect(await removeStaffMember(ownerId, self!.membershipId)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("rejects a short password and an address already in use", async () => {
    expect(
      await createStaffMember(ownerId, {
        name: "Short",
        email: `s-${randomUUID()}@ex.com`,
        password: "1234567",
        permissions: [],
      }),
    ).toEqual({ ok: false, error: "weak_password" });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(
      await createStaffMember(ownerId, {
        name: "Dup",
        email: owner.email.toUpperCase(),
        password: "long-enough-1",
        permissions: [],
      }),
    ).toEqual({ ok: false, error: "email_taken" });
  });

  it("a new password replaces the old one and signs the person out", async () => {
    const m = await addStaff(["orders"]);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: m.userId } });
    expect((await setStaffPassword(ownerId, m.membershipId, "brand-new-pass")).ok).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: m.userId } });
    expect(after.sessionsValidFrom.getTime()).toBeGreaterThan(before.sessionsValidFrom.getTime());
    expect((await loginUser(m.email, m.password)).ok).toBe(false);
    expect((await loginUser(m.email, "brand-new-pass")).ok).toBe(true);
  });

  it("removing a member deletes the login, so the address can be used again", async () => {
    const m = await addStaff(["orders"]);
    expect((await removeStaffMember(ownerId, m.membershipId)).ok).toBe(true);
    expect(await prisma.user.findUnique({ where: { id: m.userId } })).toBeNull();
    expect(await getAccess(m.userId)).toBeNull();
    expect((await loginUser(m.email, m.password)).ok).toBe(false);
    const again = await createStaffMember(ownerId, {
      name: "Ali again",
      email: m.email,
      password: "back-again-1",
      permissions: ["kitchen"],
    });
    expect(again.ok).toBe(true);
    if (again.ok) created.push(again.value.userId);
  });
});
