import { prisma } from "./db";
import { asTenant } from "./tenant";
import { deletePrefix } from "./image-storage";
import { createLogger } from "./logger";

/**
 * Platform-admin (Guesto staff) services. Access rides on
 * `users.is_platform_admin` — deliberately not a tenant membership, so
 * staff accounts never appear inside any restaurant's data.
 *
 * Cross-tenant reads go through the SECURITY DEFINER seam
 * (`admin_list_tenants`, `admin_set_tenant_plan`) because every tenant
 * table is FORCE RLS; the functions expose a narrow projection and the
 * app gates every call behind the flag check below.
 */

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { isPlatformAdmin: true },
  });
  return user?.isPlatformAdmin === true;
}

export interface AdminTenantRow {
  id: string;
  name: string;
  status: string;
  deletedAt: Date | null;
  entitlementOverrides: unknown;
  createdAt: Date;
  ownerEmail: string | null;
  ownerVerified: boolean | null;
  onboardingState: unknown;
  hasPublished: boolean;
  scans30d: number;
  venueName: string | null;
  venueSlug: string | null;
  ordersToday: number;
  orders30d: number;
  revenue30dCents: number;
}

export async function adminListTenants(userId: string): Promise<AdminTenantRow[] | null> {
  if (!(await isPlatformAdmin(userId))) return null;
  const rows = await prisma.$queryRaw<
    {
      id: string;
      name: string;
      status: string;
      deleted_at: Date | null;
      plan_override: string | null;
      entitlement_overrides: unknown;
      created_at: Date;
      owner_email: string | null;
      owner_verified: boolean | null;
      onboarding_state: unknown;
      has_published: boolean;
      venue_name: string | null;
      venue_slug: string | null;
      orders_today: bigint;
      orders_30d: bigint;
      revenue_30d_cents: bigint;
      scans_30d: bigint;
    }[]
  >`SELECT * FROM admin_list_tenants()`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    deletedAt: r.deleted_at,
    entitlementOverrides: r.entitlement_overrides,
    createdAt: r.created_at,
    ownerEmail: r.owner_email,
    ownerVerified: r.owner_verified,
    onboardingState: r.onboarding_state,
    hasPublished: r.has_published,
    scans30d: Number(r.scans_30d),
    venueName: r.venue_name,
    venueSlug: r.venue_slug,
    ordersToday: Number(r.orders_today),
    orders30d: Number(r.orders_30d),
    revenue30dCents: Number(r.revenue_30d_cents),
  }));
}

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */

const auditLog = createLogger();

/** Write a platform-admin action into the tenant's audit trail. Best
 *  effort: a missing month-partition must never break the action that
 *  is being audited — it degrades to a structured log line. */
export async function writeAudit(
  tenantId: string,
  actorUserId: string,
  kind: string,
  targetId: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await asTenant(tenantId, (tx) =>
      tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId,
          kind,
          targetKind: "tenant",
          targetId,
          meta: meta as object,
          at: new Date(),
        },
      }),
    );
  } catch (err) {
    auditLog.warn("audit.write_failed", {
      tenantId,
      kind,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

export interface AdminAuditRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  actor: string | null;
  kind: string;
  targetKind: string;
  targetId: string;
  meta: unknown;
  at: Date;
}

export async function adminListAuditEvents(
  userId: string,
  limit = 100,
): Promise<AdminAuditRow[] | null> {
  if (!(await isPlatformAdmin(userId))) return null;
  const rows = await prisma.$queryRaw<
    {
      id: string;
      tenant_id: string;
      tenant_name: string | null;
      actor: string | null;
      kind: string;
      target_kind: string;
      target_id: string;
      meta: unknown;
      at: Date;
    }[]
  >`SELECT * FROM admin_list_audit_events(${limit})`;
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    actor: r.actor,
    kind: r.kind,
    targetKind: r.target_kind,
    targetId: r.target_id,
    meta: r.meta,
    at: r.at,
  }));
}

/* ------------------------------------------------------------------ */
/* Suspend / delete / restore                                          */
/* ------------------------------------------------------------------ */

export type AdminLeverResult = "ok" | "forbidden" | "invalid";

/** Suspend or reactivate a tenant. Enforcement is automatic: the plan
 *  derivation treats "suspended" as all-off + menu hidden, so the
 *  public menu, order API, and dashboard react without further code. */
export async function adminSetTenantStatus(
  userId: string,
  tenantId: string,
  status: "active" | "suspended",
): Promise<AdminLeverResult> {
  if (!(await isPlatformAdmin(userId))) return "forbidden";
  if (!tenantId || tenantId.length > 64 || !["active", "suspended"].includes(status)) {
    return "invalid";
  }
  await asTenant(tenantId, (tx) => tx.tenant.updateMany({ data: { status } }));
  const { purgeMenuForTenant } = await import("./cdn-purge");
  await purgeMenuForTenant(tenantId);
  await writeAudit(
    tenantId,
    userId,
    `admin.tenant_${status === "active" ? "activated" : "suspended"}`,
    tenantId,
  );
  return "ok";
}

/** Soft-delete / restore. Deleted tenants keep every row; the plan
 *  derivation hides the menu and kills features until restored. */
export async function adminSetTenantDeleted(
  userId: string,
  tenantId: string,
  deleted: boolean,
): Promise<AdminLeverResult> {
  if (!(await isPlatformAdmin(userId))) return "forbidden";
  if (!tenantId || tenantId.length > 64) return "invalid";
  await asTenant(tenantId, (tx) =>
    tx.tenant.updateMany({ data: { deletedAt: deleted ? new Date() : null } }),
  );
  const { purgeMenuForTenant } = await import("./cdn-purge");
  await purgeMenuForTenant(tenantId);
  await writeAudit(
    tenantId,
    userId,
    deleted ? "admin.tenant_deleted" : "admin.tenant_restored",
    tenantId,
  );
  return "ok";
}

