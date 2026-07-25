import type { PlanCode } from "./plans";

/**
 * Plan cap enforcement — a no-op in the white-label, single-restaurant
 * model. There are no SaaS tiers and no per-tenant quotas: one restaurant
 * can have as many venues/menus/items as it likes. `checkCap` is kept
 * (returning "always allowed") so the write routes that call it don't need
 * to change; it can be deleted outright when those call sites are cleaned
 * up.
 */

export type CappedResource = "venues" | "menus" | "items";

export interface CapCheck {
  allowed: boolean;
  current: number;
  limit: number;
  planCode: PlanCode;
}

export async function checkCap(_userId: string, _cap: CappedResource): Promise<CapCheck> {
  void _userId;
  void _cap;
  return { allowed: true, current: 0, limit: Number.POSITIVE_INFINITY, planCode: "support" };
}
