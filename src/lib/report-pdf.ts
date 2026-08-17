import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { rangeLabel } from "./report-range";
import { METHOD_LABELS, TYPE_LABELS, type VenueReport } from "./report-service";

/**
 * A4 monthly/period statement PDF — the restaurant's own accounting
 * document: summary, VAT line, payment-method and order-type splits,
 * per-period table, top dishes. Everything derives from the SAME
 * VenueReport the screen shows, so the PDF can never disagree with it.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.16, 0.1, 0.05);
const SOFT = rgb(0.44, 0.38, 0.3);
const ACCENT = rgb(0.62, 0.11, 0.11);
const LINE = rgb(0.85, 0.78, 0.62);

function euros(cents: number, currency: string): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const val = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
  return currency === "EUR" ? `${sign}${val} €` : `${sign}${val} ${currency}`;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
}

function ensureRoom(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN) {
    ctx.page = ctx.doc.addPage(A4);
    ctx.y = A4[1] - MARGIN;
  }
}

function heading(ctx: Ctx, text: string): void {
  ensureRoom(ctx, 40);
  ctx.y -= 26;
  ctx.page.drawText(text, { x: MARGIN, y: ctx.y, size: 12, font: ctx.bold, color: ACCENT });
  ctx.y -= 8;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: A4[0] - MARGIN, y: ctx.y },
    thickness: 0.75,
    color: LINE,
  });
  ctx.y -= 6;
}

function row(ctx: Ctx, cells: { text: string; x: number; bold?: boolean; right?: number }[]): void {
  ensureRoom(ctx, 16);
  ctx.y -= 14;
  for (const c of cells) {
    const font = c.bold ? ctx.bold : ctx.font;
    const x = c.right != null ? c.right - font.widthOfTextAtSize(c.text, 9) : c.x;
    ctx.page.drawText(c.text, { x, y: ctx.y, size: 9, font, color: c.bold ? INK : SOFT });
  }
}

export async function renderReportPdf(report: VenueReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(A4);
  const ctx: Ctx = { doc, page, y: A4[1] - MARGIN, font, bold };
  const right = A4[0] - MARGIN;
  const cur = report.venue.currency;

  // Header
  ctx.page.drawText(report.venue.name, {
    x: MARGIN,
    y: ctx.y - 6,
    size: 20,
    font: bold,
    color: INK,
  });
  ctx.y -= 24;
  ctx.page.drawText(`Umsatzbericht / Statement · ${rangeLabel(report.range)}`, {
    x: MARGIN,
    y: ctx.y - 4,
    size: 10.5,
    font,
    color: SOFT,
  });
  ctx.y -= 10;

  // Summary
  heading(ctx, "Zusammenfassung / Summary");
  const s = report.summary;
  row(ctx, [
    { text: "Bestellungen / Orders", x: MARGIN },
    { text: String(s.orders), right, x: 0, bold: true },
  ]);
  row(ctx, [
    { text: "Umsatz brutto / Gross revenue", x: MARGIN },
    { text: euros(s.grossCents, cur), right, x: 0, bold: true },
  ]);
  row(ctx, [
    { text: "Netto / Net", x: MARGIN },
    { text: euros(s.netCents, cur), right, x: 0 },
  ]);
  row(ctx, [
    { text: "enthaltene MwSt. 19% / VAT included", x: MARGIN },
    { text: euros(s.vatCents, cur), right, x: 0 },
  ]);
  row(ctx, [
    { text: "Ø Bestellwert / Avg. order", x: MARGIN },
    { text: euros(s.avgOrderCents, cur), right, x: 0 },
  ]);
  if (report.refunds.count > 0) {
    row(ctx, [
      { text: `Erstattungen / Refunds (${report.refunds.count})`, x: MARGIN },
      { text: `-${euros(report.refunds.totalCents, cur)}`, right, x: 0 },
    ]);
  }

  // Payment split
  heading(ctx, "Zahlungsarten / Payment methods");
  for (const p of report.byPaymentMethod) {
    row(ctx, [
      { text: METHOD_LABELS[p.key as keyof typeof METHOD_LABELS] ?? p.label, x: MARGIN },
      { text: `${p.orders} Best.`, x: 300 },
      { text: `${p.sharePct}%`, x: 380 },
      { text: euros(p.totalCents, cur), right, x: 0, bold: true },
    ]);
  }

  // Order-type split
  heading(ctx, "Bestellarten / Order types");
  for (const t of report.byOrderType) {
    row(ctx, [
      { text: TYPE_LABELS[t.key] ?? t.label, x: MARGIN },
      { text: `${t.orders} Best.`, x: 300 },
      { text: `${t.sharePct}%`, x: 380 },
      { text: euros(t.totalCents, cur), right, x: 0, bold: true },
    ]);
  }

  // Period table
  heading(
    ctx,
    report.granularity === "daily"
      ? "Nach Tag / By day"
      : report.granularity === "weekly"
        ? "Nach Woche / By week"
        : "Nach Monat / By month",
  );
  for (const p of report.periods) {
    row(ctx, [
      { text: p.label, x: MARGIN },
      { text: `${p.orders} Best.`, x: 300 },
      { text: `MwSt. ${euros(p.vatCents, cur)}`, x: 380 },
      { text: euros(p.grossCents, cur), right, x: 0, bold: true },
    ]);
  }

  // Top dishes
  if (report.topItems.length > 0) {
    heading(ctx, "Top-Gerichte / Top dishes");
    for (const t of report.topItems) {
      row(ctx, [
        { text: `${t.quantity}× ${t.name.slice(0, 60)}`, x: MARGIN },
        { text: euros(t.grossCents, cur), right, x: 0 },
      ]);
    }
  }

  // Footer
  ensureRoom(ctx, 40);
  ctx.y -= 26;
  ctx.page.drawText(
    `Erstellt ${new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date())} · Beträge inkl. MwSt., aus Bestell-Snapshots · keine Provision, kein Abo`,
    { x: MARGIN, y: ctx.y, size: 8, font, color: SOFT },
  );

  return doc.save();
}
