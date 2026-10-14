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
}

export function seoProfile(env: Record<string, string | undefined> = process.env): SeoProfile {
  return {
    cuisine: list(env.SEO_CUISINE, ["Indisch", "Pakistanisch"]),
    priceRange: (env.SEO_PRICE_RANGE ?? "€€").trim() || null,
    sameAs: list(env.SEO_SAME_AS, ["https://www.instagram.com/ranglapunjab20232023/"]).filter((u) =>
      /^https:\/\//.test(u),
    ),
  };
}
