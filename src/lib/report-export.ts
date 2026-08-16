import type { VenueReport } from "./report-service";

/**
 * CSV export of the report's order rows — opened in Excel by an
 * accountant, so: RFC 4180 quoting, ISO dates, dot-decimal amounts
 * (locale-formatted numbers turn into text and SUM() returns zero).
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

const HEADERS = [
  "Order Number",
  "Date",
  "Order Type",
  "Status",
  "Payment Method",
  "Payment Status",
  "Counts As Revenue",
  "Net",
  "VAT 19%",
  "Total",
] as const;

export function reportToCsv(report: VenueReport): string {
  const rows: string[] = [HEADERS.map(csvCell).join(",")];
  for (const o of report.orders) {
    rows.push(
      [
        String(o.orderNumber).padStart(4, "0"),
        o.placedAt.toISOString(),
        o.orderType,
        o.status,
        o.paymentMethod,
        o.paymentStatus,
        o.countsAsRevenue ? "yes" : "no",
        amount(o.netCents),
        amount(o.vatCents),
        amount(o.totalCents),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}
