/**
 * 14 EU-regulated allergens per Annex II of Regulation (EU) 1169/2011.
 * Menus published through Guesto must declare these using the structured
 * enum — free-text allergen fields are not accepted by the schema.
 *
 * The set of keys here is the source of truth for the app; the Prisma
 * `Allergen` enum must stay in sync. A test asserts the two lists match.
 */

import { UI_LOCALES, type UiLocale } from "./locales";

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

/** The locales with a full guest-copy catalogue (src/lib/locales.ts) —
 *  an allergen list a guest can't read is worse than useless, so this
 *  list tracks the UI tier exactly rather than keeping its own. */
export const SUPPORTED_LOCALES: readonly UiLocale[] = UI_LOCALES;
export type Locale = UiLocale;

/**
 * Localised display name for each allergen. Nominative form so the label
 * composes cleanly with either the "contains" template or the "traces"
 * template below. The German entries follow the Bundesministerium für
 * Ernährung und Landwirtschaft's food-labelling guidance for Annex II;
 * the Spanish and Italian ones follow the wording their national
 * food-safety authorities use for the same Annex II items.
 */
export const ALLERGEN_LABELS: Record<AllergenKey, Record<Locale, string>> = {
  gluten: { en: "gluten", de: "Gluten", es: "gluten", it: "glutine", ar: "الغلوتين" },
  crustaceans: {
    en: "crustaceans",
    de: "Krebstiere",
    es: "crustáceos",
    it: "crostacei",
    ar: "القشريات",
  },
  eggs: { en: "eggs", de: "Eier", es: "huevos", it: "uova", ar: "البيض" },
  fish: { en: "fish", de: "Fisch", es: "pescado", it: "pesce", ar: "الأسماك" },
  peanuts: {
    en: "peanuts",
    de: "Erdnüsse",
    es: "cacahuetes",
    it: "arachidi",
    ar: "الفول السوداني",
  },
  soybeans: { en: "soybeans", de: "Sojabohnen", es: "soja", it: "soia", ar: "فول الصويا" },
  milk: { en: "milk", de: "Milch", es: "leche", it: "latte", ar: "الحليب" },
  nuts: {
    en: "nuts",
    de: "Schalenfrüchte",
    es: "frutos de cáscara",
    it: "frutta a guscio",
    ar: "المكسرات",
  },
  celery: { en: "celery", de: "Sellerie", es: "apio", it: "sedano", ar: "الكرفس" },
  mustard: { en: "mustard", de: "Senf", es: "mostaza", it: "senape", ar: "الخردل" },
  sesame: { en: "sesame", de: "Sesamsamen", es: "sésamo", it: "sesamo", ar: "السمسم" },
  sulphites: { en: "sulphites", de: "Sulfite", es: "sulfitos", it: "solfiti", ar: "الكبريتيت" },
  lupin: { en: "lupin", de: "Lupinen", es: "altramuces", it: "lupini", ar: "الترمس" },
  molluscs: { en: "molluscs", de: "Weichtiere", es: "moluscos", it: "molluschi", ar: "الرخويات" },
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
  es: {
    contains: "Contiene {name}",
    traces: "Puede contener trazas de {name}",
  },
  it: {
    contains: "Contiene {name}",
    traces: "Può contenere tracce di {name}",
  },
  ar: {
    contains: "يحتوي على {name}",
    traces: "قد يحتوي على آثار من {name}",
  },
};

/**
 * Bare localised name, for lists that carry their own "Contains" /
 * "May contain traces of" heading (the guest allergen dialog). Menus
 * imported before the enum was enforced can still hold a non-canonical
 * key, so an unknown id degrades to a humanised form rather than
 * disappearing from a legally-required disclosure.
 */
export function allergenName(key: string, locale: Locale): string {
  if (isAllergenKey(key)) return ALLERGEN_LABELS[key][locale];
  const t = key.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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
