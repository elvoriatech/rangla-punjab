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
    /**
     * OPTIONAL split-surface palette for themes whose cards sit on a very
     * different ground than the page (e.g. cream cards on a deep-red page).
     * When present, card interiors read these; when absent, cards fall back
     * to text/textSoft/accent — every pre-existing theme renders unchanged.
     */
    surfaceText?: string;
    surfaceTextSoft?: string;
    surfaceAccent?: string;
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
      textSoft: "#5d6675",
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
      textSoft: "#5f664f",
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
      textSoft: "#6d6055",
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
  {
    id: "modern-minimal",
    layout: "grid",
    label: "Modern Minimal",
    tagline: "Off-white, charcoal ink, one accent — photography leads.",
    vars: {
      bg: "#fafaf7",
      surface: "#ffffff",
      line: "#e8e6e0",
      text: "#1d1d1b",
      textSoft: "#6e6c66",
      accent: "#d3552a",
      positive: "#3f7030",
    },
    textureInk: "rgba(29, 29, 27, 0.04)",
  },
  {
    id: "noir-gold",
    layout: "editorial",
    label: "Noir & Gold",
    tagline: "Deep black, metallic gold, elegant serif — fine dining.",
    vars: {
      bg: "#0f0d0a",
      surface: "#1b1712",
      line: "#322a1f",
      text: "#efe6d4",
      textSoft: "#b3a68c",
      accent: "#c9a24b",
      positive: "#a7d7b4",
    },
    textureInk: "rgba(239, 230, 212, 0.05)",
  },
  {
    id: "terracotta-olive",
    layout: "list",
    label: "Terracotta & Olive",
    tagline: "Cream, warm brown, terracotta — cozy and authentic.",
    vars: {
      bg: "#f4ecdd",
      surface: "#fffaf0",
      line: "#e3d5bd",
      text: "#3c2a1d",
      textSoft: "#7c6753",
      accent: "#b85c38",
      positive: "#6b7a3f",
    },
    textureInk: "rgba(60, 42, 29, 0.05)",
  },
  {
    id: "rangla-royal",
    label: "Rangla Royal",
    layout: "editorial",
    tagline: "Deep Punjabi red, maroon cards, antique gold — the house look.",
    vars: {
      bg: "#8f1a1a",
      surface: "#701212",
      line: "#b98f3e",
      text: "#fdf3dd",
      textSoft: "#f0d9b6",
      accent: "#e8c15c",
      positive: "#a7d7b4",
      surfaceText: "#fdf3dd",
      surfaceTextSoft: "#eccfa4",
      surfaceAccent: "#e8c15c",
    },
    textureInk: "rgba(253, 243, 221, 0.05)",
  },
  {
    id: "street-bold",
    layout: "grid",
    label: "Street Bold",
    tagline: "Punchy red, taxi yellow, oversized type — street energy.",
    vars: {
      bg: "#fdf1dc",
      surface: "#ffffff",
      line: "#17151a",
      text: "#17151a",
      textSoft: "#5c5560",
      accent: "#e63946",
      positive: "#1f6b3a",
    },
    textureInk: "rgba(23, 21, 26, 0.05)",
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

/* ------------------------------------------------------------------ */
/* Backdrops — full-page background artwork                            */
/* ------------------------------------------------------------------ */

export interface MenuBackdrop {
  id: string;
  label: string;
  tagline: string;
  /** Public URL under /menu-backdrops, or null for the plain theme color. */
  image: string | null;
  /**
   * CSS gradient background instead of an artwork image. May reference the
   * active theme's plain color via {bg} / {soft} / {deep} placeholders —
   * these are the "plain colors, as a gradient" options.
   */
  gradient?: string;
  /**
   * Which ink reads on this ground. A backdrop replaces the theme's page
   * color, so PAGE-LEVEL text must follow the BACKDROP's brightness —
   * pairing a light theme with a light backdrop (or dark with dark) used
   * to collapse page text to ~1:1 contrast. Cards keep the theme's own
   * surface palette untouched.
   */
  ink?: "light" | "dark";
}

export const MENU_BACKDROPS: readonly MenuBackdrop[] = [
  { id: "none", label: "None", tagline: "Solid theme color — the default.", image: null },
  {
    id: "theme-soft",
    label: "Sunset Coral",
    tagline: "Warm coral melting into sunset red — a modern glow.",
    image: null,
    // Deepened so cream ink clears AA on every stop.
    gradient: "linear-gradient(160deg, #c44432 0%, #a52a3c 45%, #6e1b2c 100%)",
    ink: "light",
  },
  {
    id: "theme-glow",
    label: "Violet Dusk",
    tagline: "Deep indigo into violet — sleek and contemporary.",
    image: null,
    gradient: "linear-gradient(160deg, #5646c9 0%, #6f42a4 55%, #33194a 100%)",
    ink: "light",
  },
  {
    id: "crimson-silk",
    label: "Crimson Silk",
    tagline: "Deep Punjabi red, flowing like silk.",
    image: null,
    gradient: "linear-gradient(160deg, #b32e2e 0%, #8f1a1a 45%, #5f0f0f 100%)",
    ink: "light",
  },
  {
    id: "golden-hour",
    label: "Golden Hour",
    tagline: "Warm antique gold, light to amber.",
    image: null,
    gradient: "linear-gradient(160deg, #f6e3a8 0%, #ecc96e 48%, #d3a83e 100%)",
    ink: "dark",
  },
  {
    id: "ivory-mist",
    label: "Ivory Mist",
    tagline: "Soft parchment cream, barely-there warmth.",
    image: null,
    gradient: "linear-gradient(175deg, #fffdf5 0%, #f6ecd4 55%, #e3d2ac 100%)",
    ink: "dark",
  },
  {
    id: "aubergine-dusk",
    label: "Aubergine Dusk",
    tagline: "Midnight plum fading into the dark.",
    image: null,
    gradient: "linear-gradient(165deg, #4a2450 0%, #301536 55%, #190a1e 100%)",
    ink: "light",
  },
  {
    id: "rangla-royal",
    label: "Royal Crimson Wave",
    tagline: "Red-and-gold wave, welcoming chef, palace line-art.",
    image: "/menu-backdrops/rangla-royal.jpg",
    ink: "light",
  },
  {
    id: "crimson-feast",
    label: "Crimson Feast",
    tagline: "Deep red damask with gold-line dishes and spices.",
    image: "/menu-backdrops/crimson-feast.jpg",
    ink: "light",
  },
  {
    id: "ivory-minaret",
    label: "Ivory Minaret",
    tagline: "Cream parchment, faint minarets, a red-gold sweep.",
    image: "/menu-backdrops/ivory-minaret.jpg",
    ink: "dark",
  },
  {
    id: "midnight-plum",
    label: "Midnight Plum",
    tagline: "Deep aubergine, golden wheat and a gilded wave.",
    image: "/menu-backdrops/midnight-plum.jpg",
    ink: "light",
  },
] as const;

export const DEFAULT_MENU_BACKDROP_ID = "none";

export function resolveMenuBackdrop(id: string | undefined | null): MenuBackdrop {
  return MENU_BACKDROPS.find((b) => b.id === id) ?? MENU_BACKDROPS[0]!;
}

/**
 * Inline-style object MenuView spreads onto its wrapper. Defined here so
 * the appearance page's mini previews and the real renderer can never
 * drift apart.
 *
 * A backdrop (full-page artwork, cover) replaces the tiling texture; cards
 * keep their solid surface color so content stays readable on any artwork.
 * `headingColor` (owner-picked) feeds var(--menu-heading, …) fallbacks in
 * the renderer — absent means each layout's original heading color.
 */
/** Mix a #rrggbb color toward white (t>0) or black (t<0); returns #rrggbb. */
function shadeHex(hex: string, t: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const mix = (c: number): number => {
    const target = t >= 0 ? 255 : 0;
    const v = Math.round(c + (target - c) * Math.abs(t));
    return Math.max(0, Math.min(255, v));
  };
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Resolve a gradient's {bg}/{soft}/{deep} placeholders against the theme. */
export function resolveBackdropGradient(backdrop: MenuBackdrop, themeBg: string): string | null {
  if (!backdrop.gradient) return null;
  return backdrop.gradient
    .replaceAll("{bg}", themeBg)
    .replaceAll("{soft}", shadeHex(themeBg, 0.14))
    .replaceAll("{deep}", shadeHex(themeBg, -0.28));
}

export function menuThemeStyle(
  themeId: string | undefined | null,
  textureId: string | undefined | null,
  backdropId?: string | undefined | null,
  headingColor?: string | undefined | null,
): React.CSSProperties {
  const theme = resolveMenuTheme(themeId);
  const backdrop = resolveMenuBackdrop(backdropId);
  const textureImage = textureBackgroundImage(textureId, theme);
  const vars = {
    "--menu-bg": theme.vars.bg,
    "--menu-surface": theme.vars.surface,
    "--menu-line": theme.vars.line,
    "--menu-text": theme.vars.text,
    "--menu-text-soft": theme.vars.textSoft,
    "--menu-accent": theme.vars.accent,
    "--menu-positive": theme.vars.positive,
    ...(theme.vars.surfaceText ? { "--menu-surface-text": theme.vars.surfaceText } : {}),
    ...(theme.vars.surfaceTextSoft
      ? { "--menu-surface-text-soft": theme.vars.surfaceTextSoft }
      : {}),
    ...(theme.vars.surfaceAccent ? { "--menu-surface-accent": theme.vars.surfaceAccent } : {}),
    // Split-surface themes default their headings to the card ink — the page
    // ground can be artwork, and the surface pill below guarantees contrast.
    ...(theme.vars.surfaceText ? { "--menu-heading": theme.vars.surfaceText } : {}),
    ...(headingColor && /^#[0-9a-fA-F]{6}$/.test(headingColor)
      ? { "--menu-heading": headingColor }
      : {}),
  };
  // A backdrop replaces the page ground, so PAGE-LEVEL ink follows the
  // BACKDROP's declared polarity — otherwise a light theme on a light
  // backdrop (or dark on dark) renders ~1:1 page text. Cards, rail and
  // chip bars sit on their own surfaces and keep the theme untouched.
  const backdropInk =
    backdrop.image || backdrop.gradient
      ? backdrop.ink === "dark"
        ? {
            "--menu-text": "#2a1a0e",
            "--menu-text-soft": "#6f5b45",
            "--menu-accent": "#9d1c1c",
            "--menu-heading": "#2a1a0e",
          }
        : {
            "--menu-text": "#fdf3dd",
            "--menu-text-soft": "#ecd9b0",
            "--menu-accent": "#e8c15c",
            "--menu-heading": "#fdf3dd",
          }
      : {};
  Object.assign(vars, backdropInk);
  // The owner's explicit heading color still wins over the polarity ink.
  if (headingColor && /^#[0-9a-fA-F]{6}$/.test(headingColor)) {
    (vars as Record<string, string>)["--menu-heading"] = headingColor;
  }
  if (backdrop.image) {
    return {
      ...vars,
      backgroundImage: `url("${backdrop.image}")`,
      backgroundSize: "cover",
      backgroundPosition: "center top",
      backgroundAttachment: "fixed",
    } as React.CSSProperties;
  }
  const gradient = resolveBackdropGradient(backdrop, theme.vars.bg);
  if (gradient) {
    return {
      ...vars,
      backgroundImage: gradient,
      backgroundAttachment: "fixed",
    } as React.CSSProperties;
  }
  return {
    ...vars,
    ...(textureImage ? { backgroundImage: textureImage } : {}),
  } as React.CSSProperties;
}
