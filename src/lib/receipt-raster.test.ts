import { describe, expect, it } from "vitest";
import { offerLineRaster, offerLineSvg, textWidth } from "./receipt-raster";
import { renderTicketEscPos } from "./ticket-escpos";
import type { TicketOrder } from "./ticket-html";

describe("offer line picture for the receipt printer", () => {
  const line = { left: "2x Butter Chicken", was: "€ 25,80", now: "€ 21,80" };

  it("draws a strike bar and fills the printer's width", () => {
    const svg = offerLineSvg(line, 576);
    expect(svg).toContain('width="576"');
    expect(svg).toMatch(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="2.5"\/>/);
    expect(textWidth("Hähnchen", 24)).toBeGreaterThan(textWidth("Hhnchen", 24));
  });

  it("wraps a long dish name onto more lines, prices on the first", async () => {
    const short = await offerLineRaster(line, 576);
    const long = await offerLineRaster(
      { ...line, left: "1x Hähnchen Tikka Masala mit extra Soße und Naan" },
      576,
    );
    expect(short.bytesPerRow).toBe(72);
    expect(long.height).toBeGreaterThan(short.height);
    expect(short.data.some((b) => b !== 0)).toBe(true);
  });

  it("goes into the ESC/POS ticket instead of the 'statt' line", async () => {
    const order: TicketOrder = {
      orderNumber: 7,
      orderType: "takeaway",
      tableNumber: null,
      customerName: null,
      customerPhone: null,
      requestedFor: null,
      deliveryAddress: null,
      paymentStatus: "none",
      paymentProvider: null,
      discountCents: 0,
      discountPoints: 0,
      giftCardDiscountCents: 0,
      giftCardLast4: null,
      totalCents: 2180,
      currency: "EUR",
      createdAt: new Date("2026-10-11T17:00:00Z"),
      items: [{ name: "Butter Chicken", quantity: 2, priceCents: 1090, basePriceCents: 1290 }],
    };
    const picture = await offerLineRaster(line, 576);
    const out = Array.from(
      renderTicketEscPos(
        order,
        { name: "Rangla Punjab" },
        { kitchenCopy: false, offerImages: [picture] },
      ),
    );
    const text = String.fromCharCode(...out);
    expect(text).not.toContain("statt");
    // GS v 0 — a picture — carrying exactly this one's size.
    const at = out.findIndex((b, i) => b === 0x1d && out[i + 1] === 0x76 && out[i + 2] === 0x30);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(out[at + 4]).toBe(72);
  });
});
