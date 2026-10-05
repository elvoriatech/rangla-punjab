import { describe, expect, it } from "vitest";
import type { PublicMenu } from "./public-menu";
import { buildRestaurantJsonLd, jsonLdString, postalAddressNode } from "./structured-data";

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

  it("carries the local-business fields a name search matches on", () => {
    const local: PublicMenu = {
      ...fixture,
      venue: {
        ...fixture.venue,
        postalAddress: "Fritz-Arnold-Str. 7\n78467 Konstanz",
        googlePlaceId: "ChIJabc",
        contact: {
          landline: {
            number: "+4975313699591",
            display: "+49 7531 3699591",
            href: "tel:+4975313699591",
          },
          mobile: null,
          whatsapp: null,
          email: {
            number: "info@example.de",
            display: "info@example.de",
            href: "mailto:info@example.de",
          },
        },
        hours: {
          configured: true,
          days: {
            mon: { closed: true, slots: [] },
            tue: {
              closed: false,
              slots: [
                { open: "11:30", close: "14:30" },
                { open: "17:00", close: "22:00" },
              ],
            },
          },
        },
        branding: { bannerKey: "t/uploads/banner", logoKey: "t/uploads/logo" },
      },
    };
    const ld = buildRestaurantJsonLd(local, {
      pageUrl: "https://example.de/de",
      siteUrl: "https://example.de",
    });
    expect(ld.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Fritz-Arnold-Str. 7",
      postalCode: "78467",
      addressLocality: "Konstanz",
      addressCountry: "DE",
    });
    expect(ld.telephone).toBe("+4975313699591");
    expect(ld.email).toBe("info@example.de");
    expect(ld.openingHoursSpecification).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Tuesday",
        opens: "11:30",
        closes: "14:30",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Tuesday",
        opens: "17:00",
        closes: "22:00",
      },
    ]);
    expect(ld.image).toEqual([
      "https://example.de/img/t%2Fuploads%2Fbanner?w=1280",
      "https://example.de/img/t%2Fuploads%2Flogo?w=1280",
    ]);
    expect(ld.logo).toBe("https://example.de/img/t%2Fuploads%2Flogo?w=640");
    expect(ld.hasMap).toBe("https://www.google.com/maps/place/?q=place_id:ChIJabc");
  });

  it("emits no local-business fields the owner has not filled", () => {
    const ld = buildRestaurantJsonLd(fixture, { pageUrl: "https://example.com/en" });
    for (const k of [
      "address",
      "telephone",
      "email",
      "openingHoursSpecification",
      "image",
      "logo",
      "hasMap",
    ]) {
      expect(k in ld, k).toBe(false);
    }
  });
});

describe("postalAddressNode", () => {
  it("keeps a one-line address as the street line", () => {
    expect(postalAddressNode("Marktstätte 1", "Europe/Zurich")).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Marktstätte 1",
    });
  });
  it("is null for an empty address", () => {
    expect(postalAddressNode(null, "Europe/Berlin")).toBeNull();
    expect(postalAddressNode(" \n ", "Europe/Berlin")).toBeNull();
  });
});
