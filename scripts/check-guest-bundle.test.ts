import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALE_SENTINELS, findLocaleLeaks } from "./check-guest-bundle";

/**
 * P7-16 — the guest page must ship ONE language's copy, not five. The
 * mechanical proof is `findLocaleLeaks`, which scans the chunks the
 * `(public)` route boots with for a distinctive string from each locale
 * of each guest catalogue.
 *
 * These tests cover the scanner itself (no build needed) plus the thing
 * that would silently rot it: a sentinel that no longer matches the copy
 * it was taken from, which would leave the guard passing forever.
 */

const I18N = path.join(process.cwd(), "src", "lib", "i18n");

/** Where each sentinel's words live, now that `checkout` is one file per
 *  locale and `menu` is still a single five-locale module. */
function catalogueSource(catalogue: string, locale: string): string {
  const file =
    catalogue === "checkout"
      ? path.join(I18N, "checkout", `${locale}.ts`)
      : path.join(I18N, `${catalogue}.ts`);
  return readFileSync(file, "utf8");
}

const CUSTOM = [{ catalogue: "test", locale: "xx", text: "needle" }];

describe("findLocaleLeaks", () => {
  it("passes a chunk that carries no catalogue copy", () => {
    const chunk = { file: "static/chunks/app.js", source: 'e("labels are PROPS now")' };
    expect(findLocaleLeaks([chunk])).toEqual([]);
  });

  it("flags every locale a chunk leaked, naming file and catalogue", () => {
    const source = `x("${LOCALE_SENTINELS[0].text}");y("${LOCALE_SENTINELS[1].text}")`;
    const leaks = findLocaleLeaks([{ file: "static/chunks/guest.js", source }]);
    expect(leaks).toHaveLength(2);
    expect(leaks.every((l) => l.file === "static/chunks/guest.js")).toBe(true);
    expect(leaks.map((l) => `${l.catalogue}.${l.locale}`)).toEqual([
      `${LOCALE_SENTINELS[0].catalogue}.${LOCALE_SENTINELS[0].locale}`,
      `${LOCALE_SENTINELS[1].catalogue}.${LOCALE_SENTINELS[1].locale}`,
    ]);
  });

  it("catches the ENGLISH catalogue too — the rule is no catalogue at all", () => {
    const en = LOCALE_SENTINELS.find((s) => s.locale === "en" && s.catalogue === "checkout");
    expect(en).toBeDefined();
    expect(findLocaleLeaks([{ file: "c.js", source: `t("${en?.text}")` }])).toHaveLength(1);
  });

  it("scans every chunk it is handed, not just the first", () => {
    const leaks = findLocaleLeaks([
      { file: "a.js", source: "harmless" },
      { file: "b.js", source: LOCALE_SENTINELS[3].text },
    ]);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].file).toBe("b.js");
  });

  it("accepts a custom sentinel table", () => {
    const leaks = findLocaleLeaks([{ file: "a.js", source: "needle" }], CUSTOM);
    expect(leaks).toEqual([{ file: "a.js", catalogue: "test", locale: "xx", text: "needle" }]);
  });
});

describe("LOCALE_SENTINELS", () => {
  it("covers all five UI locales of both guest catalogues", () => {
    for (const catalogue of ["checkout", "menu"]) {
      const locales = LOCALE_SENTINELS.filter((s) => s.catalogue === catalogue).map(
        (s) => s.locale,
      );
      expect(new Set(locales), catalogue).toEqual(new Set(["en", "de", "es", "it", "ar"]));
    }
  });

  it("every sentinel is still a literal in the catalogue it names", () => {
    for (const s of LOCALE_SENTINELS) {
      const label = `${s.catalogue}.${s.locale}`;
      expect(catalogueSource(s.catalogue, s.locale), label).toContain(s.text);
    }
  });

  it("checkout sentinels appear in their own locale file and no other", () => {
    const checkout = LOCALE_SENTINELS.filter((s) => s.catalogue === "checkout");
    for (const s of checkout) {
      for (const other of checkout) {
        if (other.locale === s.locale) continue;
        const label = `${s.locale} sentinel also appears in checkout/${other.locale}.ts`;
        expect(catalogueSource("checkout", other.locale).includes(s.text), label).toBe(false);
      }
    }
  });

  it("menu sentinels occur exactly once in the five-locale module", () => {
    const menu = catalogueSource("menu", "en");
    for (const s of LOCALE_SENTINELS.filter((x) => x.catalogue === "menu")) {
      expect(menu.split(s.text).length - 1, `menu.${s.locale}`).toBe(1);
    }
  });
});
