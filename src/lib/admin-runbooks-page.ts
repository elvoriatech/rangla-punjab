import { isPlatformAdmin } from "./platform-admin";
import { describeSlos, type SLO } from "./slo";
import { listRunbooks, type Runbook } from "./runbooks";

/**
 * Resolver for `/admin/runbooks` (P3-3 — ops folded into the Operator
 * Console). Split out from the React page so vitest can exercise the auth
 * + data fan-in in isolation. SLOs/runbooks are operator-level, so this is
 * gated on isPlatformAdmin, not a restaurant membership.
 */

export type AdminRunbooksResult =
  | { ok: true; slos: SLO[]; runbooks: Runbook[] }
  | { ok: false; error: "unauthenticated" | "forbidden" };

export async function resolveAdminRunbooksPage(
  userId: string | null,
): Promise<AdminRunbooksResult> {
  if (!userId) return { ok: false, error: "unauthenticated" };
  if (!(await isPlatformAdmin(userId))) return { ok: false, error: "forbidden" };
  const [slos, runbooks] = await Promise.all([Promise.resolve(describeSlos()), listRunbooks()]);
  return { ok: true, slos, runbooks };
}
