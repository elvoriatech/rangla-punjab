import type { PublicMenu } from "./public-menu";

/**
 * Build a schema.org JSON-LD envelope for a public menu. The document is a
 * single `Restaurant` node whose `hasMenu` points at a `Menu` with
 * `MenuSection` → `MenuItem` nested inside — this is the shape Google's
 * rich-results test recognises for restaurant menus.
 *
 * We produce a plain JS object; the page renders it via
 * `JSON.stringify` inside a `<script type="application/ld+json">` tag, so
 * tests parse it right back out. Only fields with a real value are
 * emitted — empty descriptions or `variants: []` are omitted rather than
 * shipped as `null`, keeping the JSON tight.
 */

const DIETARY_TO_SCHEMA_URL: Record<string, string> = {
  vegetarian: "https://schema.org/VegetarianDiet",
  vegan: "https://schema.org/VeganDiet",
  halal: "https://schema.org/HalalDiet",
  kosher: "https://schema.org/KosherDiet",
  gluten_free: "https://schema.org/GlutenFreeDiet",
  dairy_free: "https://schema.org/LowLactoseDiet",
};

export interface StructuredDataOptions {
  /** Absolute URL of the menu page — e.g. https://guesto.app/r/foo/en. */
  pageUrl: string;
}

export function buildRestaurantJsonLd(
  menu: PublicMenu,
  options: StructuredDataOptions,
): Record<string, unknown> {
  const priceCurrency = menu.venue.currency || "EUR";
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: menu.venue.name,
    url: options.pageUrl,
    servesCuisine: undefined, // reserved for later — no cuisine field yet
    hasMenu: {
      "@type": "Menu",
      name: `${menu.venue.name} — Menu`,
      inLanguage: menu.locale,
      hasMenuSection: menu.categories.map((cat) => ({
        "@type": "MenuSection",
        name: cat.name,
        hasMenuItem: cat.items.map((item) => menuItemNode(item, priceCurrency)),
      })),
    },
  };
}

function menuItemNode(
  item: PublicMenu["categories"][number]["items"][number],
  priceCurrency: string,
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@type": "MenuItem",
    name: item.name,
    offers: {
      "@type": "Offer",
      price: (item.priceCents / 100).toFixed(2),
      priceCurrency,
      availability: item.isAvailable
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };
  if (item.description) node.description = item.description;
  if (item.dietary.length > 0) {
    const diets = item.dietary
      .map((d) => DIETARY_TO_SCHEMA_URL[d])
      .filter((v): v is string => Boolean(v));
    if (diets.length > 0) node.suitableForDiet = diets;
  }
  if (item.variants.length > 0) {
    node.menuAddOn = item.variants.map((v) => ({
      "@type": "MenuItem",
      name: v.name,
      offers: {
        "@type": "Offer",
        price: (v.priceDeltaCents / 100).toFixed(2),
        priceCurrency,
      },
    }));
  }
  return node;
}

/** Compact JSON — schema.org readers accept it, but no pretty-printing so
 * we don't waste bytes on the HTML response every guest downloads.
 * Escapes `<` so an item name containing `</script>` cannot break out of
 * the surrounding `<script type="application/ld+json">` tag. */
export function jsonLdString(node: Record<string, unknown>): string {
  return JSON.stringify(node).replace(/</g, "\\u003c");
}
