/**
 * Menu themes + background textures for the public menu page.
 *
 * A theme is a set of CSS custom properties the `MenuView` wrapper injects
 * as inline style; every color in the public renderer reads from these vars
 * (`bg-[var(--menu-bg)]` etc.), so switching theme is pure data — zero JS,
 * zero extra CSS files, and the renderer stays a single code path.
 *
 * A texture is a tiling inline-SVG background layered over the page color.
 * Textures take their stroke color from the theme (`textureInk`) so the
 * same pattern reads as a whisper on dark and light themes alike.
 *
 * Every text/bg pair here clears WCAG AA (4.5:1) — verified in
 * menu-themes.test.ts so a future palette tweak can't silently regress the
 * public page's accessibility guarantee.
 */

export interface MenuTheme {
  id: string;
  label: string;
  /** One line shown under the label in the appearance picker. */
  tagline: string;
  /**
   * Page layout the renderer uses:
   *  - "editorial": numbered sections, wide photo-left dish cards.
   *  - "grid": centered headings, photo-top cards in a responsive grid.
   *  - "list": ornamental food-card rows — generous rounded photo, name
   *    and description left, dotted leader to the price, ruled headings.
   *  - "showcase": chalkboard gallery — large round photos centered above
   *    name, description, and a price badge; no card boxes.
   */
  layout: "editorial" | "grid" | "list" | "showcase";
  /** CSS custom properties consumed by MenuView. All plain colors. */
  vars: {
    bg: string;
    surface: string;
    line: string;
    text: string;
    textSoft: string;
    accent: string;
    /** Dietary badge color — distinct from accent so "vegan" never reads
     *  as decoration. */
    positive: string;
  };
  /** Stroke color for background textures on this theme. */
  textureInk: string;
}

export const MENU_THEMES: readonly MenuTheme[] = [
  {
    id: "mughal-night",
    layout: "editorial",
    label: "Mughal Night",
    tagline: "Espresso and antique gold — candlelight service.",
    vars: {
      bg: "#1c130b",
      surface: "#241811",
      line: "#3a2716",
      text: "#ecdcb6",
      textSoft: "#c9b58c",
      accent: "#c9a25e",
      positive: "#a7d7b4",
    },
    textureInk: "rgba(236, 220, 182, 0.055)",
  },
  {
    id: "ivory-day",
    layout: "editorial",
    label: "Ivory Day",
    tagline: "Warm ivory and saffron — a sunlit terrace.",
    vars: {
      bg: "#f5eee1",
      surface: "#fffdf8",
      line: "#e0d3ba",
      text: "#2a1a0e",
      textSoft: "#6f6052",
      accent: "#a3450f",
      positive: "#1f6b3a",
    },
    textureInk: "rgba(42, 26, 14, 0.05)",
  },
  {
    id: "supper-club",
    layout: "editorial",
    label: "Supper Club",
    tagline: "Deep jade and champagne — velvet booths after dark.",
    vars: {
      bg: "#0f1713",
      surface: "#16221c",
      line: "#26382f",
      text: "#eae7d6",
      textSoft: "#b5b8a4",
      accent: "#d3b578",
      positive: "#9fd4ae",
    },
    textureInk: "rgba(234, 231, 214, 0.05)",
  },
  {
    id: "brasserie",
    layout: "editorial",
    label: "Brasserie",
    tagline: "Porcelain white and slate ink — crisp daytime dining.",
    vars: {
      bg: "#f7f6f2",
      surface: "#ffffff",
      line: "#e0dfd8",
      text: "#22292f",
      textSoft: "#5b646c",
      accent: "#31557f",
      positive: "#1f6b3a",
    },
    textureInk: "rgba(34, 41, 47, 0.05)",
  },
  {
    id: "fresh-bistro",
    label: "Fresh Bistro",
    layout: "grid",
    tagline: "White cards and tangerine tabs — bright, modern, photo-first.",
    vars: {
      bg: "#ffffff",
      surface: "#f7f8fa",
      line: "#e8eaee",
      text: "#24324e",
      textSoft: "#7b8494",
      accent: "#d96a10",
      positive: "#1f6b3a",
    },
    textureInk: "rgba(36, 50, 78, 0.045)",
  },
  {
    id: "herb-terrace",
    label: "Herb Terrace",
    layout: "grid",
    tagline: "Olive and tangerine on white — a garden bistro at noon.",
    vars: {
      bg: "#fbfbf7",
      surface: "#ffffff",
      line: "#e3e6da",
      text: "#333a26",
      textSoft: "#7d8471",
      accent: "#c25c12",
      positive: "#3f7030",
    },
    textureInk: "rgba(51, 58, 38, 0.05)",
  },
  {
    id: "trattoria-chalk",
    label: "Trattoria Chalk",
    layout: "showcase",
    tagline: "Midnight chalkboard and flour dust — pizzeria romance.",
    vars: {
      bg: "#232936",
      surface: "#2b3242",
      line: "#3c4457",
      text: "#eae5d8",
      textSoft: "#b1ac9c",
      accent: "#e0b568",
      positive: "#a4d6b0",
    },
    textureInk: "rgba(234, 229, 216, 0.05)",
  },
  {
    id: "royal-sapphire",
    label: "Royal Sapphire",
    layout: "list",
    tagline: "Deep navy and gilded rules — a banquet-hall menu card.",
    vars: {
      bg: "#1a2350",
      surface: "#222c60",
      line: "#3a4480",
      text: "#f0e9d8",
      textSoft: "#d3cdaf",
      accent: "#d3a84c",
      positive: "#a7d7b4",
    },
    textureInk: "rgba(240, 233, 216, 0.05)",
  },
  {
    id: "garden-gold",
    label: "Garden Gold",
    layout: "list",
    tagline: "Sage green and champagne script — garden-party elegance.",
    vars: {
      bg: "#55663f",
      surface: "#4c5c37",
      line: "#6d7d54",
      text: "#f5eecb",
      textSoft: "#e6dfbc",
      accent: "#ecd28a",
      positive: "#d6ecc1",
    },
    textureInk: "rgba(245, 238, 203, 0.06)",
  },
  {
    id: "burger-bold",
    label: "Burger Bold",
    layout: "grid",
    tagline: "White, flame orange, and big appetite — fast-food energy.",
    vars: {
      bg: "#ffffff",
      surface: "#fff6ec",
      line: "#f3e0cc",
      text: "#2b2320",
      textSoft: "#8a7d72",
      accent: "#d3410e",
      positive: "#1f6b3a",
    },
    textureInk: "rgba(43, 35, 32, 0.04)",
  },
  {
    id: "reztro",
    label: "Reztro",
    layout: "grid",
    tagline: "Clean light cards and a fresh-green accent — modern delivery app.",
    // PLACEHOLDER palette — align with the Figma Reztro tokens (node 425:18477)
    // once available. Text/bg pairs kept above WCAG AA.
    vars: {
      bg: "#f4f6f8",
      surface: "#ffffff",
      line: "#e4e8ee",
      text: "#111827",
      textSoft: "#5b6472",
      accent: "#0e9355",
      positive: "#0e7c46",
    },
    textureInk: "rgba(17, 24, 39, 0.035)",
  },
] as const;

