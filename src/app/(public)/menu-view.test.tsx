import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuView } from "./menu-view";
import { MENU_COPY, menuCopy } from "@/lib/i18n/menu";
import { UI_LOCALES, dirFor } from "@/lib/locales";

// Ordering fully enabled — most assertions exercise the cart-enabled render.
const ALL_MODES = {
  dineIn: true,
  takeaway: true,
  delivery: true,
  reservations: true,
  deliveryAreas: [],
  acceptedPayments: [],
  deliveryZips: [],
  deliveryFeeCents: 0,
  deliveryMinCents: 0,
};
import type { PublicMenu } from "@/lib/public-menu";

const fixture: PublicMenu = {
  venue: {
    id: "v1",
    name: "Ristorante Volpe",
    slug: "ristorante-volpe",
    defaultLocale: "en-GB",
    enabledLocales: ["en-GB", "de"],
    currency: "EUR",
    timezone: "Europe/Berlin",
    hours: { configured: false, days: {} },
    branding: { primaryColor: "#1f3b2e" },
  },
  locale: "en-GB",
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
          traces: ["nuts"],
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

describe("MenuView", () => {
  it("renders venue name, category, item with localised price and allergen badges", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(html).toContain("Ristorante Volpe");
    expect(html).toContain("Mains");
    expect(html).toContain("Wild mushroom risotto");
    expect(html).toContain("aged parmesan, thyme");
    // Price uses en-GB EUR — "€18.00" (with or without a narrow no-break space).
    expect(html).toMatch(/€\s*18\.00/);
    // Variant delta: "+€5.00"
    expect(html).toMatch(/\+€\s*5\.00/);
    // Allergen dialog trigger (contents open client-side in a portal)
    expect(html).toContain("Allergen information");
    expect(html).toContain("⚠");
    // Dietary icon with sr-only label
    expect(html).toContain("🥬");
    expect(html).toContain("Vegetarian");
  });

  it("uses the venue's primary colour on the venue heading via style attribute", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    // Style attribute value is HTML-escaped; look for the hex + `color:` marker
    // in the string. We inline colours because we want zero-JS + no runtime
    // CSS variable resolution needed by the parser.
    expect(html).toMatch(/color:\s*(#1f3b2e|rgb\(31,\s*59,\s*46\))/i);
  });

  it("shows the DRAFT PREVIEW banner only when isPreview is true", () => {
    const previewHtml = renderToStaticMarkup(<MenuView menu={{ ...fixture, isPreview: true }} />);
    expect(previewHtml).toContain("Draft preview");
    const publicHtml = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(publicHtml).not.toContain("Draft preview");
  });

  it("marks unavailable items visually and keeps them in the list", () => {
    const menuWithUnavailable: PublicMenu = {
      ...fixture,
      categories: [
        {
          ...fixture.categories[0]!,
          items: [{ ...fixture.categories[0]!.items[0]!, isAvailable: false }],
        },
      ],
    };
    const html = renderToStaticMarkup(<MenuView menu={menuWithUnavailable} />);
    expect(html).toContain("unavailable");
    expect(html).toContain("Wild mushroom risotto"); // still rendered
  });

  it("renders semantic landmarks: main, h1, section, h2, article, h3", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(html).toContain("<main");
    expect(html).toContain("<h1");
    expect(html).toContain("<section");
    expect(html).toContain("<h2");
    expect(html).toContain("<article");
    expect(html).toContain("<h3");
  });

  it("renders empty-menu state without crashing", () => {
    const empty: PublicMenu = { ...fixture, categories: [] };
    const html = renderToStaticMarkup(<MenuView menu={empty} />);
    expect(html).toContain("Nothing on the menu yet");
  });

  it("embeds a schema.org JSON-LD script whose payload parses to a Restaurant node", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(html).toContain('<script type="application/ld+json">');
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]!) as Record<string, unknown>;
    expect(parsed["@type"]).toBe("Restaurant");
    expect(parsed.name).toBe("Ristorante Volpe");
    const menu = parsed.hasMenu as Record<string, unknown>;
    expect(menu["@type"]).toBe("Menu");
    const sections = menu.hasMenuSection as Record<string, unknown>[];
    expect(sections[0]!.name).toBe("Mains");
  });

  it("renders diet-filter tabs as anchor links with the correct query-string", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    // Tab-based UI: each diet is an anchor whose href appends `?diet=<value>`
    // to the venue's slug. No JS required — the anchor is the whole state.
    for (const d of ["vegetarian", "vegan", "gluten_free", "dairy_free"]) {
      expect(html).toMatch(new RegExp(`href="/[^"]*\\?diet=${d}"`));
    }
    // "All diets" tab points at the root menu (no diet query) and is
    // marked current — attribute order varies between <a> and next/link.
    expect(html).toMatch(/<a(?=[^>]*aria-current="page")(?=[^>]*href="\/")[^>]*>/);
  });

  it("marks the active diet tab with aria-current", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} activeDiets={new Set(["vegan"])} />);
    const veganTab = html.match(/<a[^>]*href="[^"]*\?diet=vegan"[^>]*>/);
    expect(veganTab?.[0]).toMatch(/aria-current="page"/);
    // Non-active tabs must NOT carry aria-current.
    const glutenTab = html.match(/<a[^>]*href="[^"]*\?diet=gluten_free"[^>]*>/);
    expect(glutenTab?.[0]).not.toMatch(/aria-current/);
  });

  it("renders category tabs when the venue has more than one category", () => {
    const twoCats: PublicMenu = {
      ...fixture,
      categories: [fixture.categories[0]!, { id: "c2", name: "Starters", items: [] }],
    };
    const html = renderToStaticMarkup(
      <MenuView
        menu={twoCats}
        allCategories={twoCats.categories.map((c) => ({ id: c.id, name: c.name }))}
      />,
    );
    // "All" tab points at the root menu (no cat filter)
    expect(html).toMatch(/href="\/"/);
    // Category links carry the human slug, not the database id.
    expect(html).toMatch(/href="\/\?cat=mains"/);
    expect(html).toMatch(/href="\/\?cat=starters"/);
  });

  it("offers the halal filter only when the venue opts in", () => {
    const plain = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(plain).not.toMatch(/href="[^"]*\?diet=halal"/);

    const halalVenue = structuredClone(fixture);
    halalVenue.venue.branding.halalFilter = "on";
    const html = renderToStaticMarkup(<MenuView menu={halalVenue} />);
    expect(html).toMatch(/href="[^"]*\?diet=halal"/);
    expect(html).toContain("حلال");
  });

  it("keeps every dish rendered as a full-width card with a dish image", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    // No uploaded photo in the fixture → the renderer must fall back to
    // one of the styled defaults shipped in /public, never an empty box.
    expect(html).toMatch(/<img[^>]*src="\/dish_[1-5]_sq-320\.webp"/);
  });

  describe("mobile image weight", () => {
    it("does not download the desktop-only hero splash on a phone", () => {
      // burger-hub uses the "hero" layout; the splash photo needs a dish
      // with an uploaded image to appear at all.
      const hero = structuredClone(fixture);
      hero.venue.branding.theme = "burger-hub";
      hero.categories[0]!.items[0]!.photoKey = "tenant-1/uploads/hero-dish";
      const html = renderToStaticMarkup(<MenuView menu={hero} />);

      // The real photo is reachable only through a desktop-gated source…
      expect(html).toMatch(/<source[^>]*media="\(min-width: 768px\)"/);
      expect(html).toMatch(
        /<source[^>]*srcSet="[^"]*tenant-1%2Fuploads%2Fhero-dish[^"]*"|<source[^>]*srcset="[^"]*tenant-1%2Fuploads%2Fhero-dish[^"]*"/i,
      );
      // …and the img a phone actually loads is the inline pixel, so no
      // hero bytes cross the wire below 768px.
      expect(html).toContain(
        'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"',
      );
    });

    it("offers phone-sized renders of the full-bleed banner", () => {
      const banner = structuredClone(fixture);
      banner.venue.branding.bannerKey = "tenant-1/uploads/banner";
      const html = renderToStaticMarkup(<MenuView menu={banner} />);

      // Width descriptors + sizes, so a 390px phone takes the 640px
      // render rather than the 1920px desktop one.
      expect(html).toMatch(/sizes="100vw"/);
      for (const w of [640, 960, 1280, 1920]) {
        expect(html, `banner width ${w}`).toContain(`?w=${w} ${w}w`);
      }
    });
  });

  it("fresh-bistro theme switches to the centered grid layout", () => {
    const bistro = structuredClone(fixture);
    bistro.venue.branding.theme = "fresh-bistro";
    const html = renderToStaticMarkup(<MenuView menu={bistro} />);
    // Grid cards: 2-up on mobile scaling to 4-up on xl.
    expect(html).toMatch(/grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4/);
    // The editorial section number ("01") disappears in the grid layout.
    expect(html).not.toMatch(/>01</);
    // Every dish still renders (name + price present).
    expect(html).toContain("var(--menu-accent)");
  });

  it("list layout (royal-sapphire) renders food-card rows", () => {
    const royal = structuredClone(fixture);
    royal.venue.branding.theme = "royal-sapphire";
    const html = renderToStaticMarkup(<MenuView menu={royal} />);
    // Bounded portrait photo column on a surface card row.
    expect(html).toMatch(/aspect-square w-24 shrink-0 self-center/);
    expect(html).toMatch(/bg-\[var\(--menu-surface\)\]/);
    expect(html).not.toMatch(/>01</);
  });

  it("keeps the HTML weight of a very large menu inside the budget", async () => {
    // Regression tripwire for guest page weight: 400 dishes must stay
    // under 150 KB gzipped HTML (155 real dishes measure ~60 KB HTML-only;
    // the rest of the wire cost is React's RSC payload, tracked by
    // scripts/check-guest-bundle.ts on the built route).
    const { gzipSync } = await import("node:zlib");
    const big = structuredClone(fixture);
    const template = big.categories[0]!;
    big.categories = Array.from({ length: 20 }, (_, c) => ({
      ...structuredClone(template),
      id: `cat-${c}`,
      name: `Category ${c}`,
      items: Array.from({ length: 20 }, (_, i) => ({
        ...structuredClone(template.items[0]!),
        id: `item-${c}-${i}`,
        name: `Dish ${c}-${i} with a realistically long name`,
        description: "A realistically long description of the dish with spices and sides.",
      })),
    }));
    const html = renderToStaticMarkup(<MenuView menu={big} orderingModes={ALL_MODES} />);
    const gz = gzipSync(Buffer.from(html)).length;
    expect(gz).toBeLessThan(150 * 1024);
  });

  it("every layout puts the price left of the add button in one action row", () => {
    for (const themeId of ["mughal-night", "fresh-bistro", "royal-sapphire", "trattoria-chalk"]) {
      const themed = structuredClone(fixture);
      themed.venue.branding.theme = themeId;
      const html = renderToStaticMarkup(<MenuView menu={themed} orderingModes={ALL_MODES} />);
      // Within each card the price <p> precedes the Add <button> in DOM
      // order inside a justify-between row.
      const row = html.match(
        /items-center justify-between[^>]*>[\s\S]*?aria-label="price"[\s\S]*?<button[^>]*aria-label="Add /,
      );
      expect(row, themeId).not.toBeNull();
    }
  });

  it("showcase layout (trattoria-chalk) renders round gallery photos and a price badge", () => {
    const chalk = structuredClone(fixture);
    chalk.venue.branding.theme = "trattoria-chalk";
    const html = renderToStaticMarkup(<MenuView menu={chalk} />);
    expect(html).toMatch(/rounded-full border-2/);
    // The price badge is an accent WASH now, not an accent outline — same
    // fill-not-border language as every other control on the guest surface.
    expect(html).toMatch(/bg-\[var\(--menu-surface-accent,var\(--menu-accent\)\)\]\/14 px-4 py-1/);
    expect(html).not.toMatch(/>01</);
  });

  it("renders an uploaded dish photo through the /img resize route", () => {
    const withPhoto = structuredClone(fixture);
    withPhoto.categories[0]!.items[0]!.photoKey = "tenant-a/uploads/abc";
    const html = renderToStaticMarkup(<MenuView menu={withPhoto} />);
    expect(html).toContain(`/img/${encodeURIComponent("tenant-a/uploads/abc")}?w=480`);
  });

  it("locale switcher renders an anchor per enabled locale, current one plain-text", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    // Current locale (en-GB) is a span, not a link; the alternate (de) is an anchor.
    expect(html).toMatch(/aria-current="true"/);
    expect(html).toMatch(/<a[^>]*href="\/de"[^>]*hrefLang="de"/i);
  });

  it("locale switcher is hidden when the venue has only one enabled locale", () => {
    const single: PublicMenu = {
      ...fixture,
      venue: { ...fixture.venue, enabledLocales: ["en-GB"] },
    };
    const html = renderToStaticMarkup(<MenuView menu={single} />);
    expect(html).not.toContain('aria-label="Language"');
  });

  it("footer payment strip shows the Stripe card brands once card payment is live", () => {
    const html = renderToStaticMarkup(
      <MenuView menu={fixture} orderingModes={ALL_MODES} onlinePayment paypalPayment />,
    );
    expect(html).toContain("Accepted payments");
    expect(html).toContain("/brand/pay/visa.svg");
    expect(html).toContain("/brand/pay/mastercard.svg");
    expect(html).toContain("/brand/pay/amex.svg");
    expect(html).toContain("/brand/pay/paypal.svg");
  });

  it("footer payment strip stays off when nothing is accepted", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} orderingModes={ALL_MODES} />);
    expect(html).not.toContain("Accepted payments");
  });

  it("shows a filter-aware empty state when a filter narrows out every item", () => {
    const empty: PublicMenu = { ...fixture, categories: [] };
    const html = renderToStaticMarkup(<MenuView menu={empty} activeDiets={new Set(["halal"])} />);
    expect(html).toContain("No dishes match every diet");
  });
});

