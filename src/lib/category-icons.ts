/**
 * Emoji icons for menu categories, inferred from the category name in
 * English and German. Used when a venue enables "icons + names" in
 * Appearance and hasn't uploaded a category photo (uploads win).
 *
 * Rule order matters where names collide: "Reisgerichte" must hit the
 * rice rule before "eis" (ice cream) sees it, and "Meeresfrüchte" the
 * seafood rule before plain fish.
 */

const ICON_RULES: readonly [RegExp, string][] = [
  [/popular|belieb|empfehl/i, "⭐"],
  [/starter|vorspeise|appetizer|antipasti|tapas/i, "🥟"],
  [/soup|suppe/i, "🍲"],
  [/salad|salat/i, "🥗"],
  [/bread|brot|naan|roti|paratha/i, "🫓"],
  [/rice|reis|biryani|pulao|pilaw/i, "🍚"],
  [/chicken|hähnchen|huhn|hühner|geflügel/i, "🍗"],
  [/lamb|lamm|beef|rind|steak/i, "🥩"],
  [/seafood|meeresfrücht|garnele|shrimp|prawn|krabben/i, "🦐"],
  [/fish|fisch/i, "🐟"],
  [/tandoor|grill|bbq|barbecue/i, "🔥"],
  [/curry/i, "🍛"],
  [/noodle|nudel|ramen|pho/i, "🍜"],
  [/pasta|spaghetti/i, "🍝"],
  [/pizza/i, "🍕"],
  [/burger/i, "🍔"],
  [/sandwich|wrap|dürüm/i, "🥪"],
  [/kid|kinder/i, "🧒"],
  [/dessert|nachspeise|nachtisch|süßspeise|kuchen|cake/i, "🍰"],
  [/ice cream|icecream|\beis\b|gelato|kulfi/i, "🍦"],
  [/coffee|kaffee|espresso/i, "☕"],
  [/\btea\b|\btee\b|chai/i, "🫖"],
  [/beer|bier/i, "🍺"],
  [/wine|wein/i, "🍷"],
  [/cocktail/i, "🍸"],
  [/lassi|shake|smoothie|juice|saft|drink|getränk|beverage/i, "🥤"],
  [/vegan/i, "🌿"],
  [/vegetar/i, "🌱"],
] as const;

export const DEFAULT_CATEGORY_ICON = "🍽️";

export function categoryIcon(name: string): string {
  for (const [pattern, icon] of ICON_RULES) {
    if (pattern.test(name)) return icon;
  }
  return DEFAULT_CATEGORY_ICON;
}

/**
 * Heuristic: is this category drinks rather than food? Drives form
 * defaults (e.g. dishes default to halal, drinks don't) — EN + DE.
 */
const DRINK_PATTERN =
  /drink|getränk|beverage|lassi|juice|saft|shake|smoothie|coffee|kaffee|espresso|\btea\b|\btee\b|chai|beer|bier|wine|wein|cocktail|spirit|schnaps|wasser|water|cola|soda|limonade/i;

export function isDrinkCategory(name: string): boolean {
  return DRINK_PATTERN.test(name);
}