export const DEFAULT_MENU_THEME_ID = "mughal-night";

export function resolveMenuTheme(id: string | undefined | null): MenuTheme {
  return MENU_THEMES.find((t) => t.id === id) ?? MENU_THEMES[0]!;
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

export interface MenuTexture {
  id: string;
  label: string;
  tagline: string;
  /** Tile as an SVG string with `INK` where the stroke color belongs. */
  svg: string | null;
  /** Tile size in px (square). */
  size: number;
}

export const MENU_TEXTURES: readonly MenuTexture[] = [
  {
    id: "none",
    label: "Plain",
    tagline: "No texture — let the color carry it.",
    svg: null,
    size: 0,
  },
  {
    id: "linen",
    label: "Linen",
    tagline: "A fine woven grain, like pressed table cloth.",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path d="M0 2h8M0 6h8" stroke="INK" stroke-width="1"/><path d="M2 0v8M6 0v8" stroke="INK" stroke-width="0.5"/></svg>`,
    size: 8,
  },
  {
    id: "jali",
    label: "Jali",
    tagline: "A Mughal lattice, carved-screen shadows.",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><g fill="none" stroke="INK" stroke-width="1"><path d="M24 4 L38 12 L38 28 L24 36 L10 28 L10 12 Z"/><path d="M24 4 L24 36 M10 12 L38 28 M38 12 L10 28"/><circle cx="24" cy="20" r="4"/></g></svg>`,
    size: 48,
  },
  {
    id: "terrazzo",
    label: "Terrazzo",
    tagline: "Scattered stone chips, a polished floor.",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><g fill="INK"><circle cx="9" cy="13" r="2.4"/><ellipse cx="34" cy="7" rx="3" ry="1.8" transform="rotate(24 34 7)"/><circle cx="55" cy="19" r="1.7"/><ellipse cx="20" cy="36" rx="2.6" ry="1.6" transform="rotate(-30 20 36)"/><circle cx="46" cy="42" r="2.8"/><ellipse cx="8" cy="55" rx="2" ry="1.4" transform="rotate(45 8 55)"/><circle cx="30" cy="58" r="1.6"/><ellipse cx="59" cy="59" rx="2.4" ry="1.5" transform="rotate(-18 59 59)"/></g></svg>`,
    size: 64,
  },
] as const;

export const DEFAULT_MENU_TEXTURE_ID = "none";

export function resolveMenuTexture(id: string | undefined | null): MenuTexture {
  return MENU_TEXTURES.find((t) => t.id === id) ?? MENU_TEXTURES[0]!;
}

/**
 * CSS `background-image` value for a texture under a given theme, or null
 * for the plain texture. Inlined as a data URI so the public page makes no
 * extra request for it.
 */
export function textureBackgroundImage(
  textureId: string | undefined | null,
  theme: MenuTheme,
): string | null {
  const texture = resolveMenuTexture(textureId);
  if (!texture.svg) return null;
  const svg = texture.svg.replaceAll("INK", theme.textureInk);
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Inline-style object MenuView spreads onto its wrapper. Defined here so
 * the appearance page's mini previews and the real renderer can never
 * drift apart.
 */
export function menuThemeStyle(
  themeId: string | undefined | null,
  textureId: string | undefined | null,
): React.CSSProperties {
  const theme = resolveMenuTheme(themeId);
  const textureImage = textureBackgroundImage(textureId, theme);
  return {
    "--menu-bg": theme.vars.bg,
    "--menu-surface": theme.vars.surface,
    "--menu-line": theme.vars.line,
    "--menu-text": theme.vars.text,
    "--menu-text-soft": theme.vars.textSoft,
    "--menu-accent": theme.vars.accent,
    "--menu-positive": theme.vars.positive,
    ...(textureImage ? { backgroundImage: textureImage } : {}),
  } as React.CSSProperties;
}
