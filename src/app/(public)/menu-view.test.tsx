import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuView } from "./menu-view";

// Ordering fully enabled — most assertions exercise the cart-enabled render.
const ALL_MODES = {
  dineIn: true,
  takeaway: true,
  delivery: true,
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

  it("shows a filter-aware empty state when a filter narrows out every item", () => {
    const empty: PublicMenu = { ...fixture, categories: [] };
    const html = renderToStaticMarkup(<MenuView menu={empty} activeDiets={new Set(["halal"])} />);
    expect(html).toContain("No dishes match every diet");
  });
});
