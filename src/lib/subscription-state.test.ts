import { describe, expect, it } from "vitest";
import {
  capabilities,
  PAST_DUE_TO_CANCELED_DAYS,
  PAST_DUE_TO_GRACE_DAYS,
  transition,
  type StateEvent,
  type SubStatus,
} from "./subscription-state";

describe("transition table", () => {
  const cases: { from: SubStatus; event: StateEvent; to: SubStatus }[] = [
    // Dunning start
    { from: "active", event: { type: "payment_failed" }, to: "past_due" },
    { from: "trialing", event: { type: "payment_failed" }, to: "past_due" },
    { from: "incomplete", event: { type: "payment_failed" }, to: "incomplete" },
    { from: "canceled", event: { type: "payment_failed" }, to: "canceled" },

    // Recovery
    { from: "past_due", event: { type: "payment_succeeded" }, to: "active" },
    { from: "grace", event: { type: "payment_succeeded" }, to: "active" },
    { from: "unpaid", event: { type: "payment_succeeded" }, to: "active" },
    { from: "active", event: { type: "payment_succeeded" }, to: "active" }, // no-op
    { from: "canceled", event: { type: "payment_succeeded" }, to: "canceled" }, // no revive

    // Time-based transitions
    { from: "past_due", event: { type: "elapsed", daysSincePastDue: 1 }, to: "past_due" },
    {
      from: "past_due",
      event: { type: "elapsed", daysSincePastDue: PAST_DUE_TO_GRACE_DAYS },
      to: "grace",
    },
    {
      from: "past_due",
      event: { type: "elapsed", daysSincePastDue: PAST_DUE_TO_CANCELED_DAYS + 1 },
      // Even if the elapsed jump skips grace, we still end at canceled.
      to: "canceled",
    },
    { from: "grace", event: { type: "elapsed", daysSincePastDue: 5 }, to: "grace" },
    {
      from: "grace",
      event: { type: "elapsed", daysSincePastDue: PAST_DUE_TO_CANCELED_DAYS },
      to: "canceled",
    },
    { from: "active", event: { type: "elapsed", daysSincePastDue: 999 }, to: "active" }, // stable

    // Customer-initiated cancel wins from any live state
    { from: "active", event: { type: "canceled_by_customer" }, to: "canceled" },
    { from: "trialing", event: { type: "canceled_by_customer" }, to: "canceled" },
    { from: "past_due", event: { type: "canceled_by_customer" }, to: "canceled" },
    { from: "grace", event: { type: "canceled_by_customer" }, to: "canceled" },
    { from: "canceled", event: { type: "canceled_by_customer" }, to: "canceled" }, // idempotent
  ];

  it.each(cases)("$from --$event.type→ $to", ({ from, event, to }) => {
    expect(transition(from, event)).toBe(to);
  });
});

describe("capabilities", () => {
  const allStatuses: SubStatus[] = [
    "trialing",
    "active",
    "past_due",
    "grace",
    "canceled",
    "incomplete",
    "unpaid",
  ];

  it.each(allStatuses)("publicMenuLive is true for every status (%s) — the invariant", (status) => {
    expect(capabilities(status).publicMenuLive).toBe(true);
  });

  it("canEditDashboard is only true for active + trialing", () => {
    const editable = allStatuses.filter((s) => capabilities(s).canEditDashboard);
    expect(editable.sort()).toEqual(["active", "trialing"]);
  });

  it("canViewDashboard is true for the read-only + editable states, false when suspended", () => {
    const viewable = allStatuses.filter((s) => capabilities(s).canViewDashboard);
    expect(viewable.sort()).toEqual(
      ["active", "grace", "incomplete", "past_due", "trialing"].sort(),
    );
    // canceled + unpaid are the hard-locked states.
    expect(capabilities("canceled").canViewDashboard).toBe(false);
    expect(capabilities("unpaid").canViewDashboard).toBe(false);
  });

  it("the read-only grace period matches the 7-day roadmap §12 window", () => {
    // past_due (up to 3 days) → grace (day 3 to day 7) → canceled (day 7+).
    // Every point on that timeline where the dashboard should be
    // read-only-not-disabled has capabilities.canViewDashboard = true and
    // capabilities.canEditDashboard = false.
    for (const s of ["past_due", "grace"] as const) {
      const c = capabilities(s);
      expect(c.canViewDashboard).toBe(true);
      expect(c.canEditDashboard).toBe(false);
      expect(c.publicMenuLive).toBe(true);
    }
  });
});
