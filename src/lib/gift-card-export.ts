import type { GiftCardReport, GiftCardReportRow } from "./gift-card-service";

/**
 * CSV export of the gift cards a venue has sold — opened in Excel by an
 * accountant, so the same rules as `report-export.ts`: RFC 4180 quoting,
 * ISO dates, dot-decimal amounts (a locale-formatted number turns into
 * text and SUM() returns zero).
 *
 * The REDEMPTION date leads the date columns on purpose. A gift card is a
 * multi-purpose voucher (Mehrzweckgutschein, § 3 Abs. 14 UStG): the VAT
 * falls due when the card is redeemed, not when it was sold, so the
 * redemption date — not the purchase date — is the one this file exists
 * to carry.
 *
 * The code column is the FORMATTED code (ABCD-EFGH-JKMN), which is what
 * is printed on the card the owner is holding; see the export route for
 * why the export carries a code at all.
 */

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function amount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function orderLabel(orderNumber: number | null): string {
  return orderNumber === null ? "order" : `#${String(orderNumber).padStart(4, "0")}`;
}

const HEADERS = [
  "Code",
  "Product",
  "Value",
  "Currency",
  "Status",
  // The VAT-relevant date, which is why it sits ahead of the purchase date.
  "Redeemed At",
  "Redeemed Via",
  "Redeemed By",
  "Redemption Note",
  "Bought At",
  "Expires At",
  "Buyer",
  "Buyer Email",
  "Buyer Phone",
  // What the buyer actually paid — Value less the purchase discount.
  // Appended rather than placed beside Value so existing column
  // positions (and any sheet built on them) stay put.
  "Paid",
] as const;

/** One card, in the column order of `HEADERS`. */
function cells(card: GiftCardReportRow): string[] {
  const r = card.redemption;
  return [
    card.codeFormatted,
    card.productName ?? "",
    amount(card.valueCents),
    card.currency,
    card.status,
    r?.at ?? "",
    r?.kind ?? "",
    r === null ? "" : r.kind === "counter" ? (r.staffName ?? "") : orderLabel(r.orderNumber),
    r !== null && r.kind === "counter" ? (r.note ?? "") : "",
    card.paidAt ?? "",
    card.expiresAt ?? "",
    card.buyerName ?? "",
    card.buyerEmail ?? "",
    card.buyerPhone ?? "",
    amount(card.paidCents),
  ];
}

export function giftCardsToCsv(report: GiftCardReport): string {
  const rows: string[] = [HEADERS.map(csvCell).join(",")];
  for (const card of report.rows) {
    rows.push(cells(card).map(csvCell).join(","));
  }
  return `${rows.join("\r\n")}\r\n`;
}
