import { describe, expect, it } from "vitest";
import { giftCardsToCsv } from "./gift-card-export";
import type { GiftCardReport, GiftCardReportRow } from "./gift-card-service";

/**
 * The accountant's file. Three things have to hold: the redemption date is
 * present and early (VAT falls due at redemption, not at sale), amounts are
 * machine-readable, and nothing a human typed — a note with a comma, a
 * quote, a newline — can push a value into the next column or the next row.
 */

function card(over: Partial<GiftCardReportRow> = {}): GiftCardReportRow {
  return {
    id: "gc_1",
    code: "ABCDEFGHJKMN",
    codeFormatted: "ABCD-EFGH-JKMN",
    productName: "Genussabend",
    valueCents: 5000,
    currency: "EUR",
    status: "active",
    recipientName: null,
    message: null,
    createdAt: "2026-01-02T10:00:00.000Z",
    paidAt: "2026-01-02T10:01:00.000Z",
    expiresAt: "2029-01-02T22:59:59.000Z",
    sharedAt: null,
    redemption: null,
    imageUrl: null,
    imagePath: null,
    shareUrl: null,
    buyerName: "Anna Weber",
    buyerEmail: "anna@example.com",
    buyerPhone: "+497531123456",
    paidCents: 4750,
    ...over,
  };
}

function report(rows: GiftCardReportRow[]): GiftCardReport {
  return {
    rows,
    totals: {
      soldCount: rows.length,
      soldCents: rows.reduce((sum, r) => sum + r.valueCents, 0),
      redeemedCount: 0,
      redeemedCents: 0,
      outstandingCount: 0,
      outstandingCents: 0,
    },
  };
}

/** Split a CSV the way a spreadsheet does — quoted fields may hold the
 *  delimiter, the quote character (doubled) and line breaks. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && csv[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe("giftCardsToCsv", () => {
  it("leads with a header row and ends every row with CRLF", () => {
    const csv = giftCardsToCsv(report([card()]));
    expect(csv.startsWith("Code,Product,Value,Currency,Status,Redeemed At,")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("puts the redemption date ahead of the purchase date — VAT is due at redemption", () => {
    const [headers] = parseCsv(giftCardsToCsv(report([card()])));
    const redeemed = headers?.indexOf("Redeemed At") ?? -1;
    const bought = headers?.indexOf("Bought At") ?? -1;
    expect(redeemed).toBeGreaterThan(-1);
    expect(bought).toBeGreaterThan(redeemed);
  });

  it("writes money as dot-decimal so SUM() works, never a locale string", () => {
    const rows = parseCsv(
      giftCardsToCsv(report([card({ valueCents: 5000 }), card({ valueCents: 2505 })])),
    );
    expect(rows[1]?.[2]).toBe("50.00");
    expect(rows[2]?.[2]).toBe("25.05");
  });

  it("carries the formatted code, not the raw one", () => {
    const rows = parseCsv(giftCardsToCsv(report([card()])));
    expect(rows[1]?.[0]).toBe("ABCD-EFGH-JKMN");
  });

  it("names the counter staff member and the redemption date", () => {
    const rows = parseCsv(
      giftCardsToCsv(
        report([
          card({
            status: "redeemed",
            redemption: {
              kind: "counter",
              at: "2026-03-04T18:22:00.000Z",
              staffName: "koch@example.com",
              note: "Tisch 4",
            },
          }),
        ]),
      ),
    );
    expect(rows[1]?.slice(4, 9)).toEqual([
      "redeemed",
      "2026-03-04T18:22:00.000Z",
      "counter",
      "koch@example.com",
      "Tisch 4",
    ]);
  });

  it("renders an order redemption as the padded order number", () => {
    const rows = parseCsv(
      giftCardsToCsv(
        report([
          card({
            status: "redeemed",
            redemption: { kind: "order", at: "2026-03-04T18:22:00.000Z", orderNumber: 42 },
          }),
        ]),
      ),
    );
    expect(rows[1]?.[6]).toBe("order");
    expect(rows[1]?.[7]).toBe("#0042");
  });

  it("leaves a card that was never redeemed with empty redemption columns", () => {
    const rows = parseCsv(giftCardsToCsv(report([card()])));
    expect(rows[1]?.slice(5, 9)).toEqual(["", "", "", ""]);
  });

  it("cannot be broken by a comma, a quote or a newline in free text", () => {
    const rows = parseCsv(
      giftCardsToCsv(
        report([
          card({
            productName: 'Menü "Deluxe", groß',
            buyerName: "Weber, Anna",
            status: "redeemed",
            redemption: {
              kind: "counter",
              at: "2026-03-04T18:22:00.000Z",
              staffName: "koch@example.com",
              // The worst a till note can be: a delimiter, a quote and a
              // line break in one string.
              note: 'Tisch 4, "Rest" bar\r\nausgezahlt',
            },
          }),
          card({ codeFormatted: "ZZZZ-ZZZZ-ZZZZ" }),
        ]),
      ),
    );
    // Two data rows survive, each with the full column count — the note
    // did not spill into the next field or start a third row.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveLength(rows[0]?.length ?? 0);
    expect(rows[1]?.[1]).toBe('Menü "Deluxe", groß');
    expect(rows[1]?.[8]).toBe('Tisch 4, "Rest" bar\r\nausgezahlt');
    expect(rows[2]?.[0]).toBe("ZZZZ-ZZZZ-ZZZZ");
  });

  it("writes a header-only file when the venue has sold nothing", () => {
    const csv = giftCardsToCsv(report([]));
    expect(parseCsv(csv)).toHaveLength(1);
  });
});
