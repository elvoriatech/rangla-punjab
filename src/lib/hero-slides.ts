import { uploadedImageUrl } from "./menu-images";

/**
 * The dishes on the app's home slider, as stored in
 * `venues.branding.heroSlides`: an ordered list of keys. A key is either
 * an upload's storage key or `builtin:<name>` — one of the four dishes
 * the app has always shown, served as web copies from
 * `/public/app-slider/`. Shared by the dashboard service (writes) and the
 * public menu loader (reads), so both narrow the JSON blob the same way.
 */

/** Most dishes the slider holds — past this the dots stop reading as a
 *  pager and every extra photo is download weight on a guest's phone. */
export const MAX_HERO_SLIDES = 6;

/**
 * How an uploaded dish is stored. It is drawn at 100 × 92 pt on the red
 * hero, so ~300 px on the densest phone. 800 px keeps headroom; WebP
 * keeps a cut-out's transparency at ~30–80 KB.
 */
export const HERO_SLIDE_STORAGE = { maxEdge: 800, webp: true } as const;

/** The width phones fetch (an allowed `/img` width, ≥ 3 × 100 pt). */
export const HERO_SLIDE_FETCH_WIDTH = 480;

const BUILTIN_PREFIX = "builtin:";

/** The four dishes built into the app (`mobile/assets/carousel/`), in
 *  the order it has always shown them. */
export const BUILT_IN_DISHES = [
  { name: "hero-biryani", label: "Biryani" },
  { name: "hero-kebab", label: "Kebab" },
  { name: "hero-karahi", label: "Karahi" },
  { name: "hero-biryani-2", label: "Biryani (second plate)" },
] as const;

const BUILT_IN_NAMES: ReadonlySet<string> = new Set(BUILT_IN_DISHES.map((d) => d.name));

/** A venue that never touched its slider starts with the four dishes the
 *  app already shows — so the owner sees them, and can keep, reorder or
 *  remove each one and add up to the limit beside them. */
export const DEFAULT_HERO_SLIDES: readonly string[] = BUILT_IN_DISHES.map(
  (d) => `${BUILTIN_PREFIX}${d.name}`,
);

function builtInName(key: string): string | null {
  if (!key.startsWith(BUILTIN_PREFIX)) return null;
  const name = key.slice(BUILTIN_PREFIX.length);
  return BUILT_IN_NAMES.has(name) ? name : null;
}

function isValidKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) return false;
  // An unknown `builtin:` name would point at a file that isn't there.
  return key.startsWith(BUILTIN_PREFIX) ? builtInName(key) !== null : true;
}

/**
 * `branding.heroSlides`, narrowed: valid keys, in order, capped.
 * Never set (absent) ⇒ the built-in defaults. An explicitly EMPTY list is
 * kept empty — the owner removed every dish — and the app then falls
 * back to the plates bundled in it, which are the same four.
 */
export function heroSlidesOf(raw: unknown): string[] {
  if (raw === undefined) return [...DEFAULT_HERO_SLIDES];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidKey).slice(0, MAX_HERO_SLIDES);
}

/** Site-relative image URL for a slide key, `width` px wide. */
export function heroSlideUrl(key: string, width: number): string {
  const name = builtInName(key);
  return name ? `/app-slider/${name}.webp` : uploadedImageUrl(key, width);
}

/** The dashboard's label for a built-in dish, or null for an upload. */
export function builtInLabel(key: string): string | null {
  const name = builtInName(key);
  return BUILT_IN_DISHES.find((d) => d.name === name)?.label ?? null;
}
