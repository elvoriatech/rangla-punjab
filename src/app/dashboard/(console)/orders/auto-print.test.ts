import { describe, expect, it } from "vitest";
import { isReadyToPrint, pickOrdersToPrint } from "./auto-print";

describe("kitchen auto-print selection", () => {
  const cash = { id: "a", orderNumber: 1, paymentStatus: "none" };
  const pendingCard = { id: "b", orderNumber: 2, paymentStatus: "pending" };
  const paidPaypal = { id: "c", orderNumber: 3, paymentStatus: "paid" };

  it("prints cash at once and settled online orders, never a pending online one", () => {
    expect(isReadyToPrint(cash)).toBe(true);
    expect(isReadyToPrint(paidPaypal)).toBe(true);
    expect(isReadyToPrint(pendingCard)).toBe(false);
    expect(pickOrdersToPrint([cash, pendingCard, paidPaypal], new Set()).map((o) => o.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("prints an order once, and prints a formerly pending order when it becomes paid", () => {
    const printed = new Set(["a", "c"]);
    expect(pickOrdersToPrint([cash, pendingCard, paidPaypal], printed)).toEqual([]);
    const nowPaid = { ...pendingCard, paymentStatus: "paid" };
    expect(pickOrdersToPrint([cash, nowPaid, paidPaypal], printed).map((o) => o.id)).toEqual(["b"]);
  });
});
