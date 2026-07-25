import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLERGENS,
  ALLERGEN_ANNEX_II,
  ALLERGEN_LABELS,
  ALLERGEN_UI,
  SUPPORTED_LOCALES,
  getAllergenLabel,
  isAllergenKey,
  isSupportedLocale,
} from "./allergens";

describe("EU allergen vocabulary (Reg. 1169/2011 Annex II)", () => {
  it("enumerates exactly the 14 regulated allergens", () => {
    expect(ALLERGENS).toHaveLength(14);
    expect(new Set(ALLERGENS).size).toBe(14);
  });

  it("assigns each allergen a unique Annex II position from 1 to 14", () => {
    const positions = ALLERGENS.map((k) => ALLERGEN_ANNEX_II[k]);
    expect(new Set(positions).size).toBe(14);
    expect(Math.min(...positions)).toBe(1);
    expect(Math.max(...positions)).toBe(14);
  });

  it("stays in sync with the Prisma `Allergen` enum", async () => {
    const src = await readFile(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const block = src.match(/enum Allergen\s*\{([\s\S]*?)\}/);
    expect(block).not.toBeNull();
    const dbKeys = block![1]!
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//"));
    expect([...dbKeys].sort()).toEqual([...ALLERGENS].sort());
  });
});

describe("allergen translations", () => {
  it("has a non-empty translation for every allergen in every supported locale", () => {
    for (const key of ALLERGENS) {
      for (const locale of SUPPORTED_LOCALES) {
        const label = ALLERGEN_LABELS[key]?.[locale];
        expect(label, `${key}.${locale}`).toBeTruthy();
        expect(label!.trim(), `${key}.${locale} has leading/trailing whitespace`).toBe(label);
      }
    }
  });

  it("labels are unique within a locale (guards against copy-paste bugs)", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const values = ALLERGENS.map((k) => ALLERGEN_LABELS[k][locale]);
      expect(new Set(values).size, `duplicate labels in ${locale}`).toBe(ALLERGENS.length);
    }
  });

  it("has 'contains' and 'traces' UI templates with a {name} slot for every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(ALLERGEN_UI[locale].contains).toContain("{name}");
      expect(ALLERGEN_UI[locale].traces).toContain("{name}");
    }
  });
});

describe("getAllergenLabel", () => {
  it("renders the 'contains' phrase in English", () => {
    expect(getAllergenLabel("milk", "en")).toBe("Contains milk");
    expect(getAllergenLabel("nuts", "en")).toBe("Contains nuts");
  });

  it("renders the 'contains' phrase in German", () => {
    expect(getAllergenLabel("milk", "de")).toBe("Enthält: Milch");
    expect(getAllergenLabel("nuts", "de")).toBe("Enthält: Schalenfrüchte");
  });

  it("renders the 'may contain traces' phrase in English", () => {
    expect(getAllergenLabel("peanuts", "en", { trace: true })).toBe(
      "May contain traces of peanuts",
    );
  });

  it("renders the 'may contain traces' phrase in German", () => {
    expect(getAllergenLabel("peanuts", "de", { trace: true })).toBe("Mögliche Spuren: Erdnüsse");
  });
});

describe("type guards", () => {
  it("isAllergenKey accepts every canonical key and rejects anything else", () => {
    for (const key of ALLERGENS) expect(isAllergenKey(key)).toBe(true);
    expect(isAllergenKey("chocolate")).toBe(false);
    expect(isAllergenKey("")).toBe(false);
    expect(isAllergenKey(42)).toBe(false);
    expect(isAllergenKey(undefined)).toBe(false);
    expect(isAllergenKey(null)).toBe(false);
  });

  it("isSupportedLocale accepts every supported locale and rejects anything else", () => {
    for (const l of SUPPORTED_LOCALES) expect(isSupportedLocale(l)).toBe(true);
    expect(isSupportedLocale("fr")).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });
});
