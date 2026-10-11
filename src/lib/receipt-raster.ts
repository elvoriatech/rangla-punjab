import sharp from "sharp";
import { RECEIPT_ASCENT, RECEIPT_DESCENT, RECEIPT_GLYPHS, RECEIPT_UPM } from "./receipt-glyphs";
import type { RasterImage } from "./ticket-logo";

/**
 * An offer line for the Bluetooth receipt printer, drawn as a picture:
 * "2x Butter Chicken      ~~€ 25,80~~ € 21,80" with the regular price
 * really crossed out (owner, 2026-10-11: "print it as designed", not
 * "statt …"). A receipt printer has no strike-through mode, but it prints
 * any black-and-white picture, so the whole line becomes one.
 *
 * The letters come from the font's own outlines (`receipt-glyphs.ts`), so
 * nothing depends on fonts being installed on the server.
 */

const UNKNOWN = "?";

const advanceOf = (ch: string): number =>
  (RECEIPT_GLYPHS[ch] ?? RECEIPT_GLYPHS[UNKNOWN])?.w ?? RECEIPT_UPM / 2;

/** Width of `text` in pixels at font size `px`. */
export function textWidth(text: string, px: number): number {
  let w = 0;
  for (const ch of text) w += advanceOf(ch);
  return (w * px) / RECEIPT_UPM;
}

/** Word-wrap to `maxPx`; a word longer than the line is cut by characters. */
function wrapPx(text: string, px: number, maxPx: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, px) <= maxPx) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (textWidth(rest, px) > maxPx && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut), px) > maxPx) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/** One run of text as an SVG path, its baseline at (x, y). */
function textPath(text: string, x: number, y: number, px: number): string {
  const s = px / RECEIPT_UPM;
  const parts: string[] = [];
  let pen = x;
  for (const ch of text) {
    const glyph = RECEIPT_GLYPHS[ch] ?? RECEIPT_GLYPHS[UNKNOWN];
    if (glyph?.d) {
      const tokens = glyph.d.split(" ");
      const out: string[] = [];
      let i = 0;
      while (i < tokens.length) {
        const op = tokens[i++]!;
        out.push(op);
        const n = op === "M" || op === "L" ? 2 : op === "Q" ? 4 : op === "C" ? 6 : 0;
        for (let k = 0; k < n; k += 2) {
          const gx = Number(tokens[i + k]);
          const gy = Number(tokens[i + k + 1]);
          out.push((pen + gx * s).toFixed(1), (y - gy * s).toFixed(1));
        }
        i += n;
      }
      parts.push(out.join(" "));
    }
    pen += advanceOf(ch) * s;
  }
  return parts.join(" ");
}

export interface OfferLine {
  /** "2x Butter Chicken" */
  left: string;
  /** "€ 25,80" — drawn crossed out. */
  was: string;
  /** "€ 21,80" */
  now: string;
}

/** The SVG for one offer line, `widthPx` wide. Pure — unit-tested. */
export function offerLineSvg(line: OfferLine, widthPx: number, px = 24): string {
  const gap = px * 0.5;
  const wasW = textWidth(line.was, px * 0.85);
  const nowW = textWidth(line.now, px);
  const pricesW = wasW + gap * 0.6 + nowW;
  const leftLines = wrapPx(line.left, px, Math.max(px * 4, widthPx - pricesW - gap));
  const lineH = Math.ceil(((RECEIPT_ASCENT - RECEIPT_DESCENT) * px) / RECEIPT_UPM);
  const base = Math.ceil((RECEIPT_ASCENT * px) / RECEIPT_UPM);
  const height = lineH * leftLines.length + 4;

  const paths: string[] = [];
  leftLines.forEach((l, i) => paths.push(textPath(l, 0, base + i * lineH, px)));
  const nowX = widthPx - nowW;
  const wasX = nowX - gap * 0.6 - wasW;
  paths.push(textPath(line.now, nowX, base, px));
  paths.push(textPath(line.was, wasX, base, px * 0.85));
  // The strike: a solid bar through the middle of the old price.
  const strikeY = base - px * 0.32;
  const bar = `<rect x="${(wasX - 1).toFixed(1)}" y="${(strikeY - 1.25).toFixed(1)}" width="${(wasW + 2).toFixed(1)}" height="2.5"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${height}" viewBox="0 0 ${widthPx} ${height}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000"><path d="${paths.join(" ")}"/>${bar}</g></svg>`;
}

/** The offer line as 1-bit dots for `GS v 0`. */
export async function offerLineRaster(line: OfferLine, widthDots: number): Promise<RasterImage> {
  const svg = offerLineSvg(line, widthDots);
  const { data, info } = await sharp(Buffer.from(svg))
    .flatten({ background: "#ffffff" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bytesPerRow = Math.ceil(info.width / 8);
  const bits = new Uint8Array(bytesPerRow * info.height);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width * info.channels + x * info.channels]! < 128) {
        bits[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  return { bytesPerRow, height: info.height, data: bits };
}
