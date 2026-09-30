import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { hashPassword } from "./password";
import { asTenant } from "./tenant";
import { getAccess, normalizePermissions, type Permission } from "./team-access";
import { OWNER_PASSWORD_MAX_LENGTH } from "./auth-service";

/**
 * The owner's Team page (owner, 2026-09-30): the owner creates a login
 * for a manager or staff member — email + a password the OWNER sets and
 * hands over — and ticks what it may open. No invitation email and no
 * forced change on first login: the password stays what the owner set
 * until the owner sets another one.
 *
 * Every function takes the ACTING user and refuses unless they are the
 * restaurant's owner; the page's own `requireOwner()` is the first gate,
 * this is the second.
 *
 * A new password or a removal bumps the person's `sessions_valid_from`,
 * which signs them out on every device on their next request. A change of
 * ticked areas needs no such bump: access is read from the membership on
 * every request.
 */

/** Staff passwords: the owner types them, so a floor they can meet. */
export const STAFF_PASSWORD_MIN_LENGTH = 8;

export interface TeamMember {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  isOwner: boolean;
  permissions: Permission[];
  createdAt: Date;
}

export type TeamError =
  "forbidden" | "invalid_email" | "weak_password" | "invalid_name" | "email_taken" | "not_found";

type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: TeamError };

async function ownerTenant(actingUserId: string): Promise<string | null> {
  const access = await getAccess(actingUserId);
  return access?.isOwner ? access.tenantId : null;
}

function cleanEmail(raw: string): string | null {
  const email = raw.trim();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function passwordOk(password: string): boolean {
  return (
    password.length >= STAFF_PASSWORD_MIN_LENGTH && password.length <= OWNER_PASSWORD_MAX_LENGTH
  );
}

export async function listTeam(actingUserId: string): Promise<Result<TeamMember[]>> {
  const tenantId = await ownerTenant(actingUserId);
  if (!tenantId) return { ok: false, error: "forbidden" };
  const rows = await asTenant(tenantId, (tx) =>
    tx.membership.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        userId: true,
        role: true,
        permissions: true,
        displayName: true,
        createdAt: true,
      },
    }),
  );
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) }, deletedAt: null },
    select: { id: true, email: true },
  });
  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  return {
    ok: true,
    value: rows
      .filter((r) => emailOf.has(r.userId))
      .map((r) => ({
        membershipId: r.id,
        userId: r.userId,
        email: emailOf.get(r.userId)!,
        displayName: r.displayName,
        isOwner: r.role === "owner",
        permissions: normalizePermissions(r.permissions),
        createdAt: r.createdAt,
      })),
  };
}

export async function createStaffMember(
  actingUserId: string,
  input: { name: string; email: string; password: string; permissions: readonly string[] },
): Promise<Result<{ userId: string }>> {
  const tenantId = await ownerTenant(actingUserId);
  if (!tenantId) return { ok: false, error: "forbidden" };
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) return { ok: false, error: "invalid_name" };
  const email = cleanEmail(input.email);
  if (!email) return { ok: false, error: "invalid_email" };
  if (!passwordOk(input.password)) return { ok: false, error: "weak_password" };

  const passwordHash = await hashPassword(input.password);
  try {
    // The owner vouches for this address, so it counts as verified: the
    // console's "verify your email" banner is for owners' own sign-ups.
    const user = await prisma.user.create({
      data: { email, passwordHash, emailVerifiedAt: new Date() },
      select: { id: true },
    });
    await asTenant(tenantId, (tx) =>
      tx.membership.create({
        data: {
          tenantId,
          userId: user.id,
          role: "staff",
          displayName: name,
          permissions: normalizePermissions(input.permissions),
        },
      }),
    );
    return { ok: true, value: { userId: user.id } };
  } catch (err) {
    // citext unique index: any existing login with that address, in any
    // restaurant, including the owner's own.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "email_taken" };
    }
    throw err;
  }
}

/** A staff membership of the owner's own restaurant, or null. */
async function staffMembership(
  tenantId: string,
  membershipId: string,
): Promise<{ id: string; userId: string } | null> {
  return asTenant(tenantId, (tx) =>
    tx.membership.findFirst({
      where: { id: membershipId, role: "staff" },
      select: { id: true, userId: true },
    }),
  );
}

export async function updateStaffMember(
  actingUserId: string,
  membershipId: string,
  input: { name: string; permissions: readonly string[] },
): Promise<Result> {
  const tenantId = await ownerTenant(actingUserId);
  if (!tenantId) return { ok: false, error: "forbidden" };
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) return { ok: false, error: "invalid_name" };
  const m = await staffMembership(tenantId, membershipId);
  if (!m) return { ok: false, error: "not_found" };
  await asTenant(tenantId, (tx) =>
    tx.membership.update({
      where: { id: m.id },
      data: { displayName: name, permissions: normalizePermissions(input.permissions) },
    }),
  );
  return { ok: true, value: undefined };
}

export async function setStaffPassword(
  actingUserId: string,
  membershipId: string,
  password: string,
): Promise<Result> {
  const tenantId = await ownerTenant(actingUserId);
  if (!tenantId) return { ok: false, error: "forbidden" };
  if (!passwordOk(password)) return { ok: false, error: "weak_password" };
  const m = await staffMembership(tenantId, membershipId);
  if (!m) return { ok: false, error: "not_found" };
  await prisma.user.update({
    where: { id: m.userId },
    data: { passwordHash: await hashPassword(password), sessionsValidFrom: new Date() },
  });
  return { ok: true, value: undefined };
}

/**
 * Remove a person from the team: their membership goes, and so does the
 * login itself when this restaurant was its only one (a staff account
 * exists for the restaurant — it is not someone's personal account).
 */
export async function removeStaffMember(
  actingUserId: string,
  membershipId: string,
): Promise<Result> {
  const tenantId = await ownerTenant(actingUserId);
  if (!tenantId) return { ok: false, error: "forbidden" };
  const m = await staffMembership(tenantId, membershipId);
  if (!m) return { ok: false, error: "not_found" };
  await asTenant(tenantId, (tx) => tx.membership.delete({ where: { id: m.id } }));
  const elsewhere = await prisma.membership.count({ where: { userId: m.userId } });
  if (elsewhere === 0) {
    // Hard delete, so the address is free again should the owner re-add
    // the person later; everything hanging off a user cascades (devices,
    // tokens), and nothing financial references a staff login.
    await prisma.user.delete({ where: { id: m.userId } });
  } else {
    await prisma.user.update({
      where: { id: m.userId },
      data: { sessionsValidFrom: new Date() },
    });
  }
  return { ok: true, value: undefined };
}