export type PurgeResult = "ok" | "forbidden" | "not_found" | "not_soft_deleted";

/**
 * Permanently destroy a soft-deleted tenant: every database row (the
 * tenant FK cascade takes venues, menus, orders, media rows, …), its
 * scan stats, every object under its S3 prefix, and any member user
 * who belongs to no other tenant (GDPR: the owner account exists only
 * for this restaurant). Guarded twice — platform-admin only, and the
 * tenant must ALREADY be soft-deleted, so "delete permanently" is
 * always a second, deliberate step. The audit trail survives on
 * purpose (no tenant FK): a final `admin.tenant_purged` event records
 * who erased what, when.
 */
export async function adminPurgeTenant(userId: string, tenantId: string): Promise<PurgeResult> {
  if (!(await isPlatformAdmin(userId))) return "forbidden";
  if (!tenantId || tenantId.length > 64) return "not_found";

  const tenant = await asTenant(tenantId, (tx) =>
    tx.tenant.findFirst({ select: { id: true, name: true, deletedAt: true } }),
  );
  if (!tenant) return "not_found";
  if (!tenant.deletedAt) return "not_soft_deleted";

  const members = await asTenant(tenantId, (tx) =>
    tx.membership.findMany({ select: { userId: true } }),
  );

  // Stored images first — they have no transaction to lean on, and a
  // re-run after a partial failure must still find the DB rows to retry
  // from. Uploads live on disk under `public/uploads/${tenantId}/…`.
  await deletePrefix(tenantId);

  // Write the purge event BEFORE the rows vanish.
  await writeAudit(tenantId, userId, "admin.tenant_purged", tenantId, {
    name: tenant.name,
    members: members.length,
  });

  await asTenant(tenantId, async (tx) => {
    // scan_stats has no tenant FK (partitioned) — clear it explicitly;
    // the tenant delete then cascades through everything else.
    await tx.scanStat.deleteMany({});
    await tx.tenant.deleteMany({});
  });

  // Member users whose ONLY tenant this was go too — their memberships
  // just cascaded away. Platform staff are never auto-deleted.
  for (const m of members) {
    const remaining = await prisma.membership.count({ where: { userId: m.userId } });
    if (remaining > 0) continue;
    const user = await prisma.user.findFirst({
      where: { id: m.userId },
      select: { isPlatformAdmin: true },
    });
    if (user && !user.isPlatformAdmin) {
      await prisma.user.delete({ where: { id: m.userId } });
    }
  }
  auditLog.info("admin.tenant_purged", { userId, tenantId, members: members.length });
  return "ok";
}

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

export type AnnounceResult =
  { ok: true; sent: number; skipped: number } | { ok: false; error: "forbidden" | "invalid" };

/* ------------------------------------------------------------------ */
/* Impersonation ("log in as owner")                                   */
/* ------------------------------------------------------------------ */

export type ImpersonateResult =
  | { ok: true; ownerUserId: string; slug: string | null }
  | { ok: false; error: "forbidden" | "no_owner" };

/** Resolve the tenant's owner for a time-boxed support session. The
 *  cookie swap happens in the action; this validates + audits. */
export async function adminImpersonateOwner(
  userId: string,
  tenantId: string,
): Promise<ImpersonateResult> {
  if (!(await isPlatformAdmin(userId))) return { ok: false, error: "forbidden" };
  const target = await asTenant(tenantId, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { role: "owner" },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    if (!membership) return null;
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { slug: true },
    });
    return { ownerUserId: membership.userId, slug: venue?.slug ?? null };
  });
  if (!target) return { ok: false, error: "no_owner" };
  await writeAudit(tenantId, userId, "admin.impersonation_started", target.ownerUserId, {
    ttlMinutes: 30,
  });
  return { ok: true, ...target };
}

/* ------------------------------------------------------------------ */
/* Transfer ownership                                                  */
/* ------------------------------------------------------------------ */

export type TransferResult =
  | { ok: true; newOwnerEmail: string }
  | { ok: false; error: "forbidden" | "no_such_user" | "no_owner" | "invalid" };

/** Move the owner role to another existing account. The old owner
 *  stays as staff (they keep kitchen/orders access; the new owner can
 *  remove them later once member management exists). */
export async function adminTransferOwnership(
  userId: string,
  tenantId: string,
  newOwnerEmail: string,
): Promise<TransferResult> {
  if (!(await isPlatformAdmin(userId))) return { ok: false, error: "forbidden" };
  const email = newOwnerEmail.trim().toLowerCase();
  if (!email || email.length > 254 || !email.includes("@")) return { ok: false, error: "invalid" };

  const newOwner = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!newOwner) return { ok: false, error: "no_such_user" };

  const transferred = await asTenant(tenantId, async (tx) => {
    const current = await tx.membership.findFirst({
      where: { role: "owner" },
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true },
    });
    if (!current) return false;
    if (current.userId === newOwner.id) return true; // already the owner
    await tx.membership.update({ where: { id: current.id }, data: { role: "staff" } });
    const existing = await tx.membership.findFirst({
      where: { userId: newOwner.id },
      select: { id: true },
    });
    if (existing) {
      await tx.membership.update({ where: { id: existing.id }, data: { role: "owner" } });
    } else {
      await tx.membership.create({
        data: { tenantId, userId: newOwner.id, role: "owner" },
      });
    }
    return true;
  });
  if (!transferred) return { ok: false, error: "no_owner" };
  await writeAudit(tenantId, userId, "admin.ownership_transferred", newOwner.id, {
    newOwnerEmail: newOwner.email,
  });
  return { ok: true, newOwnerEmail: newOwner.email };
}
