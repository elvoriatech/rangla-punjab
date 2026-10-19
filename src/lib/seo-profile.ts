/**
 * Facts about the restaurant that search engines read but guests never see
 * on the page (owner, 2026-10-14: SEO work, "don't change user-visible
 * text"). Emitted in the Restaurant JSON-LD only — no copy changes.
 *
 * Defaults are this deployment's restaurant; a deploy can override each
 * with an env var (comma-separated lists):
 *
 *   SEO_CUISINE      servesCuisine            "Indisch,Pakistanisch"
 *   SEO_PRICE_RANGE  priceRange               "€€"
 *   SEO_SAME_AS      sameAs (profile URLs)    the restaurant's Instagram
 *   SEO_DISHES       dishes named in the search snippet (owner,
 *                    2026-10-19: "search results from dishes too") —
 *                    each must exist on the menu
 */

const list = (raw: string | undefined, fallback: readonly string[]): string[] =>
  raw === undefined
    ? [...fallback]
    : raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

export interface SeoProfile {
  cuisine: string[];
  priceRange: string | null;
  sameAs: string[];
  /** Well-known dishes for the snippet: what people type after the
   *  cuisine ("biryani konstanz"). */
  signatureDishes: string[];
}

export function seoProfile(env: Record<string, string | undefined> = process.env): SeoProfile {
  return {
    cuisine: list(env.SEO_CUISINE, ["Indisch", "Pakistanisch"]),
    priceRange: (env.SEO_PRICE_RANGE ?? "€€").trim() || null,
    sameAs: list(env.SEO_SAME_AS, ["https://www.instagram.com/ranglapunjab20232023/"]).filter((u) =>
      /^https:\/\//.test(u),
    ),
    signatureDishes: list(env.SEO_DISHES, [
      "Biryani",
      "Tandoori",
      "Palak Paneer",
      "Chicken Korma",
      "Naan",
      "Mango Lassi",
    ]),
  };
}

/**
 * The cuisine, as people search for it, per page language: a short form
 * for the title ("Indisches Restaurant") and a long one for the
 * description. This deployment's restaurant; another one edits here.
 */
const SEARCH_CUISINE: Record<string, { short: string; long: string }> = {
  de: { short: "Indisches Restaurant", long: "Indische und pakistanische Küche" },
  en: { short: "Indian Restaurant", long: "Indian and Pakistani food" },
  fr: { short: "Restaurant indien", long: "Cuisine indienne et pakistanaise" },
  es: { short: "Restaurante indio", long: "Cocina india y pakistaní" },
  it: { short: "Ristorante indiano", long: "Cucina indiana e pakistana" },
  ar: { short: "مطعم هندي", long: "مأكولات هندية وباكستانية" },
};

export function searchCuisine(locale: string): { short: string; long: string } {
  return SEARCH_CUISINE[locale] ?? SEARCH_CUISINE.en!;
}
