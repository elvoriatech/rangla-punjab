import { uploadedImageUrl } from "./menu-images";

/**
 * The app's home slider, as stored in `venues.branding.heroSlides`: an
 * ordered list of keys. Each slide is one of two KINDS:
 *
 * - a BANNER — a finished poster that fills the whole slide (the points
 *   poster, the gift-card poster …). Key: `banner:<storage key>` for an
 *   upload, or `builtin:<banner>`. Every built-in is one of these;
 * - a DISH — a cut-out plate on the red hero, beside the welcome line
 *   (the look the app opened with). Key: an upload's storage key. Nothing
 *   built in is a dish any more, but an owner who uploads one still gets
 *   the old slide.
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

/**
 * Everything built in — the venue's own German posters, served from
 * `/public/app-slider/`.
 *
 * Banners only since 2026-09-22 (owner): the four cut-out dish plates the
 * slider used to carry are gone, and with them the 2.8 MB of PNGs the app
 * bundled to show them. A finished poster says what a plate could not —
 * the points programme, the gift-card discount, the service promise — and
 * it is the owner's own artwork rather than a stock plate on red.
 *
 * `points-en` stays in the CATALOGUE but out of the defaults: the venue
 * serves a German high street, and the English poster is one the owner
 * adds back from the dashboard if they ever want it.
 */
export const BUILT_IN_SLIDES = [
  { name: "points-de", label: "Points banner (German)", kind: "banner" },
  { name: "welcome-de", label: "Welcome banner (German)", kind: "banner" },
  { name: "giftcard-de", label: "Gift-card banner (German)", kind: "banner" },
  { name: "service-de", label: "Service promise banner (German)", kind: "banner" },
  { name: "points-en", label: "Points banner (English)", kind: "banner" },
] as const satisfies readonly { name: string; label: string; kind: HeroSlideKind }[];

/** A venue that never touched its slider starts with the four German
 *  posters, in order — so the owner sees them, and can keep, reorder or
 *  remove each. */
export const DEFAULT_HERO_SLIDES: readonly string[] = [
  "points-de",
  "welcome-de",
  "giftcard-de",
  "service-de",
].map((name) => `${BUILTIN_PREFIX}${name}`);

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
 * kept empty — the owner removed every slide — and the app then shows the
 * plain red welcome hero, which is the one slide it needs no download for.
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

/**
 * The built-ins the slider is NOT already carrying — what the dashboard
 * offers in its "add a built-in poster" picker.
 *
 * This is the way BACK for a poster the owner removed, and the way a
 * venue whose slide list predates a new poster picks it up: the defaults
 * only apply to a venue that never touched the slider, so without this
 * the catalogue would be write-once.
 */
export function unusedBuiltInSlides(
  current: readonly string[],
): readonly (typeof BUILT_IN_SLIDES)[number][] {
  const have = new Set(current);
  return BUILT_IN_SLIDES.filter((s) => !have.has(`${BUILTIN_PREFIX}${s.name}`));
}

/** The dashboard's label for a built-in, or null for an upload. */
export function builtInLabel(key: string): string | null {
  return builtIn(key)?.label ?? null;
}
