import type { PublicMenu } from "./public-menu";

/**
 * Dietary filter for the public menu page. GET-driven so the whole thing
 * works without JavaScript — the browser natively submits the checkboxes
 * to the URL as `?diet=vegetarian&diet=vegan`, the server component
 * reads them, and the filtered HTML comes back on the next request.
 *
 * The filter is *conjunctive*: an item passes only when its `dietary`
 * array contains *every* selected value. That matches guest expectations
 * ("vegan AND gluten-free" narrows the list) and matches how the
 * checkboxes read visually.
 */

const KNOWN_DIETS = new Set([
  "vegetarian",
  "vegan",
  "halal",
  "kosher",
  "gluten_free",
  "dairy_free",
]);

/**
 * Normalise the raw `searchParams.diet` value into a set. Accepts:
 *   - a single string (`"vegan"`)
 *   - a comma-separated string (`"vegan,gluten_free"`)
 *   - an array (`["vegan", "gluten_free"]`) — Next may deliver either
 *     shape depending on how the form serialises checkboxes.
 * Unknown values are silently dropped rather than 400'd — a guest with a
 * bookmarked URL from a schema change should still see a menu.
 */
export function parseDietFilter(raw: string | string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  const tokens = Array.isArray(raw) ? raw.flatMap((r) => r.split(",")) : raw.split(",");
  for (const t of tokens) {
    const clean = t.trim().toLowerCase();
    if (KNOWN_DIETS.has(clean)) out.add(clean);
  }
  return out;
}

/**
 * Return a new `PublicMenu` with items filtered to those matching *every*
 * requested diet. Categories that end up empty are dropped so we don't
 * render bare section headings.
 */
export function filterMenuByDiet(menu: PublicMenu, diets: Set<string>): PublicMenu {
  if (diets.size === 0) return menu;
  const wanted = Array.from(diets);
  const filteredCategories = menu.categories
    .map((cat) => ({
      ...cat,
      items: cat.items.filter((item) => wanted.every((d) => item.dietary.includes(d))),
    }))
    .filter((cat) => cat.items.length > 0);
  return { ...menu, categories: filteredCategories };
}

/**
 * Category filter driven by `?cat=<categoryId>`. When the id matches an
 * existing category, keeps only that one; unknown/missing values are
 * silently ignored so a stale bookmark still shows the whole menu.
 */
export function filterMenuByCategory(
  menu: PublicMenu,
  activeCategoryId?: string | null,
): PublicMenu {
  if (!activeCategoryId) return menu;
  const match = menu.categories.filter((c) => c.id === activeCategoryId);
  return match.length > 0 ? { ...menu, categories: match } : menu;
}

export function parseCategoryFilter(raw: string | string[] | undefined): string | null {
  if (!raw) return null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first?.trim() || null;
}

/** URL-safe slug for a category name — what guests see as `?cat=`.
 *  Database ids stay behind the scenes. */
export function categorySlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "category";
}

/** id → slug for a menu's categories, with duplicate names
 *  disambiguated (-2, -3, …) so every tab has a distinct URL. */
export function categorySlugs(categories: { id: string; name: string }[]): Map<string, string> {
  const seen = new Map<string, number>();
  const map = new Map<string, string>();
  for (const c of categories) {
    const base = categorySlug(c.name);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    map.set(c.id, n === 1 ? base : `${base}-${n}`);
  }
  return map;
}

/** Resolve the `?cat=` value — a name slug, or a raw category id from
 *  older links/bookmarks — to a category id. Unknown values fall back
 *  to null (whole menu), same forgiveness as diet filters. */
export function resolveCategoryParam(
  menu: PublicMenu,
  raw: string | string[] | undefined,
): string | null {
  const v = parseCategoryFilter(raw);
  if (!v) return null;
  const slugs = categorySlugs(menu.categories);
  for (const c of menu.categories) {
    if (c.id === v || slugs.get(c.id) === v) return c.id;
  }
  return null;
}

/** Diets every venue's public UI offers as filter tabs / badges. `halal`
 * is offered per-restaurant (branding.halalFilter === "on"); `kosher`
 * stays in the Prisma enum and in `KNOWN_DIETS` (old URLs keep
 * filtering) but is not offered in the UI for now. */
export const DIETARY_VALUES = ["vegetarian", "vegan", "gluten_free", "dairy_free"] as const;

/** The per-restaurant optional diet filter. */
export const HALAL_DIET = "halal";
export type DietaryValue = (typeof DIETARY_VALUES)[number];
