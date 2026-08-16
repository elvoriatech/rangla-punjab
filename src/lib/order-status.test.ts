import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  advanceLabel,
  canTransition,
  guestSteps,
  isOpenStatus,
  nextStatus,
  statusChain,
  stepIndex,
} from "./order-status";

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
    expect(canTransition("placed", "cancelled", "dine_in")).toBe(false);
    expect(canTransition("nonsense", "done", "dine_in")).toBe(false);
  });

  it("nextStatus follows the chain and ends at done", () => {
    expect(nextStatus("placed", "dine_in")).toBe("preparing");
    expect(nextStatus("ready", "dine_in")).toBe("done");
    expect(nextStatus("ready", "delivery")).toBe("out_for_delivery");
    expect(nextStatus("out_for_delivery", "delivery")).toBe("done");
    expect(nextStatus("done", "delivery")).toBeNull();
    expect(nextStatus("unknown", "dine_in")).toBeNull();
  });

  it("open = not terminal", () => {
    for (const s of ORDER_STATUSES) {
      expect(isOpenStatus(s)).toBe(s !== "done");
    }
  });

  it("guest steps match order type and the delivery mockup wording", () => {
    const delivery = guestSteps("delivery");
    expect(delivery.map((s) => s.de)).toEqual([
      "Bestätigt",
      "Zubereitung",
      "Fertig",
      "Unterwegs",
      "Geliefert",
    ]);
    const pickup = guestSteps("takeaway");
    expect(pickup.map((s) => s.key)).toEqual(["placed", "preparing", "ready", "done"]);
    expect(pickup[2]!.de).toBe("Abholbereit");
    expect(guestSteps("dine_in").at(-1)!.de).toBe("Serviert");
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
  });
});
