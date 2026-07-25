/**
 * Subscription state machine + capabilities. Pure functions — no DB or
 * Stripe calls. Two responsibilities:
 *
 *   1. `transition(status, event)` — what does a state become given an
 *      event? Webhooks (P1-19c/d) call this; a scheduled job (to land
 *      with the BullMQ scaffolding) will drive the `elapsed` events.
 *   2. `capabilities(status)` — what can a tenant *do* in the given
 *      status? Route handlers read this before allowing writes.
 *
 * Iron rule (roadmap §12): **`publicMenuLive === true` for every
 * status**. A published menu never dies because a card expired —
 * guests see it, staff can just no longer edit it.
 */

import type { SubscriptionStatus } from "@prisma/client";

export type SubStatus = SubscriptionStatus;

/**
 * Grace-period timings driven by Stripe's normal retry cadence. `past_due`
 * fires immediately when Stripe's first retry fails; after 3 days we move
 * to `grace` (a marker that Stripe has probably given up); after another
 * 4 days (7 total) we move to `canceled` and disable the dashboard.
 */
export const PAST_DUE_TO_GRACE_DAYS = 3;
export const PAST_DUE_TO_CANCELED_DAYS = 7;

export type StateEvent =
  | { type: "payment_failed" }
  | { type: "payment_succeeded" }
  | { type: "canceled_by_customer" }
  | { type: "elapsed"; daysSincePastDue: number };

/**
 * Compute the next status. Unknown transitions leave the status
 * unchanged — never throws, so a stray webhook can't corrupt the row.
 */
export function transition(status: SubStatus, event: StateEvent): SubStatus {
  switch (event.type) {
    case "payment_failed":
      // Only active-family states enter dunning. A canceled sub with a
      // failed retry stays canceled; an incomplete stays incomplete.
      if (status === "active" || status === "trialing") return "past_due";
      return status;
    case "payment_succeeded":
      if (status === "past_due" || status === "grace" || status === "unpaid") return "active";
      return status;
    case "canceled_by_customer":
      if (status === "canceled") return status;
      return "canceled";
    case "elapsed":
      if (status === "past_due" && event.daysSincePastDue >= PAST_DUE_TO_GRACE_DAYS) {
        // Skip through to canceled if we're already past the final gate.
        return event.daysSincePastDue >= PAST_DUE_TO_CANCELED_DAYS ? "canceled" : "grace";
      }
      if (status === "grace" && event.daysSincePastDue >= PAST_DUE_TO_CANCELED_DAYS) {
        return "canceled";
      }
      return status;
  }
}

export interface Capabilities {
  /** Dashboard write actions (create/edit/publish) are allowed. */
  canEditDashboard: boolean;
  /** Dashboard read-only view is allowed. */
  canViewDashboard: boolean;
  /**
   * Public menu URL still serves. **Always `true`** — this is the
   * invariant the roadmap builds on: guests never see the URL break
   * because a restaurant's card expired.
   */
  publicMenuLive: boolean;
}

export function capabilities(status: SubStatus): Capabilities {
  switch (status) {
    case "active":
    case "trialing":
      return { canEditDashboard: true, canViewDashboard: true, publicMenuLive: true };
    case "incomplete":
      // Checkout landed but payment hasn't confirmed yet. Let the tenant
      // read the dashboard (they need to fix their card) but not write.
      return { canEditDashboard: false, canViewDashboard: true, publicMenuLive: true };
    case "past_due":
    case "grace":
      // 7-day soft window: dashboard read-only.
      return { canEditDashboard: false, canViewDashboard: true, publicMenuLive: true };
    case "canceled":
    case "unpaid":
      // Hard dashboard disable. Public menu still lives.
      return { canEditDashboard: false, canViewDashboard: false, publicMenuLive: true };
  }
}
