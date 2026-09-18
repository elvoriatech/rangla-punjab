import { describe, expect, it } from "vitest";
import { buildReceiptPdf } from "./receipt-pdf";
import { PDF_COPY, pdfCopy, pdfLocale } from "./i18n/pdf";
import type { ReceiptOrder } from "./order-service";

/**
 * Pure PDF-builder tests — no DB. The receipt uses the WinAnsi-only Courier
 * standard font, so anything it can't encode (the "⏰" scheduled-order marker,
 * an emoji in a delivery note, …) must be stripped rather than crash the PDF.
 */
const baseOrder: ReceiptOrder = {
  id: "o1",
  orderNumber: 6,
  tableNumber: null,
  orderType: "takeaway",
  customerName: "Amrit",
  customerPhone: "+49 151 2345678",
  requestedFor: null,
  deliveryAddress: null,
  customerEmail: null,
  paymentStatus: "unpaid",
  paymentProvider: null,
  totalCents: 1990,
  currency: "eur",
  createdAt: new Date("2026-07-25T20:00:00Z"),
  venue: {
    name: "Rangla Punjab · Konstanz",
    slug: "rangla-punjab",
    logoKey: null,
    defaultLocale: "de",
  },
  items: [{ name: "Shahi Tofu", priceCents: 990, quantity: 2 }],
};

const isPdf = (bytes: Uint8Array): boolean =>
  Buffer.from(bytes.slice(0, 5)).toString("ascii") === "%PDF-";

describe("buildReceiptPdf", () => {
  it("builds a scheduled pickup receipt despite the ⏰ marker", async () => {
    const pdf = await buildReceiptPdf(
      { ...baseOrder, requestedFor: new Date("2026-07-26T00:30:00Z") },
      "de",
    );
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("builds a scheduled delivery receipt with an emoji in the note", async () => {
    const pdf = await buildReceiptPdf(
      {
        ...baseOrder,
        orderType: "delivery",
        requestedFor: new Date("2026-07-26T00:30:00Z"),
        deliveryAddress: {
          street: "Hauptstr. 1",
          zip: "78462",
          city: "Konstanz",
          note: "Klingel 🙏",
        },
      },
      "de",
    );
    expect(isPdf(pdf)).toBe(true);
  });

  it("builds Spanish and Italian receipts (accented labels are WinAnsi-safe)", async () => {
    for (const locale of ["es", "it"]) {
      const pdf = await buildReceiptPdf(
        {
          ...baseOrder,
          orderType: "delivery",
          requestedFor: new Date("2026-07-26T00:30:00Z"),
          deliveryAddress: { street: "Calle Mayor 3", zip: "28013", city: "Madrid" },
        },
        locale,
      );
      expect(isPdf(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(1000);
    }
  });

  it("renders an Arabic order in English (decision 4 — StandardFonts can't draw Arabic)", async () => {
    // Byte-identical to the English build: same catalogue, same number and
    // date formats. If `ar` ever started using its own, `safe()` would
    // strip the glyphs and the receipt would come out with blank labels.
    expect(pdfCopy("ar")).toBe(PDF_COPY.en);
    expect(pdfLocale("ar")).toBe("en");
    const ar = await buildReceiptPdf(baseOrder, "ar");
    const en = await buildReceiptPdf(baseOrder, "en");
    expect(isPdf(ar)).toBe(true);
    expect(ar.length).toBe(en.length);
  });

  it("still builds the plain ASAP and dine-in receipts", async () => {
    expect(isPdf(await buildReceiptPdf(baseOrder, "de"))).toBe(true);
    expect(
      isPdf(
        await buildReceiptPdf(
          { ...baseOrder, orderType: "dine_in", tableNumber: "5", customerName: null },
          "en",
        ),
      ),
    ).toBe(true);
  });
});
