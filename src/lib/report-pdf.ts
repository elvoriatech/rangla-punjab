import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { rangeLabel } from "./report-range";
import { METHOD_LABELS, TYPE_LABELS, type VenueReport } from "./report-service";

/**
 * A4 monthly/period statement PDF — the restaurant's own accounting
 * document: summary, VAT line, payment-method and order-type splits,
 * per-period table, top dishes, then every order on its own line, under
 * the restaurant's own letterhead. Everything derives from the SAME
 * VenueReport the screen shows, so the PDF can never disagree with it.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.16, 0.1, 0.05);
const SOFT = rgb(0.44, 0.38, 0.3);
const ACCENT = rgb(0.62, 0.11, 0.11);
const LINE = rgb(0.85, 0.78, 0.62);
const TINT = rgb(0.98, 0.95, 0.9);

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
  if (ctx.y - needed < MARGIN + 6) {
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

/** One of the four figures in the summary band. */
function figure(
  ctx: Ctx,
  x: number,
  width: number,
  top: number,
  label: string,
  value: string,
  strong = false,
): void {
  ctx.page.drawRectangle({
    x,
    y: top - 46,
    width,
    height: 46,
    color: strong ? TINT : undefined,
    borderColor: LINE,
    borderWidth: 0.75,
  });
  ctx.page.drawText(label, { x: x + 8, y: top - 15, size: 7.5, font: ctx.font, color: SOFT });
  ctx.page.drawText(value, {
    x: x + 8,
    y: top - 34,
    size: 13,
    font: ctx.bold,
    color: strong ? ACCENT : INK,
  });
}

export async function renderReportPdf(
  report: VenueReport,
  /** Venue logo as PNG bytes (already resized small); omitted → the
   *  letterhead is the name alone. */
  logoPng?: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(A4);
  const ctx: Ctx = { doc, page, y: A4[1] - MARGIN, font, bold };
  const right = A4[0] - MARGIN;
  const cur = report.venue.currency;

  // Letterhead: the restaurant's logo and name on the left, what this
  // document is and the period it covers on the right, one rule under.
  const logo = logoPng ? await doc.embedPng(logoPng).catch(() => null) : null;
  const LOGO = 46;
  const top = ctx.y;
  let nameX = MARGIN;
  if (logo) {
    const scale = Math.min(LOGO / logo.width, LOGO / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    ctx.page.drawImage(logo, { x: MARGIN, y: top - LOGO + (LOGO - h) / 2, width: w, height: h });
    nameX = MARGIN + LOGO + 12;
  }
  ctx.page.drawText(report.venue.name.slice(0, 44), {
    x: nameX,
    y: top - 20,
    size: 16,
    font: bold,
    color: INK,
  });
  ctx.page.drawText("Umsatzbericht / Statement", {
    x: nameX,
    y: top - 36,
    size: 10,
    font,
    color: SOFT,
  });
  const created = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: report.venue.timezone,
  }).format(new Date());
  const meta: [string, string][] = [
    ["Zeitraum / Period", rangeLabel(report.range)],
    ["Erstellt / Created", created],
  ];
  meta.forEach(([label, value], i) => {
    const y = top - 14 - i * 24;
    ctx.page.drawText(label, {
      x: right - font.widthOfTextAtSize(label, 7.5),
      y,
      size: 7.5,
      font,
      color: SOFT,
    });
    ctx.page.drawText(value, {
      x: right - bold.widthOfTextAtSize(value, 10),
      y: y - 11,
      size: 10,
      font: bold,
      color: INK,
    });
  });
  ctx.y = top - LOGO - 12;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: right, y: ctx.y },
    thickness: 2,
    color: ACCENT,
  });

  // Summary: the four figures an accountant looks for first, as a band.
  const s = report.summary;
  ctx.y -= 14;
  const gap = 8;
  const boxW = (right - MARGIN - gap * 3) / 4;
  figure(ctx, MARGIN, boxW, ctx.y, "Umsatz brutto / Gross", euros(s.grossCents, cur), true);
  figure(ctx, MARGIN + (boxW + gap), boxW, ctx.y, "Netto / Net", euros(s.netCents, cur));
  figure(ctx, MARGIN + (boxW + gap) * 2, boxW, ctx.y, "MwSt. 19% / VAT", euros(s.vatCents, cur));
  figure(ctx, MARGIN + (boxW + gap) * 3, boxW, ctx.y, "Bestellungen / Orders", String(s.orders));
  ctx.y -= 46;

  heading(ctx, "Zusammenfassung / Summary");
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

  // Every order of the period on its own line — the statement proper.
  if (report.orders.length > 0) {
    const when = new Intl.DateTimeFormat("de-DE", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: report.venue.timezone,
    });
    const columns = (): void => {
      row(ctx, [
        { text: "Nr.", x: MARGIN, bold: true },
        { text: "Datum / Date", x: MARGIN + 44, bold: true },
        { text: "Art / Type", x: MARGIN + 140, bold: true },
        { text: "Zahlung / Payment", x: MARGIN + 250, bold: true },
        { text: "MwSt.", right: right - 80, x: 0, bold: true },
        { text: "Gesamt / Total", right, x: 0, bold: true },
      ]);
    };
    heading(ctx, `Bestellungen einzeln / Orders (${report.orders.length})`);
    columns();
    for (const o of report.orders) {
      const before = ctx.page;
      ensureRoom(ctx, 16);
      // A table that runs onto a new page repeats its column titles.
      if (ctx.page !== before) columns();
      row(ctx, [
        { text: `#${o.orderNumber}`, x: MARGIN },
        { text: when.format(o.placedAt), x: MARGIN + 44 },
        { text: TYPE_LABELS[o.orderType] ?? o.orderType, x: MARGIN + 140 },
        {
          text: `${METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod}${o.countsAsRevenue ? "" : " *"}`,
          x: MARGIN + 250,
        },
        { text: euros(o.vatCents, cur), right: right - 80, x: 0 },
        { text: euros(o.totalCents, cur), right, x: 0, bold: o.countsAsRevenue },
      ]);
    }
    if (report.orders.some((o) => !o.countsAsRevenue)) {
      ensureRoom(ctx, 20);
      ctx.y -= 14;
      ctx.page.drawText("* nicht im Umsatz enthalten / not counted as revenue", {
        x: MARGIN,
        y: ctx.y,
        size: 8,
        font,
        color: SOFT,
      });
    }
  }

  // Footer on every page: what the figures are, and which page this is.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: 34 },
      end: { x: right, y: 34 },
      thickness: 0.5,
      color: LINE,
    });
    p.drawText(`${report.venue.name.slice(0, 50)} · Beträge inkl. MwSt., aus Bestell-Snapshots`, {
      x: MARGIN,
      y: 22,
      size: 7.5,
      font,
      color: SOFT,
    });
    const label = `Seite ${i + 1} / ${pages.length}`;
    p.drawText(label, {
      x: right - font.widthOfTextAtSize(label, 7.5),
      y: 22,
      size: 7.5,
      font,
      color: SOFT,
    });
  });

  return doc.save();
}
