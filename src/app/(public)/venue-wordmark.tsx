import { CAP_HEIGHT, GLYPHS, SPACE_ADVANCE, UPM } from "./wordmark-glyphs";

/**
 * The venue's name in the app's "sticker" lockup — lime letters with a
 * black outline and a white rim, "RANGLA PUNJAB" arched over a straight,
 * smaller "RESTAURANT" (owner, 2026-10-11: "show the restaurant name on
 * the website in the same style as in the app"). The app draws it in
 * `mobile/src/venue-wordmark.tsx`; this is the same mark for the web.
 *
 * Drawn from the font's own OUTLINES (`wordmark-glyphs.ts`) rather than
 * with the font: the public page's font budget has no room for a display
 * face, and as paths the mark costs a few KB of markup, no request, and
 * looks the same before and after anything loads. Server-rendered, no JS.
 * The geometry is defined once and drawn three times with `<use>`: the
 * white rim, the black outline, then the lime fill.
 */

export interface WordmarkLines {
  top: string;
  bottom: string | null;
}

/** "Rangla Punjab Restaurant · Konstanz" → RANGLA PUNJAB / RESTAURANT.
 *  The town after the dot (or after "Restaurant") is not part of the mark. */
export function webWordmarkLines(name: string): WordmarkLines {
  const main = (name.split("·")[0] ?? name).trim();
  const words = main.split(/\s+/).filter(Boolean);
  const at = words.findIndex((w) => /^restaurant$/i.test(w));
  if (at > 0) return { top: words.slice(0, at).join(" ").toUpperCase(), bottom: "RESTAURANT" };
  if (words.length < 3) return { top: words.join(" ").toUpperCase(), bottom: null };
  return {
    top: words.slice(0, -1).join(" ").toUpperCase(),
    bottom: words[words.length - 1]!.toUpperCase(),
  };
}

// Proportions measured for the app's mark (see the app file for why).
const F = 100; // line 1 font size, in viewBox units
const W1 = 560; // line 1 width
const LINE2 = 0.725;
const W2_SHARE = 0.62;
const ARCH = 0.052;
const CAP = CAP_HEIGHT / UPM;
const RIM = 0.23 * F;
const OUTLINE = 0.13 * F;

/** A glyph's advance in font units; unknown characters take a space. */
const advance = (ch: string): number => GLYPHS[ch]?.w ?? SPACE_ADVANCE;

/** Rewrite one glyph's outline through `map` (font units in, viewBox out). */
function mapPath(d: string, map: (x: number, y: number) => [number, number]): string {
  const tokens = d.split(" ");
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const op = tokens[i++]!;
    out.push(op);
    const n = op === "M" || op === "L" ? 2 : op === "Q" ? 4 : op === "C" ? 6 : 0;
    for (let k = 0; k < n; k += 2) {
      const [x, y] = map(Number(tokens[i + k]), Number(tokens[i + k + 1]));
      out.push(x.toFixed(1), y.toFixed(1));
    }
    i += n;
  }
  return out.join(" ");
}

/**
 * One line of lettering as a single path. The glyphs are squeezed to fill
 * exactly `width` (like SVG's `lengthAdjust="spacingAndGlyphs"`) and set
 * either on a straight baseline or along an arch rising `rise` at the middle.
 */
function linePath(
  text: string,
  size: number,
  left: number,
  baseline: number,
  width: number,
  rise: number,
): string {
  const chars = [...text];
  const total = chars.reduce((s, ch) => s + advance(ch), 0);
  if (total === 0) return "";
  const sy = size / UPM;
  const sx = width / total;
  // The arch: a circle through both ends of the line and its raised middle.
  const r = rise > 0.5 ? (width * width) / (8 * rise) + rise / 2 : 0;
  const cx = left + width / 2;
  const cy = baseline - rise + r;
  const arcLen = r ? 2 * r * Math.asin(width / (2 * r)) : width;

  const parts: string[] = [];
  let pen = 0;
  for (const ch of chars) {
    const w = advance(ch);
    const glyph = GLYPHS[ch];
    const mid = (pen + w / 2) * sx; // the glyph's centre along the line
    pen += w;
    if (!glyph) continue;
    let px: number;
    let py: number;
    let cos = 1;
    let sin = 0;
    if (r) {
      const theta = (mid * (arcLen / width) - arcLen / 2) / r;
      cos = Math.cos(theta);
      sin = Math.sin(theta);
      px = cx + r * sin;
      py = cy - r * cos;
    } else {
      px = left + mid;
      py = baseline;
    }
    parts.push(
      mapPath(glyph.d, (gx, gy) => {
        const x = (gx - glyph.w / 2) * sx;
        const y = -gy * sy;
        return [px + x * cos - y * sin, py + x * sin + y * cos];
      }),
    );
  }
  return parts.join(" ");
}

export function VenueWordmark({
  name,
  className,
  id = "vw",
}: {
  name: string;
  /** Sizing: give it a width class; the viewBox keeps the shape. */
  className?: string;
  /** Unique per page — SVG ids are document-wide. */
  id?: string;
}): React.ReactElement {
  const { top, bottom } = webWordmarkLines(name);
  const pad = RIM / 2 + 2;
  const width = W1 + pad * 2;
  const rise = W1 * ARCH;
  const apex1 = pad + CAP * F;
  const ends1 = apex1 + rise;
  const f2 = F * LINE2;
  const w2 = W1 * W2_SHARE;
  const base2 = ends1 + CAP * f2 + 0.08 * F;
  const height = (bottom ? base2 : ends1) + 0.04 * F + pad;

  const d = [
    linePath(top, F, pad, ends1, W1, rise),
    bottom ? linePath(bottom, f2, (width - w2) / 2, base2, w2, 0) : "",
  ].join(" ");

  return (
    <svg
      viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
      role="img"
      aria-label={name}
      className={className}
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={`${id}-lime`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E8FA4B" />
          <stop offset="0.55" stopColor="#A9E01C" />
          <stop offset="1" stopColor="#4FA916" />
        </linearGradient>
        <path id={`${id}-t`} d={d} />
      </defs>
      <use
        href={`#${id}-t`}
        fill="#FFFFFF"
        stroke="#FFFFFF"
        strokeWidth={RIM}
        strokeLinejoin="round"
      />
      <use
        href={`#${id}-t`}
        fill="#141414"
        stroke="#141414"
        strokeWidth={OUTLINE}
        strokeLinejoin="round"
      />
      <use href={`#${id}-t`} fill={`url(#${id}-lime)`} />
    </svg>
  );
}
