/**
 * Image URL helpers shared by the dashboard lists and the public menu.
 *
 * Uploaded photos live on local disk under public/uploads and are served
 * resized through `/img/{key}?w=…` (sharp, on the fly). Dishes without a
 * photo fall back to one of the styled defaults in /public — picked by a
 * stable hash of the item id so the same dish always gets the same
 * picture, and neighbours don't repeat.
 */

// Square center-crops of the styled originals — a square source keeps
// its subject intact in every container (grid squares, list portraits,
// showcase circles) where the tall originals cropped awkwardly.
// Basenames only — each ships as right-sized WebP at 320px (1x) and
// 640px (2x); the old full-size PNGs cost ~110 KB each, these ~18/40 KB.
export const DEFAULT_DISH_IMAGES = [
  "/dish_1_sq",
  "/dish_2_sq",
  "/dish_3_sq",
  "/dish_4_sq",
  "/dish_5_sq",
] as const;

/** Resized, cacheable URL for an uploaded image. */
export function uploadedImageUrl(storageKey: string, width: number): string {
  return `/img/${encodeURIComponent(storageKey)}?w=${width}`;
}

/** Deterministic default from /public for entities without an upload. */
export function defaultDishImage(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `${DEFAULT_DISH_IMAGES[h % DEFAULT_DISH_IMAGES.length]!}-320.webp`;
}

function defaultDishBase(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return DEFAULT_DISH_IMAGES[h % DEFAULT_DISH_IMAGES.length]!;
}

/**
 * DPR srcset companion to `menuImageUrl`: 1x/2x pair so a phone's
 * retina screen gets a sharp image while a 1x screen never downloads
 * double the pixels. Uploads go through the /img proxy (which also
 * negotiates AVIF); placeholders use the pre-sized WebP pair.
 */
export function menuImageSrcSet(
  storageKey: string | null | undefined,
  seed: string,
  width: number,
): string {
  if (storageKey) {
    return `${uploadedImageUrl(storageKey, width)} 1x, ${uploadedImageUrl(storageKey, width * 2)} 2x`;
  }
  const base = defaultDishBase(seed);
  return `${base}-320.webp 1x, ${base}-640.webp 2x`;
}

/** One entry of a Next `metadata.icons` list. */
export type IconDescriptor = { url: string; sizes?: string; type?: string };

/**
 * THE favicon/touch-icon set — the single one this product ships, used by
 * the root layout and by every guest menu page alike.
 *
 * `?v=4` is a cache buster, bumped whenever the art behind these URLs
 * changes OR whenever a page starts pointing at a different icon than it
 * did before. Browsers cache favicons far more stubbornly than any other
 * asset — Chrome keeps them in a database a normal reload never touches —
 * so without a new URL a returning guest keeps the old tab icon. It went
 * to v4 on 2026-09-21, when the guest menu stopped swapping in the
 * uploaded venue logo (see `venueIcons`).
 */
export const BRAND_ICONS: {
  icon: IconDescriptor[];
  apple: IconDescriptor[];
} = {
  icon: [
    { url: "/favicon.ico?v=4", sizes: "16x16 32x32 48x48" },
    { url: "/rangla-icon-180.png?v=4", sizes: "180x180", type: "image/png" },
  ],
  apple: [{ url: "/rangla-icon-180.png?v=4", sizes: "180x180", type: "image/png" }],
};

/**
 * Favicon/touch-icon set for the guest menu tab.
 *
 * Returns `BRAND_ICONS` — the same set the root layout uses — for every
 * venue. The per-venue swap (the restaurant's uploaded logo, resized as
 * PNG through the /img proxy) was deliberately turned OFF on 2026-09-21:
 * the owner wants ONE favicon on every page, so a guest never sees the
 * tab icon change as they move between the menu and the legal pages.
 *
 * The function and its `logoKey` parameter are kept rather than inlining
 * `BRAND_ICONS` at the two call sites, because the per-venue icon is the
 * multi-tenant seam: when 20k tenants each want their own tab icon, this
 * is the one place that has to change back.
 *
 * Child metadata fully replaces the root layout's `icons`, so the set has
 * to be restated by the guest pages, not omitted.
 */
export function venueIcons(_logoKey: string | null | undefined): {
  icon: IconDescriptor[];
  apple: IconDescriptor[];
} {
  return BRAND_ICONS;
}

/**
 * A 43-byte transparent GIF, inline so it costs zero requests.
 *
 * Used as the `<img>` fallback inside a `<picture>` whose only `<source>`
 * is desktop-gated: a phone matches no source, falls back to this, and
 * downloads nothing. Chrome fetches `display:none` images, so
 * `hidden md:block` alone still put a full-size decorative photo on the
 * critical path of every phone guest — and a QR menu is almost entirely
 * phone guests.
 */
export const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Widths offered for the full-bleed hero banner. It spans 100vw at every
 * breakpoint, so unlike the fixed-size dish cards (which use a 1x/2x DPR
 * pair) it wants real width descriptors: a 390px phone took the single
 * 1920px render before this, ~5x the pixels it can display.
 */
export const BANNER_WIDTHS = [640, 960, 1280, 1920] as const;

/** `w`-descriptor srcset for the full-bleed banner. */
export function bannerSrcSet(storageKey: string): string {
  return BANNER_WIDTHS.map((w) => `${uploadedImageUrl(storageKey, w)} ${w}w`).join(", ");
}

/** Uploaded photo if present, otherwise the stable default. */
export function menuImageUrl(
  storageKey: string | null | undefined,
  seed: string,
  width: number,
): string {
  return storageKey ? uploadedImageUrl(storageKey, width) : defaultDishImage(seed);
}
