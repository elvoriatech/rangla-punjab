import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Gate for the hand-written menu translation bundle.
 *
 * Reads the menu we translated FROM (`data/rangla-menu-2026-09.json` — the
 * printed card transcribed for the 2026-09 update; before that it was
 * `data/rangla-menu-source.json`, the live `/api/v1/menu` response) and
 * the bundle we translated INTO (`data/rangla-menu-translations.json`),
 * and fails loudly if the two ever drift apart. Every category and every
 * item of the source must be present, in every declared locale, with a
 * non-empty name — and with a description exactly when the source dish
 * has one (a missing description silently falls back to German on the
 * public page, which is the bug this check exists to catch).
 *
 * Exit code 1 + a list of gaps on failure, 0 and a one-line summary when
 * the bundle is complete.
 *
 *   pnpm exec tsx scripts/validate-menu-translations.ts
 *   pnpm exec tsx scripts/validate-menu-translations.ts <source.json> <translations.json>
 */

interface SourceItem {
  id: string;
  name: string;
  description?: string | null;
}
interface SourceCategory {
  id: string;
  name: string;
  items: SourceItem[];
}
interface SourceMenu {
  categories: SourceCategory[];
}

interface TranslatedField {
  name?: string;
  description?: string;
}
interface TranslatedCategory {
  id: string;
  source: string;
  translations: Record<string, TranslatedField>;
}
interface TranslatedItem {
  id: string;
  categoryId?: string;
  source: { name: string; description?: string };
  translations: Record<string, TranslatedField>;
}
export interface TranslationBundle {
  venueSlug: string;
  sourceLocale: string;
  locales: string[];
  categories: TranslatedCategory[];
  items: TranslatedItem[];
}

const DEFAULT_SOURCE = path.join(import.meta.dirname, "data", "rangla-menu-2026-09.json");
const DEFAULT_BUNDLE = path.join(import.meta.dirname, "data", "rangla-menu-translations.json");

export function validate(source: SourceMenu, bundle: TranslationBundle): string[] {
  const gaps: string[] = [];
  const locales = bundle.locales;

  const catById = new Map(bundle.categories.map((c) => [c.id, c]));
  const itemById = new Map(bundle.items.map((i) => [i.id, i]));

  const checkField = (
    where: string,
    tr: TranslatedField | undefined,
    locale: string,
    wantsDescription: boolean,
  ): void => {
    if (!tr) {
      gaps.push(`${where}: locale "${locale}" missing`);
      return;
    }
    if (!tr.name || tr.name.trim() === "") {
      gaps.push(`${where}: locale "${locale}" has an empty name`);
    }
    if (wantsDescription && (!tr.description || tr.description.trim() === "")) {
      gaps.push(`${where}: locale "${locale}" is missing the description`);
    }
  };

  for (const cat of source.categories) {
    const label = `category "${cat.name}" (${cat.id})`;
    const translated = catById.get(cat.id);
    if (!translated) {
      gaps.push(`${label}: not in the bundle`);
    } else {
      if (translated.source !== cat.name) {
        gaps.push(`${label}: bundle source text is "${translated.source}" — menu has changed`);
      }
      for (const locale of locales) {
        checkField(label, translated.translations[locale], locale, false);
      }
    }

    for (const item of cat.items) {
      const itemLabel = `item "${item.name}" (${item.id})`;
      const tItem = itemById.get(item.id);
      if (!tItem) {
        gaps.push(`${itemLabel}: not in the bundle`);
        continue;
      }
      if (tItem.source.name !== item.name) {
        gaps.push(`${itemLabel}: bundle source name is "${tItem.source.name}" — menu has changed`);
      }
      const sourceDescription = (item.description ?? "").trim();
      if (sourceDescription !== "" && !tItem.source.description) {
        gaps.push(`${itemLabel}: source description not carried into the bundle`);
      }
      for (const locale of locales) {
        checkField(itemLabel, tItem.translations[locale], locale, sourceDescription !== "");
      }
    }
  }

  // Rows in the bundle the live menu no longer has: not fatal for the
  // import (it skips them) but worth naming, because they are usually a
  // stale copy of the source file.
  const sourceCategoryIds = new Set(source.categories.map((c) => c.id));
  const sourceItemIds = new Set(source.categories.flatMap((c) => c.items.map((i) => i.id)));
  for (const cat of bundle.categories) {
    if (!sourceCategoryIds.has(cat.id))
      gaps.push(`bundle category "${cat.source}" is not in the source menu`);
  }
  for (const item of bundle.items) {
    if (!sourceItemIds.has(item.id))
      gaps.push(`bundle item "${item.source.name}" is not in the source menu`);
  }

  return gaps;
}

function main(): void {
  const [sourcePath = DEFAULT_SOURCE, bundlePath = DEFAULT_BUNDLE] = process.argv.slice(2);
  const source = JSON.parse(readFileSync(sourcePath, "utf8")) as SourceMenu;
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as TranslationBundle;

  const categories = source.categories.length;
  const items = source.categories.reduce((n, c) => n + c.items.length, 0);
  const gaps = validate(source, bundle);

  if (gaps.length > 0) {
    console.error(`✗ ${gaps.length} gap(s) in ${path.basename(bundlePath)}:`);
    for (const gap of gaps) console.error(`  - ${gap}`);
    process.exit(1);
  }
  console.log(
    `✓ ${categories} categories and ${items} items complete in ${bundle.locales.length} locales ` +
      `(${bundle.locales.join(", ")}) — ${categories * bundle.locales.length + items * bundle.locales.length} entities translated`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
