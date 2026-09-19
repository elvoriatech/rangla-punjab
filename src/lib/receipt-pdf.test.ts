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
  discountCents: 0,
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

  it("prints the reward row on a discounted receipt, in every locale", async () => {
    // €24.90 of food, €20 reward, €4.90 charged. The item lines keep their
    // menu prices, so the reward has to appear as its own row — otherwise
    // the receipt's arithmetic does not add up for the guest or the tax
    // record. An extra row means a taller page and a longer file.
    const discounted: ReceiptOrder = {
      ...baseOrder,
      items: [{ name: "Shahi Tofu", priceCents: 1245, quantity: 2 }],
      discountCents: 2000,
      totalCents: 490,
    };
    for (const locale of ["de", "en", "es", "it", "ar"]) {
      const withReward = await buildReceiptPdf(discounted, locale);
      const without = await buildReceiptPdf(
        { ...discounted, discountCents: 0, totalCents: 2490 },
        locale,
      );
      expect(isPdf(withReward)).toBe(true);
      expect(withReward.length).toBeGreaterThan(without.length);
      // The label is real copy in that language, and WinAnsi-safe — the
      // Courier face would silently strip anything else.
      expect(pdfCopy(locale).reward).not.toBe("");
      expect(pdfCopy(locale).reward).toMatch(/^[\x20-\xFF]+$/);
    }
  });

  it("says the reward paid, not that a card did, when it covered the bill", async () => {
    const free: ReceiptOrder = {
      ...baseOrder,
      items: [{ name: "Shahi Tofu", priceCents: 1245, quantity: 1 }],
      discountCents: 1245,
      totalCents: 0,
      paymentStatus: "paid",
      paymentProvider: "voucher",
    };
    const pdf = await buildReceiptPdf(free, "de");
    expect(isPdf(pdf)).toBe(true);
    // A €0 receipt still has to be a receipt: it prints the reward row and
    // a paid footer rather than the "pay at the restaurant" lines.
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdfCopy("de").paidReward).not.toBe(pdfCopy("de").paidOnline);
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
