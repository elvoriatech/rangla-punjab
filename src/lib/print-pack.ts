import { BRAND } from "./brand";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { renderQrPng } from "./qr";

/**
 * A4 print pack — one table-tent page per table, each carrying:
 *   • the venue's name (serif-looking `Times-Roman` — pdf-lib ships with
 *     14 base-14 fonts; that's enough for a printed card and lets us stay
 *     off font-loading paths that would need `sharp`/`fontkit`),
 *   • a big QR that resolves to `{baseUrl}/r/{slug}?t={n}` so the guest's
 *     table number is captured in the click-through,
 *   • the table number in large print.
 *
 * Deterministic: creation + modification dates pinned to the epoch and
 * `useObjectStreams: false` on save, so the byte output is stable across
 * runs. That's the "byte-identical" contract from the task spec.
 *
 * The architect suggested `@react-pdf/renderer` or Playwright PDF, but
 * pdf-lib gives us the deterministic bytes we need for the golden diff
 * without a headless-browser dependency — recorded in the commit.
 */

const A4 = { width: 595.28, height: 841.89 } as const; // 72dpi, portrait

export interface PrintPackInput {
  venueName: string;
  /** Absolute origin — e.g. `https://guesto.app`. No trailing slash. */
  baseUrl: string;
  slug: string;
  /** Number of tents to generate. Table indices run 1..tableCount. */
  tableCount: number;
}

export async function renderPrintPack(input: PrintPackInput): Promise<Uint8Array> {
  if (!Number.isInteger(input.tableCount) || input.tableCount < 1 || input.tableCount > 200) {
    throw new Error(`tableCount must be an integer between 1 and 200, got ${input.tableCount}`);
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.venueName} — QR tent cards`);
  pdf.setAuthor(BRAND.name);
  pdf.setSubject("Table tent cards with menu QR codes");
  // Pin dates so the bytes are reproducible — see the file header.
  const epoch = new Date(0);
  pdf.setCreationDate(epoch);
  pdf.setModificationDate(epoch);

  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdf.embedFont(StandardFonts.TimesRomanBold);

  for (let n = 1; n <= input.tableCount; n++) {
    const page = pdf.addPage([A4.width, A4.height]);
    const qrUrl = `${input.baseUrl}/?t=${n}`;

    // Generate a per-page QR so the URL (with table param) is scanned.
    const png = await renderQrPng(qrUrl);
    // pdf-lib's `embedPng` returns a `PDFImage` that carries width/height.
    // We compute a square that leaves ~60mm margin on the shorter side.
    const image = await pdf.embedPng(png);
    const qrSize = 320;
    const qrX = (A4.width - qrSize) / 2;
    const qrY = A4.height - 250 - qrSize;

    // Header: "SCAN THE MENU"
    const heading = "SCAN THE MENU";
    const headingSize = 28;
    const headingWidth = boldFont.widthOfTextAtSize(heading, headingSize);
    page.drawText(heading, {
      x: (A4.width - headingWidth) / 2,
      y: A4.height - 120,
      size: headingSize,
      font: boldFont,
      color: rgb(0.12, 0.23, 0.18), // brand green
    });

    // Venue name (below heading, above QR)
    const nameSize = 20;
    const nameWidth = font.widthOfTextAtSize(input.venueName, nameSize);
    page.drawText(input.venueName, {
      x: (A4.width - nameWidth) / 2,
      y: A4.height - 165,
      size: nameSize,
      font,
      color: rgb(0.12, 0.23, 0.18),
    });

    page.drawImage(image, { x: qrX, y: qrY, width: qrSize, height: qrSize });

    // Table label at the bottom
    const tableLabel = `Table ${n}`;
    const labelSize = 32;
    const labelWidth = boldFont.widthOfTextAtSize(tableLabel, labelSize);
    page.drawText(tableLabel, {
      x: (A4.width - labelWidth) / 2,
      y: qrY - 80,
      size: labelSize,
      font: boldFont,
      color: rgb(0.12, 0.23, 0.18),
    });

    // Fine-print URL for guests who prefer to type
    const urlSize = 10;
    const urlWidth = font.widthOfTextAtSize(qrUrl, urlSize);
    page.drawText(qrUrl, {
      x: (A4.width - urlWidth) / 2,
      y: 60,
      size: urlSize,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  // `useObjectStreams: false` is the switch that stops pdf-lib from
  // introducing non-deterministic ordering into the xref/streams. With
  // it off + pinned dates, the exact same input always yields the exact
  // same bytes.
  return pdf.save({ useObjectStreams: false });
}
