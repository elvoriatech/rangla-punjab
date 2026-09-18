"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSessionCookie, getSessionUserId } from "@/lib/auth";
import { setImpersonationCookie } from "@/lib/auth";
import {
  adminImpersonateOwner,
  adminPurgeTenant,
  adminTransferOwnership,
  adminSetTenantDeleted,
  adminSetTenantStatus,
} from "@/lib/platform-admin";
import { createLogger } from "@/lib/logger";

const log = createLogger();

/** Sidebar "Log out" — clears the session cookie and returns to the
 *  login page. Form-driven so it works without JS, same as the
 *  restaurant shell's logout. */
export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

/** Suspend or reactivate a restaurant — enforcement is automatic
 *  (menu hidden, ordering off, dashboard notice). */
export async function setStatusAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const tenantId = String(form.get("tenantId") ?? "");
  const status = form.get("status") === "suspended" ? ("suspended" as const) : ("active" as const);
  const back = String(form.get("back") ?? "/admin/restaurants");
  const result = await adminSetTenantStatus(userId, tenantId, status);
  log.info("admin.status_changed", { userId, tenantId, status, result });
  if (result === "forbidden") redirect("/login");
  revalidatePath("/admin/restaurants", "page");
  redirect(result === "ok" ? `${back}?saved=1` : `${back}?error=1`);
}

/** Soft-delete / restore a tenant. Delete requires the two-step confirm
 *  in the UI; both directions land in the audit trail. */
export async function setDeletedAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const tenantId = String(form.get("tenantId") ?? "");
  const deleted = form.get("deleted") === "1";
  const back = String(form.get("back") ?? "/admin/restaurants");
  const result = await adminSetTenantDeleted(userId, tenantId, deleted);
  log.info("admin.deleted_changed", { userId, tenantId, deleted, result });
  if (result === "forbidden") redirect("/login");
  revalidatePath("/admin/restaurants", "page");
  redirect(result === "ok" ? `${back}?saved=1` : `${back}?error=1`);
}

/** Permanently erase a soft-deleted tenant — DB rows, S3 objects, and
 *  orphaned owner accounts. The UI gates this behind a confirm dialog;
 *  the service refuses tenants that aren't soft-deleted yet. */
export async function purgeTenantAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const tenantId = String(form.get("tenantId") ?? "");
  const result = await adminPurgeTenant(userId, tenantId);
  log.info("admin.tenant_purge_requested", { userId, tenantId, result });
  if (result === "forbidden") redirect("/login");
  revalidatePath("/admin/restaurants", "page");
  redirect(
    result === "ok" ? "/admin/restaurants?saved=1" : `/admin/restaurants/${tenantId}?error=1`,
  );
}

/** Time-boxed "log in as owner" — 30 minutes, loud banner, audited. */
export async function impersonateAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const tenantId = String(form.get("tenantId") ?? "");
  const result = await adminImpersonateOwner(userId, tenantId);
  log.info("admin.impersonation", { userId, tenantId, ok: result.ok });
  if (!result.ok) {
    redirect(result.error === "forbidden" ? "/login" : `/admin/restaurants/${tenantId}?error=1`);
  }
  await setImpersonationCookie(result.ownerUserId, userId);
  redirect(result.slug ? "/dashboard" : "/dashboard");
}

/** Move the owner role to another existing account. */
export async function transferOwnershipAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const tenantId = String(form.get("tenantId") ?? "");
  const email = String(form.get("email") ?? "");
  const result = await adminTransferOwnership(userId, tenantId, email);
  log.info("admin.transfer", { userId, tenantId, ok: result.ok });
  if (!result.ok && result.error === "forbidden") redirect("/login");
  revalidatePath("/admin/restaurants", "page");
  redirect(
    result.ok
      ? `/admin/restaurants/${tenantId}?saved=1`
      : `/admin/restaurants/${tenantId}?error=${result.ok === false ? result.error : "1"}`,
  );
}

/** Activate/deactivate a starter template (controls what owners see). */
export async function setTemplateActiveAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "1";
  const { adminSetTemplateActive } = await import("@/lib/menu-template-service");
  const result = await adminSetTemplateActive(userId, id, active);
  if (result === "forbidden") redirect("/login");
  revalidatePath("/admin/templates", "page");
  redirect("/admin/templates?saved=1");
}
