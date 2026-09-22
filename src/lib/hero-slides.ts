import { uploadedImageUrl } from "./menu-images";

/**
 * The app's home slider, as stored in `venues.branding.heroSlides`: an
 * ordered list of keys. Each slide is one of two KINDS:
 *
 * - a DISH — the plate on the red hero, beside the welcome line (the look
 *   the app has always had). Key: an upload's storage key, or
 *   `builtin:<dish>`;
 * - a BANNER — a finished poster that fills the whole slide (the points
 *   posters). Key: `banner:<storage key>` for an upload, or
 *   `builtin:<banner>`.
 *
 * Built-ins are served from `/public/app-slider/`. Shared by the
 * dashboard service (writes) and the public menu loader (reads), so both
 * narrow the JSON blob the same way.
 */

export type HeroSlideKind = "dish" | "banner";

/** Most slides the slider holds — past this the dots stop reading as a
 *  pager and every extra image is download weight on a guest's phone. */
export const MAX_HERO_SLIDES = 6;

/**
 * How uploads are stored. A dish is drawn at 100 × 92 pt (~300 px on the
 * densest phone): 800 px keeps headroom, WebP keeps a cut-out's
 * transparency. A banner spans the slide (~370 pt ≈ 1100 px): 1600 px.
 */
export const HERO_SLIDE_STORAGE = { maxEdge: 800, webp: true } as const;
export const HERO_BANNER_STORAGE = { maxEdge: 1600, webp: true } as const;

/** The widths phones fetch (allowed `/img` widths). */
export const HERO_SLIDE_FETCH_WIDTH = 480;
export const HERO_BANNER_FETCH_WIDTH = 1280;

const BUILTIN_PREFIX = "builtin:";
const BANNER_PREFIX = "banner:";

/** Everything built in, in the default order: the German points poster,
 *  the four dishes the app has always shown (`mobile/assets/carousel/`),
 *  the English points poster. */
export const BUILT_IN_SLIDES = [
  { name: "points-de", label: "Points banner (German)", kind: "banner" },
  { name: "hero-biryani", label: "Biryani", kind: "dish" },
  { name: "hero-kebab", label: "Kebab", kind: "dish" },
  { name: "hero-karahi", label: "Karahi", kind: "dish" },
  { name: "hero-biryani-2", label: "Biryani (second plate)", kind: "dish" },
  { name: "points-en", label: "Points banner (English)", kind: "banner" },
] as const satisfies readonly { name: string; label: string; kind: HeroSlideKind }[];

/** Just the dishes — what the app shows when the list is emptied. */
export const BUILT_IN_DISHES = BUILT_IN_SLIDES.filter((s) => s.kind === "dish");

/** A venue that never touched its slider starts with every built-in, in
 *  order — so the owner sees them, and can keep, reorder or remove each. */
export const DEFAULT_HERO_SLIDES: readonly string[] = BUILT_IN_SLIDES.map(
  (s) => `${BUILTIN_PREFIX}${s.name}`,
);

function builtIn(key: string): (typeof BUILT_IN_SLIDES)[number] | null {
  if (!key.startsWith(BUILTIN_PREFIX)) return null;
  const name = key.slice(BUILTIN_PREFIX.length);
  return BUILT_IN_SLIDES.find((s) => s.name === name) ?? null;
}

function isValidKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) return false;
  // An unknown `builtin:` name would point at a file that isn't there.
  if (key.startsWith(BUILTIN_PREFIX)) return builtIn(key) !== null;
  if (key.startsWith(BANNER_PREFIX)) return key.length > BANNER_PREFIX.length;
  return true;
}

/**
 * `branding.heroSlides`, narrowed: valid keys, in order, capped.
 * Never set (absent) ⇒ the built-in defaults. An explicitly EMPTY list is
 * kept empty — the owner removed every slide — and the app then falls
 * back to the dishes bundled in it.
 */
export function heroSlidesOf(raw: unknown): string[] {
  if (raw === undefined) return [...DEFAULT_HERO_SLIDES];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidKey).slice(0, MAX_HERO_SLIDES);
}

/** The storage key a banner upload is filed under in the slide list. */
export function bannerSlideKey(storageKey: string): string {
  return `${BANNER_PREFIX}${storageKey}`;
}

export function heroSlideKind(key: string): HeroSlideKind {
  const b = builtIn(key);
  if (b) return b.kind;
  return key.startsWith(BANNER_PREFIX) ? "banner" : "dish";
}

/** Site-relative image URL for a slide key, `width` px wide. */
export function heroSlideUrl(key: string, width: number): string {
  const b = builtIn(key);
  if (b) return `/app-slider/${b.name}.webp`;
  const storageKey = key.startsWith(BANNER_PREFIX) ? key.slice(BANNER_PREFIX.length) : key;
  return uploadedImageUrl(storageKey, width);
}

/** The width phones fetch for this slide. */
export function heroSlideFetchWidth(key: string): number {
  return heroSlideKind(key) === "banner" ? HERO_BANNER_FETCH_WIDTH : HERO_SLIDE_FETCH_WIDTH;
}

/** The dashboard's label for a built-in, or null for an upload. */
export function builtInLabel(key: string): string | null {
  return builtIn(key)?.label ?? null;
}