/* ------------------------------------------------------------------ */
/* Offers as a destination (P7-12)                                     */
/* ------------------------------------------------------------------ */

/** The fixture plus a second category holding one discounted dish. */
function withOffer(): PublicMenu {
  const menu = structuredClone(fixture);
  menu.offerCount = 1;
  menu.categories.push({
    id: "c2",
    name: "Starters",
    items: [
      {
        ...structuredClone(fixture.categories[0]!.items[0]!),
        id: "i2",
        name: "Burrata",
        description: null,
        priceCents: 900,
        offer: { basePriceCents: 1400, endsAt: null },
        variants: [],
      },
    ],
  });
  return menu;
}

const ALL_CATS = (menu: PublicMenu): { id: string; name: string }[] =>
  menu.categories.map((c) => ({ id: c.id, name: c.name }));

describe("MenuView offers destination", () => {
  it("leads with a synthetic Offers section and an Offers tab", () => {
    const menu = withOffer();
    const html = renderToStaticMarkup(<MenuView menu={menu} allCategories={ALL_CATS(menu)} />);
    // The section exists, is first, and is addressable by the rail.
    expect(html).toContain('data-category-id="__offers"');
    expect(html.indexOf('data-category-id="__offers"')).toBeLessThan(
      html.indexOf('data-category-id="c1"'),
    );
    expect(html).toContain("Offers");
    expect(html).toContain("1 dish on offer");
    // The tab is an ordinary server link, ahead of the real categories.
    expect(html).toMatch(/href="\/\?cat=offers"/);
    expect(html.indexOf('href="/?cat=offers"')).toBeLessThan(html.indexOf('href="/?cat=mains"'));
    // The dish is listed twice — once under Offers, once in its own
    // category — but each copy carries its own heading id, so no
    // aria-labelledby ever resolves to two elements.
    expect(html.match(/>Burrata</g)?.length).toBe(2);
    expect(html.match(/id="offer-item-i2"/g)?.length).toBe(1);
    expect(html.match(/id="item-i2"/g)?.length).toBe(1);
  });

  it("renders nothing about offers when no dish has one", () => {
    const html = renderToStaticMarkup(
      <MenuView menu={fixture} allCategories={ALL_CATS(fixture)} />,
    );
    expect(html).not.toContain("__offers");
    expect(html).not.toContain("cat=offers");
    expect(html).not.toContain("dish on offer");
  });

  it("?cat=offers filters to the offers section on the server (no JS needed)", () => {
    const menu = withOffer();
    const html = renderToStaticMarkup(
      <MenuView menu={menu} allCategories={ALL_CATS(menu)} activeCategoryId="__offers" />,
    );
    // Real categories arrive hidden; the offers section does not.
    expect(html).toMatch(/data-category-id="c1" hidden/);
    expect(html).toMatch(/data-category-id="c2" hidden/);
    expect(html).not.toMatch(/data-category-id="__offers" hidden/);
    // The diet tabs keep the destination in their hrefs.
    expect(html).toContain('href="/?cat=offers&amp;diet=vegan"');
  });

  it("degrades a stale ?cat=offers to the whole menu when nothing is on offer", () => {
    const html = renderToStaticMarkup(
      <MenuView menu={fixture} allCategories={ALL_CATS(fixture)} activeCategoryId="__offers" />,
    );
    expect(html).not.toMatch(/data-category-id="c1" hidden/);
    expect(html).toContain("Wild mushroom risotto");
  });

  it("translates the destination — German says Angebote", () => {
    const menu = { ...withOffer(), locale: "de" };
    const html = renderToStaticMarkup(<MenuView menu={menu} allCategories={ALL_CATS(menu)} />);
    expect(html).toContain("Angebote");
    expect(html).toContain("1 Gericht im Angebot");
    expect(html).not.toContain(">Offers<");
  });
});

