import { describe, expect, it } from "vitest";
import {
  filterMenuByCategory,
  filterMenuByDiet,
  parseDietFilter,
  categorySlug,
  categorySlugs,
  resolveCategoryParam,
} from "./dietary-filter";
import type { PublicMenu } from "./public-menu";

const menu: PublicMenu = {
  venue: {
    id: "v",
    name: "V",
    slug: "v",
    defaultLocale: "en",
    enabledLocales: ["en"],
    currency: "EUR",
    timezone: "Europe/Berlin",
    hours: { configured: false, days: {} },
    branding: {},
  },
  locale: "en",
  isPreview: false,
  offerCount: 0,
  categories: [
    {
      id: "c1",
      name: "Starters",
      items: [
        {
          id: "i1",
          name: "Salad",
          description: null,
          priceCents: 900,
          currency: "EUR",
          isAvailable: true,
          allergens: [],
          traces: [],
          dietary: ["vegetarian", "vegan"],
          spice: 0,
          variants: [],
        },
        {
          id: "i2",
          name: "Cheese plate",
          description: null,
          priceCents: 1200,
          currency: "EUR",
          isAvailable: true,
          allergens: ["milk"],
          traces: [],
          dietary: ["vegetarian"],
          spice: 0,
          variants: [],
        },
      ],
    },
    {
      id: "c2",
      name: "Mains",
      items: [
        {
          id: "i3",
          name: "Steak",
          description: null,
          priceCents: 2600,
          currency: "EUR",
          isAvailable: true,
          allergens: [],
          traces: [],
          dietary: ["gluten_free"],
          spice: 0,
          variants: [],
        },
      ],
    },
  ],
};

describe("parseDietFilter", () => {
  it("accepts a single string", () => {
    expect([...parseDietFilter("vegan")]).toEqual(["vegan"]);
  });

  it("accepts a comma-separated string", () => {
    expect([...parseDietFilter("vegan,gluten_free")].sort()).toEqual(["gluten_free", "vegan"]);
  });

  it("accepts an array (Next may deliver either shape)", () => {
    expect([...parseDietFilter(["vegan", "gluten_free"])].sort()).toEqual(["gluten_free", "vegan"]);
  });

  it("drops unknown tokens silently", () => {
    expect([...parseDietFilter("vegan,mars,dairy_free,evil-string")].sort()).toEqual([
      "dairy_free",
      "vegan",
    ]);
  });

  it("returns an empty set for undefined / empty input", () => {
    expect(parseDietFilter(undefined).size).toBe(0);
    expect(parseDietFilter("").size).toBe(0);
  });

  it("lowercases + trims tokens", () => {
    expect([...parseDietFilter("  VEGAN  , GlUTeN_free ")].sort()).toEqual([
      "gluten_free",
      "vegan",
    ]);
  });
});

describe("filterMenuByDiet", () => {
  it("returns the menu unchanged when no diets are selected", () => {
    const out = filterMenuByDiet(menu, new Set());
    expect(out).toBe(menu);
  });

  it("filters items conjunctively — an item passes only when it matches EVERY diet", () => {
    // vegan → keeps only the salad (Cheese plate is only vegetarian).
    const veganOnly = filterMenuByDiet(menu, new Set(["vegan"]));
    expect(veganOnly.categories.map((c) => c.name)).toEqual(["Starters"]);
    expect(veganOnly.categories[0]!.items.map((i) => i.name)).toEqual(["Salad"]);

    // vegetarian AND vegan → still just the salad.
    const veg = filterMenuByDiet(menu, new Set(["vegetarian", "vegan"]));
    expect(veg.categories[0]!.items.map((i) => i.name)).toEqual(["Salad"]);
  });

  it("drops categories that end up empty after filtering", () => {
    // gluten_free → only the steak matches; Starters section disappears.
    const gf = filterMenuByDiet(menu, new Set(["gluten_free"]));
    expect(gf.categories.map((c) => c.name)).toEqual(["Mains"]);
  });

  it("returns an empty categories list when nothing matches", () => {
    const halal = filterMenuByDiet(menu, new Set(["halal"]));
    expect(halal.categories).toEqual([]);
  });

  it("keeps venue metadata intact", () => {
    const veganOnly = filterMenuByDiet(menu, new Set(["vegan"]));
    expect(veganOnly.venue).toEqual(menu.venue);
    expect(veganOnly.locale).toBe(menu.locale);
    expect(veganOnly.isPreview).toBe(menu.isPreview);
  });
});

describe("category slugs", () => {
  it("slugifies names with umlauts and punctuation", () => {
    expect(categorySlug("Warme Vorspeisen")).toBe("warme-vorspeisen");
    expect(categorySlug("Süßes & Desserts")).toBe("susses-desserts");
    expect(categorySlug("---")).toBe("category");
  });

  it("disambiguates duplicate names", () => {
    const map = categorySlugs([
      { id: "a", name: "Specials" },
      { id: "b", name: "Specials" },
    ]);
    expect(map.get("a")).toBe("specials");
    expect(map.get("b")).toBe("specials-2");
  });

  it("resolves slug, raw id, and unknown values", () => {
    const menu = {
      categories: [
        { id: "c1", name: "Warme Vorspeisen" },
        { id: "c2", name: "Tagessuppen" },
      ],
    } as never;
    expect(resolveCategoryParam(menu, "warme-vorspeisen")).toBe("c1");
    expect(resolveCategoryParam(menu, "c2")).toBe("c2"); // old bookmark
    expect(resolveCategoryParam(menu, "nope")).toBeNull();
    expect(resolveCategoryParam(menu, undefined)).toBeNull();
  });
});

describe("category + diet together (the order the page applies them)", () => {
  it("empties a category that has nothing matching the diet, instead of showing the whole menu", () => {
    // "Mains" holds only a gluten-free steak, so vegan leaves it with nothing.
    const activeCategoryId = resolveCategoryParam(menu, "mains");
    expect(activeCategoryId).toBe("c2");

    // The order src/app/(public)/page.tsx uses: category first, then diet.
    const out = filterMenuByDiet(filterMenuByCategory(menu, activeCategoryId), new Set(["vegan"]));

    // Empty — which is what renders the "no dishes match" message.
    // Swap the two calls and this returns Starters instead: filterMenuByDiet
    // drops the emptied category, filterMenuByCategory then finds no match,
    // reads that as a stale bookmark, and hands back the entire menu. That
    // was the bug where picking vegan made the category tabs stop responding.
    expect(out.categories).toEqual([]);
  });

  it("keeps only the matching items when the picked category does have them", () => {
    const activeCategoryId = resolveCategoryParam(menu, "starters");
    const out = filterMenuByDiet(filterMenuByCategory(menu, activeCategoryId), new Set(["vegan"]));
    expect(out.categories.map((c) => c.id)).toEqual(["c1"]);
    expect(out.categories[0].items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("still ignores an unknown category so stale bookmarks show the full menu", () => {
    expect(resolveCategoryParam(menu, "no-such-category")).toBeNull();
    expect(filterMenuByCategory(menu, null).categories.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});
