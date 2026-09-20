/**
 * Generates the three default gift-card images shipped in
 * `public/brand/gift-cards/`.
 *
 * They are deliberately WORDLESS — no card name, no price, no language.
 * The owner renames the three products freely (and the price is a
 * per-venue integer-cents field), so any text baked into the artwork
 * would be a lie in five of our six locales the moment it is edited.
 * What carries the brand is the palette from the "Rangla Royal" menu
 * theme (deep red / maroon / antique gold / cream) and a Mughal arch +
 * jali geometry that already runs through the menu textures.
 *
 * Output is PNG rather than SVG because the same URL is rendered by
 * React Native's <Image> in the Expo app, which will not rasterise a
 * remote SVG without extra deps.
 *
 * Re-run with:  pnpm exec tsx scripts/generate-gift-card-images.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** Credit-card proportions (85.6 × 54 mm ≈ 1.586:1), at 2× for retina. */
const WIDTH = 1024;
const HEIGHT = 646;

const PALETTE = {
  red: "#8f1a1a",
  maroon: "#701212",
  ink: "#2a1a0e",
  gold: "#e8c15c",
  goldDeep: "#b98f3e",
  cream: "#fdf3dd",
} as const;

interface CardSpec {
  /** File basename, also the key stored on the seeded product. */
  slug: string;
  /** Background gradient stops, top-left to bottom-right. */
  from: string;
  to: string;
  /** Ink used for the frame, arch and jali. */
  foil: string;
  foilSoft: string;
  /** Opacity of the jali lattice — the tier's "richness" dial. */
  jaliOpacity: number;
  /** Rosette rings drawn at the centre of the arch. */
  rings: number;
}

const CARDS: CardSpec[] = [
  // Tier 1 — light and friendly: cream field, red frame, gold details.
  {
    slug: "kleine-freude",
    from: PALETTE.cream,
    to: "#f4e3c2",
    foil: PALETTE.red,
    foilSoft: PALETTE.goldDeep,
    jaliOpacity: 0.16,
    rings: 2,
  },
  // Tier 2 — the house look: deep Punjabi red with antique gold.
  {
    slug: "genussabend",
    from: PALETTE.red,
    to: PALETTE.maroon,
    foil: PALETTE.gold,
    foilSoft: PALETTE.goldDeep,
    jaliOpacity: 0.22,
    rings: 3,
  },
  // Tier 3 — the occasion card: near-black ink, heaviest gold.
  {
    slug: "festmahl",
    from: PALETTE.ink,
    to: "#120a04",
    foil: PALETTE.gold,
    foilSoft: PALETTE.gold,
    jaliOpacity: 0.3,
    rings: 4,
  },
];

/**
 * A jali lattice: the repeating pierced-screen diamond that already
 * appears as a menu texture. Built as a <pattern> so the cost is one
 * tile regardless of card size.
 */
function jali(spec: CardSpec): string {
  return `
    <pattern id="jali" width="64" height="64" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="${spec.foil}" stroke-width="2"
         stroke-opacity="${spec.jaliOpacity}">
        <path d="M32 0 L64 32 L32 64 L0 32 Z" />
        <circle cx="32" cy="32" r="11" />
        <path d="M0 0 L8 8 M64 0 L56 8 M0 64 L8 56 M64 64 L56 56" />
      </g>
    </pattern>`;
}

/** Concentric rosette rings sitting inside the arch. */
function rosette(spec: CardSpec, cx: number, cy: number): string {
  const rings = Array.from({ length: spec.rings }, (_, i) => {
    const r = 30 + i * 17;
    const opacity = (1 - i * 0.18).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${i % 2 === 0 ? spec.foil : spec.foilSoft}"
      stroke-width="${i === 0 ? 5 : 2.5}" stroke-opacity="${opacity}" />`;
  }).join("\n      ");

  // Eight-point star inside the innermost ring — the Mughal sitara.
  const points = Array.from({ length: 16 }, (_, i) => {
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    const r = i % 2 === 0 ? 22 : 9;
    return `${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`;
  }).join(" ");

  return `${rings}
      <polygon points="${points}" fill="${spec.foil}" fill-opacity="0.9" />`;
}

function cardSvg(spec: CardSpec): string {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const inset = 34;
  const frameInset = 52;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"
     viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img"
     aria-label="Gift card">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${spec.from}" />
      <stop offset="1" stop-color="${spec.to}" />
    </linearGradient>
    <linearGradient id="foil" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${spec.foilSoft}" />
      <stop offset="0.45" stop-color="${spec.foil}" />
      <stop offset="1" stop-color="${spec.foilSoft}" />
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="${spec.foil}" stop-opacity="0.18" />
      <stop offset="1" stop-color="${spec.foil}" stop-opacity="0" />
    </radialGradient>
    ${jali(spec)}
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" rx="44" fill="url(#bg)" />
  <rect width="${WIDTH}" height="${HEIGHT}" rx="44" fill="url(#jali)" />
  <rect width="${WIDTH}" height="${HEIGHT}" rx="44" fill="url(#glow)" />

  <!-- Double rule frame: heavy outer, hairline inner. -->
  <rect x="${inset}" y="${inset}" width="${WIDTH - inset * 2}" height="${HEIGHT - inset * 2}"
        rx="26" fill="none" stroke="url(#foil)" stroke-width="6" />
  <rect x="${frameInset}" y="${frameInset}" width="${WIDTH - frameInset * 2}" height="${HEIGHT - frameInset * 2}"
        rx="18" fill="none" stroke="${spec.foilSoft}" stroke-width="1.5" stroke-opacity="0.65" />

  <!-- Mughal arch, open at the base so it reads as a doorway. -->
  <path d="M${cx - 132} ${cy + 168}
           L${cx - 132} ${cy - 24}
           Q${cx - 132} ${cy - 132} ${cx} ${cy - 168}
           Q${cx + 132} ${cy - 132} ${cx + 132} ${cy - 24}
           L${cx + 132} ${cy + 168}"
        fill="none" stroke="url(#foil)" stroke-width="4" stroke-opacity="0.9" />

  ${rosette(spec, cx, cy - 10)}

  <!-- Corner flourishes. -->
  ${[
    [inset + 30, inset + 30, 1, 1],
    [WIDTH - inset - 30, inset + 30, -1, 1],
    [inset + 30, HEIGHT - inset - 30, 1, -1],
    [WIDTH - inset - 30, HEIGHT - inset - 30, -1, -1],
  ]
    .map(
      ([x, y, sx, sy]) =>
        `<path d="M${x} ${y + sy * 40} L${x} ${y} L${x + sx * 40} ${y}"
          fill="none" stroke="${spec.foil}" stroke-width="3" stroke-opacity="0.8"
          stroke-linecap="round" />`,
    )
    .join("\n  ")}
</svg>`;
}

async function main() {
  const outDir = path.join(process.cwd(), "public", "brand", "gift-cards");
  await mkdir(outDir, { recursive: true });

  for (const spec of CARDS) {
    const svg = cardSvg(spec);
    await writeFile(path.join(outDir, `${spec.slug}.svg`), svg, "utf8");
    // Palette-quantised: the artwork is flat colour plus one soft gradient,
    // so 256 colours costs nothing visible and keeps each card well under
    // 100 kB — these ship to phones over restaurant wifi.
    await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toFile(path.join(outDir, `${spec.slug}.png`));
    console.log(`wrote ${spec.slug}.svg + ${spec.slug}.png`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
