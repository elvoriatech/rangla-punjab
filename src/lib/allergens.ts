/**
 * 14 EU-regulated allergens per Annex II of Regulation (EU) 1169/2011.
 * Menus published through Guesto must declare these using the structured
 * enum — free-text allergen fields are not accepted by the schema.
 *
 * The set of keys here is the source of truth for the app; the Prisma
 * `Allergen` enum must stay in sync. A test asserts the two lists match.
 */

export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type AllergenKey = (typeof ALLERGENS)[number];

/**
 * Position of each allergen in Annex II of Reg. 1169/2011. Handy for
 * printed labels that reference the annex item number (some Member State
 * enforcement bodies expect it) and as a stable, non-alphabetical sort
 * key that survives translation.
 */
export const ALLERGEN_ANNEX_II: Record<AllergenKey, number> = {
  gluten: 1,
  crustaceans: 2,
  eggs: 3,
  fish: 4,
  peanuts: 5,
  soybeans: 6,
  milk: 7,
  nuts: 8,
  celery: 9,
  mustard: 10,
  sesame: 11,
  sulphites: 12,
  lupin: 13,
  molluscs: 14,
};

export const SUPPORTED_LOCALES = ["en", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Localised display name for each allergen. Nominative form so the label
 * composes cleanly with either the "contains" template or the "traces"
 * template below. The German entries follow the Bundesministerium für
 * Ernährung und Landwirtschaft's food-labelling guidance for Annex II.
 */
export const ALLERGEN_LABELS: Record<AllergenKey, Record<Locale, string>> = {
  gluten: { en: "gluten", de: "Gluten" },
  crustaceans: { en: "crustaceans", de: "Krebstiere" },
  eggs: { en: "eggs", de: "Eier" },
  fish: { en: "fish", de: "Fisch" },
  peanuts: { en: "peanuts", de: "Erdnüsse" },
  soybeans: { en: "soybeans", de: "Sojabohnen" },
  milk: { en: "milk", de: "Milch" },
  nuts: { en: "nuts", de: "Schalenfrüchte" },
  celery: { en: "celery", de: "Sellerie" },
  mustard: { en: "mustard", de: "Senf" },
  sesame: { en: "sesame", de: "Sesamsamen" },
  sulphites: { en: "sulphites", de: "Sulfite" },
  lupin: { en: "lupin", de: "Lupinen" },
  molluscs: { en: "molluscs", de: "Weichtiere" },
};

/**
 * Sentence templates per locale. `{name}` is substituted with the
 * localised allergen label. The German phrasings use the "Enthält: X" /
 * "Mögliche Spuren: X" colon-form standard on real German food labels,
 * which side-steps German case declension on the substituted noun.
 */
export const ALLERGEN_UI: Record<Locale, { contains: string; traces: string }> = {
  en: {
    contains: "Contains {name}",
    traces: "May contain traces of {name}",
  },
  de: {
    contains: "Enthält: {name}",
    traces: "Mögliche Spuren: {name}",
  },
};

export function getAllergenLabel(
  key: AllergenKey,
  locale: Locale,
  opts: { trace?: boolean } = {},
): string {
  const name = ALLERGEN_LABELS[key][locale];
  const template = opts.trace ? ALLERGEN_UI[locale].traces : ALLERGEN_UI[locale].contains;
  return template.replace("{name}", name);
}

export function isAllergenKey(x: unknown): x is AllergenKey {
  return typeof x === "string" && (ALLERGENS as readonly string[]).includes(x);
}

export function isSupportedLocale(x: unknown): x is Locale {
  return typeof x === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(x);
}
