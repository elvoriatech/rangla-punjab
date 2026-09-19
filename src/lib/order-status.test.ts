import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  advanceLabel,
  canTransition,
  guestSteps,
  isCancelledStatus,
  isOpenStatus,
  nextStatus,
  statusChain,
  stepIndex,
} from "./order-status";
import { postOrderCopy } from "./i18n/post-order";
import { UI_LOCALES } from "./locales";

describe("order lifecycle", () => {
  it("walks the full chain per order type", () => {
    expect(statusChain("dine_in")).toEqual(["placed", "preparing", "ready", "done"]);
    expect(statusChain("takeaway")).toEqual(["placed", "preparing", "ready", "done"]);
    expect(statusChain("delivery")).toEqual([
      "placed",
      "preparing",
      "ready",
      "out_for_delivery",
      "done",
    ]);
    // Cancelling is out of band — it is never a step the guest walks.
    for (const type of ["dine_in", "takeaway", "delivery"]) {
      expect(statusChain(type)).not.toContain("cancelled");
    }
  });

  it("allows forward and skip-ahead, refuses backwards and sideways", () => {
    expect(canTransition("placed", "preparing", "dine_in")).toBe(true);
    expect(canTransition("placed", "done", "dine_in")).toBe(true); // rush skip
    expect(canTransition("ready", "preparing", "dine_in")).toBe(false); // backwards
    expect(canTransition("done", "ready", "delivery")).toBe(false); // terminal
    expect(canTransition("placed", "placed", "dine_in")).toBe(false); // no-op
    // the courier leg exists only for delivery
    expect(canTransition("ready", "out_for_delivery", "delivery")).toBe(true);
    expect(canTransition("ready", "out_for_delivery", "dine_in")).toBe(false);
    // junk never passes
    expect(canTransition("nonsense", "done", "dine_in")).toBe(false);
    expect(canTransition("placed", "nonsense", "dine_in")).toBe(false);
  });

  it("cancels out of band: from every open status, from nowhere terminal", () => {
    for (const from of ["placed", "preparing", "ready"]) {
      expect(canTransition(from, "cancelled", "dine_in")).toBe(true);
      expect(canTransition(from, "cancelled", "takeaway")).toBe(true);
      expect(canTransition(from, "cancelled", "delivery")).toBe(true);
    }
    // The courier can turn back; a dine-in order was never on that leg.
    expect(canTransition("out_for_delivery", "cancelled", "delivery")).toBe(true);
    expect(canTransition("out_for_delivery", "cancelled", "dine_in")).toBe(false);
    // Both terminals are terminal.
    expect(canTransition("done", "cancelled", "dine_in")).toBe(false);
    expect(canTransition("cancelled", "cancelled", "dine_in")).toBe(false);
    // Nothing leaves a cancelled order — not forwards, not backwards.
    for (const to of ORDER_STATUSES) {
      expect(canTransition("cancelled", to, "delivery")).toBe(false);
    }
  });

  it("nextStatus follows the chain and ends at done", () => {
    expect(nextStatus("placed", "dine_in")).toBe("preparing");
    expect(nextStatus("ready", "dine_in")).toBe("done");
    expect(nextStatus("ready", "delivery")).toBe("out_for_delivery");
    expect(nextStatus("out_for_delivery", "delivery")).toBe("done");
    expect(nextStatus("done", "delivery")).toBeNull();
    expect(nextStatus("unknown", "dine_in")).toBeNull();
    // Cancelling is never something the "advance" button walks into, and
    // there is no way back out of it.
    for (const type of ["dine_in", "takeaway", "delivery"]) {
      for (const s of ORDER_STATUSES) {
        expect(nextStatus(s, type)).not.toBe("cancelled");
      }
      expect(nextStatus("cancelled", type)).toBeNull();
    }
  });

  it("open = not terminal; both done and cancelled are closed", () => {
    for (const s of ORDER_STATUSES) {
      expect(isOpenStatus(s)).toBe(s !== "done" && s !== "cancelled");
    }
    expect(TERMINAL_STATUSES).toEqual(["done", "cancelled"]);
    expect(isCancelledStatus("cancelled")).toBe(true);
    expect(isCancelledStatus("done")).toBe(false);
  });

  it("leaves the guest's step rail alone — cancelled is not a step", () => {
    for (const type of ["dine_in", "takeaway", "delivery"]) {
      expect(guestSteps(type).map((s) => s.key)).not.toContain("cancelled");
      // -1, so every caller falls into its "no rail" branch and renders a
      // cancelled state instead of a half-walked chain.
      expect(stepIndex("cancelled", type)).toBe(-1);
    }
  });

  it("guest steps carry catalogue keys, worded per order type", () => {
    const delivery = guestSteps("delivery");
    expect(delivery.map((s) => s.label)).toEqual([
      "confirmed",
      "preparing",
      "ready",
      "onTheWay",
      "delivered",
    ]);
    const pickup = guestSteps("takeaway");
    expect(pickup.map((s) => s.key)).toEqual(["placed", "preparing", "ready", "done"]);
    expect(pickup[2]!.label).toBe("readyForPickup");
    expect(guestSteps("dine_in").at(-1)!.label).toBe("served");
  });

  it("every step label resolves to real copy in every UI locale", () => {
    for (const locale of UI_LOCALES) {
      const copy = postOrderCopy(locale);
      for (const type of ["dine_in", "takeaway", "delivery"]) {
        for (const step of guestSteps(type)) {
          expect(copy.steps[step.label]).toBeTruthy();
        }
      }
    }
  });

  it("stepIndex locates the current status in the chain", () => {
    expect(stepIndex("placed", "delivery")).toBe(0);
    expect(stepIndex("out_for_delivery", "delivery")).toBe(3);
    expect(stepIndex("out_for_delivery", "dine_in")).toBe(-1);
  });

  it("every advance button has a human label", () => {
    for (const s of ORDER_STATUSES) {
      expect(advanceLabel(s)).toBeTruthy();
    }
    expect(advanceLabel("cancelled")).toBe("Cancel");
  });
});
