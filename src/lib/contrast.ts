/**
 * WCAG 2.1 relative-luminance contrast ratio + guard that rejects
 * brand-colour choices which would ship a menu that fails AA against the
 * background it will actually sit on. When a choice fails, the guard also
 * returns the nearest passing shade (same hue and saturation, lightness
 * walked toward the far end of the L axis) so the caller can nudge the
 * operator toward an accessible pick instead of just saying "no".
 * Reference: https://www.w3.org/TR/WCAG21/#contrast-minimum.
 */

const AA_LARGE = 3.0;
const AA_NORMAL = 4.5;

export type ContrastLevel = "AA-normal" | "AA-large";

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsAaNormal(hexA: string, hexB: string): boolean {
  return contrastRatio(hexA, hexB) >= AA_NORMAL;
}

export function meetsAaLarge(hexA: string, hexB: string): boolean {
  return contrastRatio(hexA, hexB) >= AA_LARGE;
}

export interface ContrastCheck {
  ok: boolean;
  ratio: number;
  target: number;
  /** Present only when `ok` is `false` and a passing shade exists. */
  suggestion?: string;
}

export function checkContrast(
  foregroundHex: string,
  backgroundHex: string,
  { level = "AA-normal" as ContrastLevel } = {},
): ContrastCheck {
  const target = level === "AA-normal" ? AA_NORMAL : AA_LARGE;
  const ratio = contrastRatio(foregroundHex, backgroundHex);
  if (ratio >= target) return { ok: true, ratio, target };
  const suggestion = nearestPassingColor(foregroundHex, backgroundHex, { level });
  return suggestion == null
    ? { ok: false, ratio, target }
    : { ok: false, ratio, target, suggestion };
}

/**
 * Walk the foreground colour's lightness toward the pole opposite the
 * background until the pair clears `level`. Hue and saturation are held
 * constant so the suggestion still reads as "the same colour, darker" (or
 * lighter). Returns `null` for the pathological case where even L=0 or
 * L=100 cannot reach the target — e.g. mid-grey on mid-grey.
 */
export function nearestPassingColor(
  foregroundHex: string,
  backgroundHex: string,
  { level = "AA-normal" as ContrastLevel } = {},
): string | null {
  const target = level === "AA-normal" ? AA_NORMAL : AA_LARGE;
  if (contrastRatio(foregroundHex, backgroundHex) >= target) return foregroundHex;

  const bgL = relativeLuminance(hexToRgb(backgroundHex));
  // Light bg → foreground needs to go darker; dark bg → lighter.
  const step = bgL > 0.5 ? -1 : 1;
  const { h, s, l } = rgbToHsl(hexToRgb(foregroundHex));

  let currentL = Math.round(l * 100);
  while (currentL + step >= 0 && currentL + step <= 100) {
    currentL += step;
    const candidate = rgbToHex(hslToRgb({ h, s, l: currentL / 100 }));
    if (contrastRatio(candidate, backgroundHex) >= target) return candidate;
  }
  return null;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Hsl {
  h: number; // [0, 360)
  s: number; // [0, 1]
  l: number; // [0, 1]
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`invalid hex colour: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (R ?? 0) + 0.7152 * (G ?? 0) + 0.0722 * (B ?? 0);
}

function rgbToHex({ r, g, b }: Rgb): string {
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn:
        h = ((gn - bn) / d) % 6;
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hh >= 0 && hh < 1) [r1, g1, b1] = [c, x, 0];
  else if (hh < 2) [r1, g1, b1] = [x, c, 0];
  else if (hh < 3) [r1, g1, b1] = [0, c, x];
  else if (hh < 4) [r1, g1, b1] = [0, x, c];
  else if (hh < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
  };
}
