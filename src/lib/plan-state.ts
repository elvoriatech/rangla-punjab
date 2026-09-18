import { PLAN_CODES, type PlanCode } from "./plans";

/**
 * "What can this restaurant do right now."
 *
 * White-label, one deploy per restaurant: there is exactly one tenant and
 * no SaaS trial/lapse ladder. Every feature is on, all the time — the ONLY
 * public kill switches are an operator-suspended or soft-deleted tenant.
 * Billing (the monthly support fee) is intentionally NOT a gate here: an
 * overdue support fee is surfaced as a warning, it never turns ordering
 * off (see /dashboard/billing).
 *
 * The shape below is unchanged from the old multi-tenant engine so every
 * consumer (order-service, public menu, kitchen, dashboard, admin) keeps
 * compiling; `resolveTenantAccess` now only ever returns `active`,
 * `suspended`, or `deleted`.
 */

// Retained for API compatibility with callers/tests that still import them.
export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 14;

/** Feature switches. Guest-facing ordering modes plus operator surfaces. */
export interface Entitlements {
  dineIn: boolean;
  takeaway: boolean;
  delivery: boolean;
  kitchen: boolean;
  stats: boolean;
  /** Online guest payments via Stripe Connect. */
  payments: boolean;
}

export type EntitlementKey = keyof Entitlements;
export const ENTITLEMENT_KEYS: readonly EntitlementKey[] = [
  "dineIn",
  "takeaway",
  "delivery",
  "kitchen",
  "stats",
  "payments",
];

const ALL_ON: Entitlements = {
  dineIn: true,
  takeaway: true,
  delivery: true,
  kitchen: true,
  stats: true,
  payments: true,
};

const ALL_OFF: Entitlements = {
  dineIn: false,
  takeaway: false,
  delivery: false,
  kitchen: false,
  stats: false,
  payments: false,
};

export const PLAN_LABELS: Record<PlanCode, string> = {
  support: "Support & hosting",
};

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && (PLAN_CODES as readonly string[]).includes(value);
}

export interface TenantSnapshot {
  createdAt: Date;
  plan: string | null; // admin override (unused for gating now)
  entitlementOverrides: unknown;
  /** tenants.status — "suspended" kills everything. */
  status?: string;
  /** Soft-delete marker — a deleted tenant behaves like suspended. */
  deletedAt?: Date | null;
}

export type AccessState =
  "override" | "active" | "trial" | "lapsed_grace" | "lapsed_off" | "suspended" | "deleted";

export interface TenantAccess {
  state: AccessState;
  /** Effective plan; null only when suspended/deleted. */
  plan: PlanCode | null;
  entitlements: Entitlements;
  /** Public menu resolvable? False only when suspended/deleted. */
  menuVisible: boolean;
  /** Retained for the dashboard chip; always null (no trial). */
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
}

function applyOverrides(base: Entitlements, overrides: unknown): Entitlements {
  const result = { ...base };
  if (overrides && typeof overrides === "object") {
    for (const key of ENTITLEMENT_KEYS) {
      const v = (overrides as Record<string, unknown>)[key];
      if (typeof v === "boolean") result[key] = v;
    }
  }
  return result;
}

/**
 * Single-restaurant access. Everything on, unless the tenant is suspended
 * or soft-deleted. The subscription argument is gone with the table: this
 * restaurant is billed directly, never through Stripe Billing in the app.
 */
export function resolveTenantAccess(tenant: TenantSnapshot, _now: Date = new Date()): TenantAccess {
  void _now;
  if (tenant.deletedAt) {
    return {
      state: "deleted",
      plan: null,
      entitlements: ALL_OFF,
      menuVisible: false,
      trialEndsAt: null,
      trialDaysLeft: null,
    };
  }
  if (tenant.status === "suspended") {
    return {
      state: "suspended",
      plan: null,
      entitlements: ALL_OFF,
      menuVisible: false,
      trialEndsAt: null,
      trialDaysLeft: null,
    };
  }
  return {
    state: "active",
    plan: "support",
    entitlements: applyOverrides(ALL_ON, tenant.entitlementOverrides),
    menuVisible: true,
    trialEndsAt: null,
    trialDaysLeft: null,
  };
}

/** Matrix lookup for display. Single plan → all features on. */
export function planEntitlements(_plan: PlanCode): Entitlements {
  void _plan;
  return { ...ALL_ON };
}
