/**
 * The app's home slider, as stored in `venues.branding.heroSlides`: an
 * ordered list of upload storage keys. Shared by the dashboard service
 * (writes) and the public menu loader (reads), so both narrow the JSON
 * blob the same way.
 */

/** Most slides the slider holds — past this the dots stop reading as a
 *  pager and every extra photo is download weight on a guest's phone. */
export const MAX_HERO_SLIDES = 6;

/**
 * How a slide is stored. A slide is the DISH on the app's red hero —
 * drawn at 100 × 92 pt, so ~300 px on the densest phone. 800 px keeps
 * headroom; WebP keeps a cut-out's transparency at ~30–80 KB.
 */
export const HERO_SLIDE_STORAGE = { maxEdge: 800, webp: true } as const;

/** The width phones fetch (an allowed `/img` width, ≥ 3 × 100 pt). */
export const HERO_SLIDE_FETCH_WIDTH = 480;

/** `branding.heroSlides`, narrowed: non-empty storage keys, in order. */
export function heroSlidesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 512)
    .slice(0, MAX_HERO_SLIDES);
}