/* ------------------------------------------------------------------ */
/* Guest localisation                                                  */
/* ------------------------------------------------------------------ */

/** The fixture is en-GB; these swap the locale the way the `/{locale}`
 *  route does — `menu.locale` plus the venue's enabled list. */
function localised(locale: string): PublicMenu {
  return {
    ...fixture,
    locale,
    venue: { ...fixture.venue, enabledLocales: ["en-GB", "de", "es", "it", "ar"] },
  };
}

describe("MenuView localisation", () => {
  it("renders Spanish chrome on /es", () => {
    const html = renderToStaticMarkup(
      <MenuView menu={localised("es")} orderingModes={ALL_MODES} onlinePayment />,
    );
    expect(html).toContain("Pagos aceptados");
    expect(html).toContain("Todas las dietas");
    expect(html).toContain("Vegetariano");
    expect(html).toContain("Información de alérgenos");
    // Prices follow the locale too: es-ES puts the symbol last.
    expect(html).toMatch(/18,00\s*€/);
  });

  it("renders Italian chrome on /it", () => {
    const html = renderToStaticMarkup(<MenuView menu={localised("it")} />);
    expect(html).toContain("Tutte le diete");
    expect(html).toContain("Informazioni sugli allergeni");
    expect(html).toContain('aria-label="Lingua"');
  });

  it("renders Arabic chrome on /ar", () => {
    const html = renderToStaticMarkup(<MenuView menu={localised("ar")} />);
    expect(html).toContain('aria-label="اللغة"'); // footer language switcher
    expect(html).toContain("كل الأنظمة الغذائية"); // "all diets"
    expect(html).toContain("معلومات مسبّبات الحساسية"); // allergen dialog trigger
    // No English chrome leaked through.
    expect(html).not.toContain("All diets");
  });

  it("German menu keeps the formal register", () => {
    const html = renderToStaticMarkup(<MenuView menu={localised("de")} />);
    expect(html).toContain("Alle Ernährungsformen");
    expect(html).toContain("Allergeninformationen");
  });

  it("falls back to English chrome for a venue locale without a catalogue", () => {
    // `fr` is a venue locale with no guest-copy catalogue (locales.ts).
    const html = renderToStaticMarkup(<MenuView menu={localised("fr")} />);
    expect(html).toContain("All diets");
  });

  it("keeps the diet filter when the guest switches language", () => {
    const html = renderToStaticMarkup(
      <MenuView menu={localised("en-GB")} activeDiets={new Set(["vegan"])} />,
    );
    expect(html).toMatch(/<a[^>]*href="\/es\?diet=vegan"/);
  });

  it("labels the diet rail with a data attribute, not a translated aria-label", () => {
    // category-tabs.tsx rewrites these hrefs through `nav[data-diet-filter]`;
    // keying on the aria-label would break the moment it is translated.
    const html = renderToStaticMarkup(<MenuView menu={localised("ar")} />);
    expect(html).toContain("data-diet-filter");
  });
});

