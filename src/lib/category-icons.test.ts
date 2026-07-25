import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORY_ICON, categoryIcon, isDrinkCategory } from "./category-icons";

describe("categoryIcon", () => {
  it("matches German menu categories", () => {
    expect(categoryIcon("Warme Vorspeisen")).toBe("🥟");
    expect(categoryIcon("Tagessuppen")).toBe("🍲");
    expect(categoryIcon("Kindergerichte")).toBe("🧒");
    expect(categoryIcon("Salate")).toBe("🥗");
    expect(categoryIcon("Fladenbrot")).toBe("🫓");
    expect(categoryIcon("Vegetarische Gerichte")).toBe("🌱");
    expect(categoryIcon("Vegane Gerichte")).toBe("🌿");
    expect(categoryIcon("Hähnchen")).toBe("🍗");
    expect(categoryIcon("Lamm")).toBe("🥩");
    expect(categoryIcon("Tandoori Spezialitäten")).toBe("🔥");
    expect(categoryIcon("Getränke")).toBe("🥤");
  });

  it("resolves the ordering traps: Reisgerichte is rice, Meeresfrüchte is seafood", () => {
    expect(categoryIcon("Reisgerichte")).toBe("🍚");
    expect(categoryIcon("Fisch & Meeresfrüchte")).toBe("🦐");
    expect(categoryIcon("Fisch")).toBe("🐟");
    expect(categoryIcon("Eis")).toBe("🍦");
  });

  it("matches English names and falls back to the cutlery icon", () => {
    expect(categoryIcon("Starters")).toBe("🥟");
    expect(categoryIcon("Burgers")).toBe("🍔");
    expect(categoryIcon("Cocktails")).toBe("🍸");
    expect(categoryIcon("Chef's Specials")).toBe(DEFAULT_CATEGORY_ICON);
  });

  it("classifies drink categories (halal defaults skip them)", () => {
    for (const drinks of ["Getränke", "Lassi", "Drinks", "Weinkarte", "Kaffee & Tee"]) {
      expect(isDrinkCategory(drinks), drinks).toBe(true);
    }
    for (const food of ["Warme Vorspeisen", "Hähnchen", "Tagessuppen", "Dessert"]) {
      expect(isDrinkCategory(food), food).toBe(false);
    }
  });
});
