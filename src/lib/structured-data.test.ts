import { describe, expect, it } from "vitest";
import type { PublicMenu } from "./public-menu";
import { buildRestaurantJsonLd, jsonLdString } from "./structured-data";

const fixture: PublicMenu = {
  venue: {
    id: "v1",
    name: "Ristorante Volpe",
    slug: "ristorante-volpe",
    defaultLocale: "en",
    enabledLocales: ["en", "de"],
    currency: "EUR",
    timezone: "Europe/Berlin",
    hours: { configured: false, days: {} },
    openNow: false,
    branding: { primaryColor: "#1f3b2e" },
  },
  locale: "en",
  isPreview: false,
  offerCount: 0,
  categories: [
    {
      id: "c1",
      name: "Mains",
      items: [
        {
          id: "i1",
          name: "Wild mushroom risotto",
          description: "aged parmesan, thyme",
          priceCents: 1800,
          currency: "EUR",
          isAvailable: true,
          allergens: ["gluten", "milk"],
          traces: [],
          dietary: ["vegetarian"],
          spice: 0,
          variants: [
            { id: "v1", name: "Regular", priceDeltaCents: 0 },
            { id: "v2", name: "Truffle", priceDeltaCents: 500 },
          ],
        },
      ],
    },
  ],
};

describe("Restaurant + Menu JSON-LD", () => {
  it("emits the schema.org envelope with menu → section → item tree", () => {
    const node = buildRestaurantJsonLd(fixture, {
      pageUrl: "https://elvoria.eu/r/ristorante-volpe/en",
    });
    expect(node["@context"]).toBe("https://schema.org");
    expect(node["@type"]).toBe("Restaurant");
    expect(node.name).toBe("Ristorante Volpe");
    expect(node.url).toBe("https://elvoria.eu/r/ristorante-volpe/en");

    const menu = node.hasMenu as Record<string, unknown>;
    expect(menu["@type"]).toBe("Menu");
    expect(menu.inLanguage).toBe("en");
    const sections = menu.hasMenuSection as Record<string, unknown>[];
    expect(sections).toHaveLength(1);
    expect(sections[0]!.name).toBe("Mains");

    const items = sections[0]!.hasMenuItem as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item["@type"]).toBe("MenuItem");
    expect(item.name).toBe("Wild mushroom risotto");
    expect(item.description).toBe("aged parmesan, thyme");

    const offer = item.offers as Record<string, unknown>;
    expect(offer.price).toBe("18.00");
    expect(offer.priceCurrency).toBe("EUR");
    expect(offer.availability).toBe("https://schema.org/InStock");

    expect(item.suitableForDiet).toEqual(["https://schema.org/VegetarianDiet"]);

    const addOns = item.menuAddOn as Record<string, unknown>[];
    expect(addOns).toHaveLength(2);
    expect(addOns[0]!.name).toBe("Regular");
    expect((addOns[1]!.offers as Record<string, unknown>).price).toBe("5.00");
  });

  it("marks unavailable items with OutOfStock availability", () => {
    const oosFixture: PublicMenu = {
      ...fixture,
      categories: [
        {
          ...fixture.categories[0]!,
          items: [{ ...fixture.categories[0]!.items[0]!, isAvailable: false }],
        },
      ],
    };
    const node = buildRestaurantJsonLd(oosFixture, { pageUrl: "https://example.com/x" });
    const item = (
      (node.hasMenu as Record<string, unknown>).hasMenuSection as Record<string, unknown>[]
    )[0]!.hasMenuItem as Record<string, unknown>[];
    expect((item[0]!.offers as Record<string, unknown>).availability).toBe(
      "https://schema.org/OutOfStock",
    );
  });

  it("omits description + menuAddOn + suitableForDiet when empty", () => {
    const bareItem = fixture.categories[0]!.items[0]!;
    const bare: PublicMenu = {
      ...fixture,
      categories: [
        {
          ...fixture.categories[0]!,
          items: [{ ...bareItem, description: null, variants: [], dietary: [] }],
        },
      ],
    };
    const node = buildRestaurantJsonLd(bare, { pageUrl: "https://example.com/x" });
    const item = (
      (node.hasMenu as Record<string, unknown>).hasMenuSection as Record<string, unknown>[]
    )[0]!.hasMenuItem as Record<string, unknown>[];
    expect("description" in item[0]!).toBe(false);
    expect("menuAddOn" in item[0]!).toBe(false);
    expect("suitableForDiet" in item[0]!).toBe(false);
  });

  it("jsonLdString escapes `<` so a `</script>` inside a name can't break out", () => {
    const evil: PublicMenu = {
      ...fixture,
      categories: [
        {
          ...fixture.categories[0]!,
          items: [{ ...fixture.categories[0]!.items[0]!, name: "boom </script><xss>" }],
        },
      ],
    };
    const s = jsonLdString(buildRestaurantJsonLd(evil, { pageUrl: "https://example.com/x" }));
    expect(s).not.toContain("</script>");
    expect(s).toContain("\\u003c/script>");
    // The wrapped string is still valid JSON (escaped-unicode is JSON-legal).
    expect(() => JSON.parse(s)).not.toThrow();
  });
});