describe("MENU_COPY", () => {
  it("resolves every UI locale, including region tags and unknown codes", () => {
    expect(UI_LOCALES).toEqual(["en", "de", "it", "es", "ar"]);
    for (const l of UI_LOCALES) expect(menuCopy(l)).toBe(MENU_COPY[l]);
    expect(menuCopy("en-GB")).toBe(MENU_COPY.en);
    expect(menuCopy("ar-EG")).toBe(MENU_COPY.ar);
    expect(menuCopy("fr")).toBe(MENU_COPY.en);
    expect(menuCopy(null)).toBe(MENU_COPY.en);
  });

  it("has a non-empty value for every key in every locale", () => {
    // The `Record<UiLocale, MenuCopy>` type already enforces the SHAPE;
    // this catches a key left as "" or a function returning nothing.
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        expect(value.trim(), `${path} is blank`).not.toBe("");
        return;
      }
      if (typeof value === "function") {
        // Every interpolating key takes strings and/or numbers; 2 is a
        // plural-safe count and "x" a stand-in for a name or a time.
        const arity = (value as (...a: unknown[]) => string).length;
        const args = Array.from({ length: arity }, () =>
          path.match(/count|Level|spicy/i) ? 2 : "x",
        );
        const out = (value as (...a: unknown[]) => string)(...args);
        expect(typeof out, `${path} did not return a string`).toBe("string");
        expect(out.trim(), `${path} returned blank`).not.toBe("");
        return;
      }
      if (Array.isArray(value)) {
        expect(value.length, `${path} is empty`).toBeGreaterThan(0);
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, `${path}.${k}`);
      }
    };
    for (const locale of UI_LOCALES) walk(MENU_COPY[locale], locale);
  });

  it("counts every locale as right-to-left only where it is", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("ar-EG")).toBe("rtl");
    expect(dirFor("de")).toBe("ltr");
    expect(dirFor("en-GB")).toBe("ltr");
    expect(dirFor(undefined)).toBe("ltr");
  });

  it("gives each locale its own copy — no English left in a translation", () => {
    for (const locale of UI_LOCALES) {
      if (locale === "en") continue;
      expect(MENU_COPY[locale].nav.allDiets, locale).not.toBe(MENU_COPY.en.nav.allDiets);
      expect(MENU_COPY[locale].allergens.contains, locale).not.toBe(
        MENU_COPY.en.allergens.contains,
      );
    }
  });
});
