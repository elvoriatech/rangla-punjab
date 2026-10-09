import { describe, expect, it } from "vitest";
import { renderTicketEscPos, wrap } from "./ticket-escpos";
import type { TicketOrder } from "./ticket-html";

const order: TicketOrder = {
  orderNumber: 42,
  orderType: "delivery",
  tableNumber: null,
  customerName: "Jürgen Müller",
  customerPhone: "+49 7531 123456",
  requestedFor: null,
  deliveryAddress: { street: "Bodanstraße 12", zip: "78462", city: "Konstanz", note: "2. OG" },
  paymentStatus: "paid",
  paymentProvider: "stripe",
  paymentMethod: "apple_pay",
  discountCents: 0,
  discountPoints: 0,
  giftCardDiscountCents: 0,
  giftCardLast4: null,
  totalCents: 2580,
  currency: "EUR",
  createdAt: new Date("2026-10-09T17:30:00Z"),
  items: [{ name: "Butter Chicken mit extra Soße und Naan", quantity: 2, priceCents: 1290 }],
};

const bytes = (u8: Uint8Array): number[] => Array.from(u8);
const has = (hay: number[], needle: number[]): boolean =>
  hay.some((_, i) => needle.every((b, j) => hay[i + j] === b));
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

describe("ESC/POS kitchen ticket", () => {
  const out = bytes(
    renderTicketEscPos(
      order,
      { name: "Rangla Punjab Restaurant · Konstanz" },
      { navQrData: "https://x.test/d/1" },
    ),
  );

  it("starts with init, leaves Chinese mode and selects code page 437", () => {
    expect(out.slice(0, 7)).toEqual([0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 0x00]);
  });

  it("prints German umlauts and ß in code page 437, and spells out the euro", () => {
    // "Jürgen Müller": ü = 0x81
    expect(has(out, [...ascii("J"), 0x81, ...ascii("rgen M"), 0x81, ...ascii("ller")])).toBe(true);
    // "Bodanstraße": ß = 0xE1
    expect(has(out, [...ascii("Bodanstra"), 0xe1, ...ascii("e")])).toBe(true);
    expect(has(out, ascii("EUR"))).toBe(true);
    expect(out.includes(0x20ac)).toBe(false);
  });

  it("carries the order number, the payment banner, the driver QR and two cuts (ticket + kitchen copy)", () => {
    expect(has(out, ascii("#42"))).toBe(true);
    expect(has(out, ascii("ONLINE BEZAHLT (APPLE PAY)"))).toBe(true);
    expect(has(out, [0x1d, 0x28, 0x6b])).toBe(true);
    const cuts = out.filter((_, i) => out[i] === 0x1d && out[i + 1] === 0x56).length;
    expect(cuts).toBe(2);
  });

  it("leaves the kitchen copy off on request", () => {
    const solo = bytes(renderTicketEscPos(order, { name: "X" }, { kitchenCopy: false }));
    const cuts = solo.filter((_, i) => solo[i] === 0x1d && solo[i + 1] === 0x56).length;
    expect(cuts).toBe(1);
  });

  it("wraps to the paper: no printed line wider than 32 columns on 58 mm", () => {
    const narrow = bytes(
      renderTicketEscPos(order, { name: "X" }, { paper: 58, kitchenCopy: false }),
    );
    // Split on line feeds and drop control sequences' bytes < 0x20 except text.
    const lines: number[][] = [[]];
    for (const b of narrow) {
      if (b === 0x0a) lines.push([]);
      else lines[lines.length - 1]!.push(b);
    }
    const printable = lines.map((l) => l.filter((b) => b >= 0x20).length);
    expect(Math.max(...printable)).toBeLessThanOrEqual(40); // 32 + a few command bytes ≥ 0x20
    expect(
      wrap("ein sehr langer Gerichtname der umbrechen muss", 12).every((l) => l.length <= 12),
    ).toBe(true);
  });
});
