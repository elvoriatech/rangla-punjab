import { uploadedImageUrl } from "./menu-images";
import { WEEKDAYS, type Weekday } from "./opening-hours";
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
  /** Absolute site origin, no trailing slash — turns storage keys into
   *  image URLs. Without it no `image` / `logo` is emitted. */
  siteUrl?: string;
}

const SCHEMA_DAY: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function buildRestaurantJsonLd(
  menu: PublicMenu,
  options: StructuredDataOptions,
): Record<string, unknown> {
  const { venue } = menu;
  const priceCurrency = venue.currency || "EUR";
  // The local-business fields are what a "<restaurant name>" search
  // matches against the Google Business Profile — name alone, with no
  // address or phone, gives the engine nothing to tie this site to the
  // place on the map. Each is emitted only when the owner has filled it.
  const local: Record<string, unknown> = {};
  const address = postalAddressNode(venue.postalAddress ?? null, venue.timezone);
  if (address) local.address = address;
  if (venue.contact?.landline) local.telephone = venue.contact.landline.number;
  if (venue.contact?.email) local.email = venue.contact.email.number;
  const hours = openingHoursNodes(venue.hours);
  if (hours.length > 0) local.openingHoursSpecification = hours;
  if (options.siteUrl) {
    const { bannerKey, logoKey } = venue.branding;
    const images = [bannerKey, logoKey]
      .filter((k): k is string => Boolean(k))
      .map((k) => `${options.siteUrl}${uploadedImageUrl(k, 1280)}`);
    if (images.length > 0) local.image = images;
    if (logoKey) local.logo = `${options.siteUrl}${uploadedImageUrl(logoKey, 640)}`;
  }
  if (venue.googlePlaceId) {
    local.hasMap = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(venue.googlePlaceId)}`;
  }
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: venue.name,
    url: options.pageUrl,
    ...local,
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

/**
 * "Fritz-Arnold-Str. 7\n78467 Konstanz" → PostalAddress. The owner types
 * free text, so the last line is read as "postcode town" only when it
 * starts with a 4–5 digit postcode; anything else goes out as the street
 * line alone, which is still better than no address at all.
 */
export function postalAddressNode(
  raw: string | null,
  timezone: string,
): Record<string, unknown> | null {
  if (!raw) return null;
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const node: Record<string, unknown> = { "@type": "PostalAddress" };
  const last = lines[lines.length - 1]!;
  const town = /^(\d{4,5})\s+(.+)$/.exec(last);
  if (town && lines.length > 1) {
    node.streetAddress = lines.slice(0, -1).join(", ");
    node.postalCode = town[1];
    node.addressLocality = town[2];
  } else {
    node.streetAddress = lines.join(", ");
  }
  // No country column yet; the deploys we run are all German.
  if (timezone === "Europe/Berlin") node.addressCountry = "DE";
  return node;
}

/** The weekly grid as schema.org OpeningHoursSpecification — one node per
 *  open slot. Nothing for a venue that never saved its hours. */
export function openingHoursNodes(hours: PublicMenu["venue"]["hours"]): Record<string, unknown>[] {
  if (!hours.configured) return [];
  const nodes: Record<string, unknown>[] = [];
  for (const day of WEEKDAYS) {
    const d = hours.days[day];
    if (!d || d.closed) continue;
    for (const slot of d.slots) {
      nodes.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${SCHEMA_DAY[day]}`,
        opens: slot.open,
        closes: slot.close,
      });
    }
  }
  return nodes;
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
