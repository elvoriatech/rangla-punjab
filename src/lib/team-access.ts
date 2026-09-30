import { redirect } from "next/navigation";
import { getSessionUserId } from "./auth";
import { asUser, NoActiveTenantError } from "./tenant";

/**
 * Who may open what in the dashboard (owner, 2026-09-30).
 *
 * The owner has everything. A `staff` membership — a manager or a member
 * of the team, created by the owner on the Team page — has exactly the
 * areas the owner ticked, stored on `memberships.permissions`. Deny by
 * default: an area that is not in the list is closed, and a name this
 * code does not know is ignored.
 *
 * Some things are never delegable and therefore are not in the list at
 * all: payments/billing, the Team page itself, branches, and anything
 * that deletes or transfers the account. Those are `requireOwner()`.
 *
 * Every page AND every server action / API route checks on the server.
 * Hiding a rail link is only the courtesy; the check is the lock.
 */

export {
  PERMISSIONS,
  PERMISSION_LABELS,
  PRESETS,
  normalizePermissions,
  type Permission,
} from "./team-permissions";
import { normalizePermissions, PERMISSIONS, type Permission } from "./team-permissions";

export interface Access {
  userId: string;
  tenantId: string;
  isOwner: boolean;
  permissions: ReadonlySet<Permission>;
}

/** The signed-in user's standing in their restaurant, or null (no membership). */
export async function getAccess(userId: string): Promise<Access | null> {
  try {
    const m = await asUser(userId, (tx) =>
      tx.membership.findFirst({
        where: { userId },
        // Same preference as resolve_active_tenant(): an owner row first.
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: { tenantId: true, role: true, permissions: true },
      }),
    );
    if (!m) return null;
    return {
      userId,
      tenantId: m.tenantId,
      isOwner: m.role === "owner",
      permissions: new Set(normalizePermissions(m.permissions)),
    };
  } catch (err) {
    if (err instanceof NoActiveTenantError) return null;
    throw err;
  }
}

export function can(access: Access | null, permission: Permission): boolean {
  if (!access) return false;
  return access.isOwner || access.permissions.has(permission);
}

/** Where a staff member lands when they open something they may not. */
export const NO_ACCESS_PATH = "/dashboard/no-access";

/**
 * Guard for a dashboard page or server action: the signed-in user's id,
 * or a redirect (to /login when signed out, to the no-access page when
 * the area is not ticked). Returns the userId so call sites stay one line.
 */
export async function requirePermission(permission: Permission): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const access = await getAccess(userId);
  if (!can(access, permission)) redirect(NO_ACCESS_PATH);
  return userId;
}

/** Where each area lives, for sending a team member to the first one
 *  they may open. */
export const PERMISSION_HOME: Record<Permission, string> = {
  overview: "/dashboard",
  orders: "/dashboard/orders",
  reservations: "/dashboard/reservations",
  catering: "/dashboard/catering",
  kitchen: "/kitchen",
  qr: "/dashboard/qr",
  menu: "/dashboard/categories",
  giftcards: "/dashboard/gift-cards",
  appearance: "/dashboard/appearance",
  reports: "/dashboard/reports",
  settings: "/dashboard/settings",
};

/**
 * The start page's guard. A team member without Overview lands on their
 * first ticked area instead of a "no access" wall right after signing in.
 */
export async function requireOverview(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const access = await getAccess(userId);
  if (can(access, "overview")) return userId;
  const first = PERMISSIONS.find((p) => access?.permissions.has(p));
  redirect(first ? PERMISSION_HOME[first] : NO_ACCESS_PATH);
}

/** Guard for owner-only areas: payments, Team, branches. */
export async function requireOwner(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const access = await getAccess(userId);
  if (!access?.isOwner) redirect(NO_ACCESS_PATH);
  return userId;
}

/**
 * Same check for an API route, which must answer with a status rather
 * than redirect. Null ⇒ the caller returns 401/403.
 */
export async function permittedUserId(
  permission: Permission,
): Promise<{ userId: string } | { error: 401 | 403 }> {
  const userId = await getSessionUserId();
  if (!userId) return { error: 401 };
  return can(await getAccess(userId), permission) ? { userId } : { error: 403 };
}
