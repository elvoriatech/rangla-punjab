import { Luckiest_Guy } from "next/font/google";

/**
 * The venue's name in the app's "sticker" lockup — lime letters with a
 * black outline and a white rim, "RANGLA PUNJAB" arched over a straight,
 * smaller "RESTAURANT" (owner, 2026-10-11: "show the restaurant name on
 * the website in the same style as in the app"). The app draws it in
 * `mobile/src/venue-wordmark.tsx`; this is the same mark for the web.
 *
 * Pure SVG, server-rendered, no JS: every line is given an exact
 * `textLength`, so the mark has the same proportions whatever the font's
 * metrics and the box never needs measuring. The visible name stays in
 * the accessibility tree through `aria-label`.
 */

const cartoon = Luckiest_Guy({ weight: "400", subsets: ["latin"], display: "swap" });

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
const CAP = 0.72;
const RIM = 0.23 * F;
const OUTLINE = 0.13 * F;

export function VenueWordmark({
  name,
  className,
  id = "vw",
}: {
  name: string;
  /** Sizing: give it a width or height class; the viewBox keeps the shape. */
  className?: string;
  /** Unique per page — SVG ids are document-wide. */
  id?: string;
}): React.ReactElement {
  const { top, bottom } = webWordmarkLines(name);
  const pad = RIM / 2 + 2;
  const width = W1 + pad * 2;
  const rise = W1 * ARCH;
  const apex1 = pad + CAP * F;
  const f2 = F * LINE2;
  const w2 = Math.min(W1, Math.max(W1 * W2_SHARE, 0));
  const base2 = apex1 + rise + CAP * f2 + 0.06 * F;
  const height = (bottom ? base2 : apex1 + rise) + 0.06 * F + pad;
  const cx = width / 2;
  const r = (W1 * W1) / (8 * rise) + rise / 2;
  const arcPath = `M ${pad} ${apex1 + rise} A ${r} ${r} 0 0 1 ${pad + W1} ${apex1 + rise}`;

  const layers = [
    { stroke: "#FFFFFF", strokeWidth: RIM, fill: "#FFFFFF" },
    { stroke: "#141414", strokeWidth: OUTLINE, fill: "#141414" },
    { stroke: "none", strokeWidth: 0, fill: `url(#${id}-lime)` },
  ];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={name}
      className={`${cartoon.className} ${className ?? ""}`}
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={`${id}-lime`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E8FA4B" />
          <stop offset="0.55" stopColor="#A9E01C" />
          <stop offset="1" stopColor="#4FA916" />
        </linearGradient>
        <path id={`${id}-arc`} d={arcPath} />
      </defs>
      {layers.map((l, i) => (
        <g
          key={i}
          fill={l.fill}
          stroke={l.stroke}
          strokeWidth={l.strokeWidth}
          strokeLinejoin="round"
          fontFamily="inherit"
        >
          <text fontSize={F} textLength={W1} lengthAdjust="spacingAndGlyphs">
            <textPath href={`#${id}-arc`} startOffset="50%" textAnchor="middle">
              {top}
            </textPath>
          </text>
          {bottom ? (
            <text
              x={cx}
              y={base2}
              fontSize={f2}
              textAnchor="middle"
              textLength={w2}
              lengthAdjust="spacingAndGlyphs"
            >
              {bottom}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
