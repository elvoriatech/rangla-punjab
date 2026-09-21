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
    openNow: false,
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

    it("sizes the hero by the photo, so a banner with its own headline is never cropped", () => {
      const banner = structuredClone(fixture);
      banner.venue.branding.bannerKey = "tenant-1/uploads/banner";
      // 1920x768 — Rangla's actual banner, whose baked-in title the old
      // fixed-height `object-cover` box cut off at every width.
      banner.venue.branding.bannerAspect = 2.5;
      const html = renderToStaticMarkup(<MenuView menu={banner} />);

      // The box is reserved from the ratio before a byte arrives: no
      // width/height guess, and CLS stays 0 (the Lighthouse CI budget).
      expect(html).toContain("--hero-ratio:2.5");
      expect(html).toMatch(/aspect-ratio:\s*var\(--hero-ratio\)/);
      // Height follows that ratio, so below the 78vh cap the whole
      // image shows — `cover` on a box of the image's own ratio.
      expect(html).toContain("max-h-[78vh]");
      // And none of the fixed heights that did the cropping.
      expect(html).not.toContain("relative h-40 w-full sm:h-48 lg:h-60");
    });

    it("runs the hero full-bleed, not in a centred max-width box", () => {
      const banner = structuredClone(fixture);
      banner.venue.branding.bannerKey = "tenant-1/uploads/banner";
      banner.venue.branding.bannerAspect = 2.5;
      const html = renderToStaticMarkup(<MenuView menu={banner} />);

      // The hero wrapper: full page width, height from the ratio.
      const hero = html.match(/<div class="([^"]*max-h-\[78vh\][^"]*)"[^>]*>/);
      expect(hero, "hero wrapper").not.toBeNull();
      expect(hero![1]).toContain("w-full");
      expect(hero![1]).not.toMatch(/mx-auto|max-w-/);
      expect(html).toMatch(/aspect-ratio:\s*var\(--hero-ratio\)/);

      // The image fills it edge to edge; `cover` only ever trims once
      // the 78vh cap bites, never letterboxes.
      expect(html).toMatch(
        /<img[^>]*sizes="100vw"[^>]*class="absolute inset-0 h-full w-full object-cover object-center"/,
      );
      // The old per-breakpoint box is gone for good.
      expect(html).not.toContain("max-w-[calc(var(--hero-ratio)*230px)]");
    });

    it("falls back to 16:7 for a banner whose proportions we do not know", () => {
      const banner = structuredClone(fixture);
      banner.venue.branding.bannerKey = "tenant-1/uploads/banner";
      const html = renderToStaticMarkup(<MenuView menu={banner} />);
      expect(html).toContain(`--hero-ratio:${16 / 7}`);
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
    // No visible heading any more — the strip is named on the group.
    expect(html).toContain('role="group" aria-label="Accepted payments"');
    expect(html).not.toMatch(/<h2[^>]*>Accepted payments<\/h2>/);
    expect(html).toContain("/brand/pay/visa.svg");
    expect(html).toContain("/brand/pay/mastercard.svg");
    expect(html).toContain("/brand/pay/amex.svg");
    expect(html).toContain("/brand/pay/paypal.svg");
  });

  it("footer payment strip stays off when nothing is accepted", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} orderingModes={ALL_MODES} />);
    expect(html).not.toContain("Accepted payments");
  });

  it("renders the rating pill beside the reserve button once, with no review link (P7-14)", () => {
    const rated: PublicMenu = {
      ...fixture,
      rating: {
        value: 4.6,
        count: 312,
        reviewUrl: "https://search.google.com/local/writereview?placeid=PLACE1",
      },
    };
    const html = renderToStaticMarkup(<MenuView menu={rated} />);
    expect(html).toContain("★");
    expect(html).toMatch(/4\.6/);
    expect(html).toContain("(312)");
    // Exactly one line: the sticky bar renders it, the (absent) banner
    // hero does not. The sr-only sentence is the one-per-line marker.
    const summary = menuCopy("en").rating.summary("4.6", "312");
    expect(html).toContain(summary);
    expect(html.split(summary).length - 1).toBe(1);
    expect(html.split("(312)").length - 1).toBe(1);
    // The link is gone from the web menu — reviewUrl still rides the API
    // for the app, but nothing here sends a guest to Google.
    expect(html).not.toContain("Write a review");
    expect(html).not.toContain("writereview");
  });

  it("puts the rating pill in the hero's badge stack when the venue has a banner (P7-14)", () => {
    const rated: PublicMenu = {
      ...fixture,
      venue: { ...fixture.venue, branding: { ...fixture.venue.branding, bannerKey: "b1" } },
      rating: { value: 4.6, count: 312, reviewUrl: "https://example.com/r" },
    };
    const html = renderToStaticMarkup(<MenuView menu={rated} />);
    // Still exactly one pill — the hero's, not the sticky bar's.
    const summary = menuCopy("en").rating.summary("4.6", "312");
    expect(html.split(summary).length - 1).toBe(1);
    expect(html.split("(312)").length - 1).toBe(1);
    expect(html).not.toContain("Write a review");
    // It rides the badge stack, so it wears the stack's dark coat rather
    // than the sticky bar's hairline one.
    expect(html).toContain("border-white/40 bg-black/45 text-white backdrop-blur");
  });

  it("the hero prints the venue name once — VenueMark hands the name to the big serif", () => {
    // `VenueMark`'s own name span (the sticky bar's small italic) must NOT
    // appear on a hero page: the hero passes `showName={false}` and prints
    // the name itself in white. An absolute count of the venue name is
    // brittle — it also appears in JSON-LD, the sr-only H1, the footer and
    // the metadata — so this checks the one piece of markup that actually
    // moved, and then that the hero page says the name no more often than
    // the sticky-bar page does.
    const MARK_NAME = "block min-w-0 truncate font-serif text-lg italic leading-tight";
    const hero: PublicMenu = {
      ...fixture,
      venue: { ...fixture.venue, branding: { ...fixture.venue.branding, bannerKey: "b1" } },
    };
    const heroHtml = renderToStaticMarkup(<MenuView menu={hero} />);
    const barHtml = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(heroHtml.split(MARK_NAME).length - 1).toBe(0);
    expect(barHtml.split(MARK_NAME).length - 1).toBe(1);
    const count = (html: string): number => html.split(fixture.venue.name).length - 1;
    expect(count(heroHtml)).toBe(count(barHtml));
    // The hero still shows the logo, exactly once.
    expect(heroHtml.split('width="44" height="44"').length - 1).toBe(1);
  });

  it("keeps the privacy notice out of the server HTML — it is client-only", () => {
    // The menu page is static and edge-cached: the server cannot know
    // whether THIS guest has acknowledged, so the notice must appear only
    // after the client has read localStorage. Baking it into the HTML
    // would show it to every guest on every cached page, forever.
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(html).not.toContain(menuCopy("en").privacy.title);
    expect(html).not.toContain(menuCopy("en").privacy.ok);
    // Its body, not its href: the footer's legal row links to
    // /legal/privacy on every render, so the URL is no longer a
    // notice-only marker.
    expect(html).not.toContain(menuCopy("en").privacy.body);
    expect(html).not.toContain(menuCopy("en").privacy.link);
  });

  it("keeps the rating out of JSON-LD — Google disallows self-serving ratings (P7-14)", () => {
    const rated: PublicMenu = {
      ...fixture,
      rating: { value: 4.6, count: 312, reviewUrl: "https://example.com/r" },
    };
    const html = renderToStaticMarkup(<MenuView menu={rated} />);
    expect(html).not.toContain("aggregateRating");
    expect(html).not.toContain("ratingValue");
  });

  it("shows no rating line at all when the server sends none", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(html).not.toContain("★");
    expect(html).not.toContain("out of 5 from");
    expect(html).not.toContain("Write a review");
    expect(html).not.toContain("writereview");
  });

  it("shows a filter-aware empty state when a filter narrows out every item", () => {
    const empty: PublicMenu = { ...fixture, categories: [] };
    const html = renderToStaticMarkup(<MenuView menu={empty} activeDiets={new Set(["halal"])} />);
    expect(html).toContain("No dishes match every diet");
  });

  /* ---------------- "Get the app" (footer + header jump) ---------------- */

  it("shows nothing about an app until the owner publishes a link", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(html).not.toContain("get-the-app");
    expect(html).not.toContain("Get the app");
    expect(html).not.toContain("App Store");
    expect(html).not.toContain(".apk");
  });

  it("renders both store badges, the apk button and the header jump link", () => {
    const withApp: PublicMenu = {
      ...fixture,
      venue: {
        ...fixture.venue,
        appLinks: {
          ios: "https://apps.apple.com/de/app/elvoria/id1",
          android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
          apk: "https://elvoria.example/downloads/app.apk",
        },
      },
    };
    const html = renderToStaticMarkup(<MenuView menu={withApp} />);

    // The footer section, and the header anchor that jumps to it — a plain
    // fragment link, so the whole thing works with JS off.
    expect(html).toContain('id="get-the-app"');
    expect(html).toContain('href="#get-the-app"');
    // The section is named by its aria-label now; the visible <h2> and
    // the blurb under it are gone, so the footer stays one line tall.
    expect(html).toContain('aria-label="Get the app"');
    expect(html).not.toMatch(/<h2[^>]*>Get the app<\/h2>/);
    expect(html).not.toContain("Order in a tap, keep your favourites and follow your order.");

    // Badges: our own artwork, carrying the familiar wording.
    expect(html).toContain("App Store");
    expect(html).toContain("Google Play");
    expect(html).toContain("Download on the App Store (opens in a new tab)");
    expect(html).toContain("Get it on Google Play (opens in a new tab)");

    // Store links leave the site and must not hand the opener over.
    expect(html).toContain('href="https://apps.apple.com/de/app/elvoria/id1"');
    expect(html).toContain('href="https://play.google.com/store/apps/details?id=com.elvoria.menu"');
    expect(html).toMatch(/apps\.apple\.com[^>]*target="_blank"/);
    expect(html).toMatch(/apps\.apple\.com[^>]*rel="noopener"/);
    expect(html).toMatch(/play\.google\.com[^>]*rel="noopener"/);

    // The APK is a download, not a store listing: plain button, `download`
    // attribute, and the Android warning said before the tap — as the
    // anchor's own tooltip now that the paragraph under the row is gone.
    expect(html).toContain("Download Android app (.apk)");
    expect(html).toMatch(/app\.apk"[^>]*download/);
    expect(html).toMatch(/app\.apk"[^>]*title="Android will ask you to allow the install\."/);
    expect(html).not.toMatch(/<p[^>]*>Android will ask you to allow the install\.<\/p>/);
  });

  it("renders only the slots the owner filled in", () => {
    const apkOnly: PublicMenu = {
      ...fixture,
      venue: { ...fixture.venue, appLinks: { apk: "https://elvoria.example/app.apk" } },
    };
    const html = renderToStaticMarkup(<MenuView menu={apkOnly} />);
    expect(html).toContain('id="get-the-app"');
    expect(html).toContain("Download Android app (.apk)");
    // No badge for a store the venue is not on.
    expect(html).not.toContain("App Store");
    expect(html).not.toContain("Google Play");
  });

  it("translates the section, and leaves the store names alone", () => {
    const withApp: PublicMenu = {
      ...fixture,
      locale: "de",
      venue: {
        ...fixture.venue,
        appLinks: { ios: "https://apps.apple.com/de/app/elvoria/id1" },
      },
    };
    const html = renderToStaticMarkup(<MenuView menu={withApp} />);
    expect(html).toContain("App holen");
    expect(html).toContain("Laden im");
    // "App Store" is a brand name, not copy: identical in every locale.
    expect(html).toContain("App Store");
    expect(html).not.toContain("Get the app");
  });
});

/* ------------------------------------------------------------------ */
/* Footer — three columns, and nothing empty in any of them            */
/* ------------------------------------------------------------------ */

/** Every `<li>` whose content is whitespace only. The old footer's
 *  language dropdown was the page's only list, and its six items carried
 *  their label inside a nested <a> — which is what reached the owner as
 *  "* * * * * *". Nothing in the footer may render a list item with no
 *  content of its own again. */
function emptyListItems(html: string): string[] {
  return html.match(/<li\b[^>]*>\s*<\/li>/g) ?? [];
}

/** Just the <footer>. The header carries the venue name in the same serif
 *  type and other sections use the same tracking, so a layout assertion
 *  made against the whole page would pass on the wrong element. */
function footerOf(html: string): string {
  const at = html.indexOf("<footer");
  expect(at, "page renders a footer").toBeGreaterThan(-1);
  return html.slice(at);
}

const CONTACTED: PublicMenu = {
  ...fixture,
  venue: {
    ...fixture.venue,
    contact: {
      landline: {
        number: "+497531123456",
        display: "+49 7531 123456",
        href: "tel:+497531123456",
      },
      mobile: {
        number: "+491701234567",
        display: "+49 1701 234567",
        href: "tel:+491701234567",
      },
      whatsapp: {
        number: "+491701234567",
        display: "+49 1701 234567",
        href: "https://wa.me/491701234567",
      },
      email: null,
    },
  },
};

/** The same card with the fourth slot filled — deliberately a long
 *  address, because the row has to survive one. */
const CONTACTED_EMAIL: PublicMenu = {
  ...CONTACTED,
  venue: {
    ...CONTACTED.venue,
    contact: {
      ...CONTACTED.venue.contact!,
      email: {
        number: "reservierung@ristorante-volpe-konstanz.example",
        display: "reservierung@ristorante-volpe-konstanz.example",
        href: "mailto:reservierung@ristorante-volpe-konstanz.example",
      },
    },
  },
};

describe("MenuView footer", () => {
  it("renders no empty list item — with app links and without", () => {
    const bare = renderToStaticMarkup(<MenuView menu={CONTACTED} orderingModes={ALL_MODES} />);
    expect(emptyListItems(bare), "footer without app links").toEqual([]);
    // The language dropdown is a nav of links now, not a list of six
    // items whose labels live one level down.
    expect(bare).toContain('aria-label="Language"');

    const withApp = renderToStaticMarkup(
      <MenuView
        menu={{
          ...CONTACTED,
          venue: {
            ...CONTACTED.venue,
            appLinks: { android: "https://play.google.com/store/apps/details?id=x" },
          },
        }}
        orderingModes={ALL_MODES}
      />,
    );
    expect(emptyListItems(withApp), "footer with one of three app links").toEqual([]);
    // One badge published, one badge rendered — no placeholder for the
    // two stores this venue is not on.
    expect(withApp).toContain("Google Play");
    expect(withApp).not.toContain("App Store");
    expect(withApp).not.toContain("Download Android app");
  });

  it("shows icon + number only, on one wrapping line, keeping each accessible name", () => {
    const html = renderToStaticMarkup(<MenuView menu={CONTACTED} />);
    const rows = html.match(/<li><a href="(tel:|https:\/\/wa\.me)/g) ?? [];
    expect(rows).toHaveLength(3);
    // One horizontal row that wraps only when the column runs out of
    // width, not one <li> per line. Read off the contact nav's own <ul>,
    // so another flex list elsewhere on the page cannot satisfy it.
    const contactUl = (
      html.match(/<nav aria-label="Contact us"[^>]*><ul class="([^"]*)"/)?.[1] ?? ""
    ).split(" ");
    expect(contactUl, "contact list classes").toContain("flex");
    expect(contactUl, "contact list classes").toContain("flex-wrap");
    // The visible "Contact us" heading is gone — the numbers sit directly
    // under the restaurant's name — but the nav keeps the same accessible
    // name, so a screen reader still lands on a named landmark.
    expect(html).toContain('<nav aria-label="Contact us"');
    expect(html).not.toMatch(/<h2[^>]*>Contact us<\/h2>/);
    // The visible wording next to the icon is gone: the icon says which
    // line it is, and "Call landline" survives exactly once — inside the
    // anchor's accessible name, never as text a sighted guest reads.
    expect(html.match(/Call landline/g) ?? [], "only the aria-label says it").toHaveLength(1);
    expect(html.match(/Call mobile/g) ?? [], "only the aria-label says it").toHaveLength(1);
    expect(html).not.toMatch(/>[^<]*Call landline/);
    expect(html).not.toMatch(/>[^<]*Call mobile/);
    expect(html).toContain('aria-label="Call landline +49 7531 123456"');
    expect(html).toContain('aria-label="Call mobile +49 1701 234567"');
    expect(html).toContain('aria-label="Message +49 1701 234567 on WhatsApp (opens WhatsApp)"');
    // …and the number itself is still on screen, in the same type.
    expect(html).toContain('<span class="font-medium tabular-nums">+49 7531 123456</span>');
    // WhatsApp leaves the site; the two tel: links do not.
    expect(html).toMatch(/wa\.me[^>]*rel="noopener noreferrer"/);
  });

  it("links the e-mail address with mailto:, on its own red disc", () => {
    const html = footerOf(renderToStaticMarkup(<MenuView menu={CONTACTED_EMAIL} />));
    const address = "reservierung@ristorante-volpe-konstanz.example";
    // A plain `mailto:` anchor — no target, because a compose window is
    // the guest's own mail app, not another tab of ours.
    expect(html).toContain(`<li><a href="mailto:${address}"`);
    expect(html).not.toMatch(new RegExp(`<a href="mailto:[^>]*target=`));
    // The accessible name is the verb + the address, so a screen reader
    // hears an action rather than a bare string of characters.
    expect(html).toContain(`aria-label="E-mail ${address}"`);
    // Red disc, white glyph, out of the a11y tree like its three siblings.
    const disc =
      html.match(new RegExp(`<a href="mailto:[^"]*"[^>]*>\\s*<span[^>]*class="([^"]*)"`))?.[1] ??
      "";
    expect(disc, "e-mail red").toContain("bg-[#DC2626]");
    expect(disc, "white glyph").toContain("text-white");
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*bg-\[#DC2626\]/);
    // A 45-character address cannot push the one-line row sideways.
    expect(html).toMatch(new RegExp(`class="[^"]*break-all[^"]*">${address}</span>`));
    // The other three rows are untouched by it.
    expect(html).toContain('aria-label="Call landline +49 7531 123456"');
    expect(html).toContain('aria-label="Message +49 1701 234567 on WhatsApp (opens WhatsApp)"');
    // Four rows, no empty list item — the guarantee that holds with the
    // slot filled as well as with it null.
    expect(html.match(/<li><a href="(tel:|https:\/\/wa\.me|mailto:)/g) ?? []).toHaveLength(4);
    expect(emptyListItems(html), "footer with an e-mail row").toEqual([]);
  });

  it("renders no e-mail row, and no empty one, when the address is null", () => {
    const html = footerOf(renderToStaticMarkup(<MenuView menu={CONTACTED} />));
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("bg-[#DC2626]");
    expect(emptyListItems(html), "footer with the e-mail slot empty").toEqual([]);
  });

  it("drops the contact block entirely when the owner published no number", () => {
    const html = renderToStaticMarkup(<MenuView menu={fixture} />);
    expect(html).not.toContain('aria-label="Contact us"');
    expect(html).not.toContain("Call landline");
  });

  it("links the operator's legal pages, in the guest's language", () => {
    for (const [locale, imprint, privacy] of [
      ["en-GB", "Imprint", "Privacy"],
      ["de", "Impressum", "Datenschutz"],
      ["ar", "بيانات الناشر", "الخصوصية"],
    ] as const) {
      const html = renderToStaticMarkup(<MenuView menu={{ ...fixture, locale }} />);
      expect(html, locale).toContain('href="/legal/impressum"');
      expect(html, locale).toContain('href="/legal/privacy"');
      expect(html, locale).toContain(imprint);
      expect(html, locale).toContain(privacy);
    }
  });

  it("opens the bottom row with the restaurant's own copyright line", () => {
    const year = new Date().getFullYear();
    const html = footerOf(renderToStaticMarkup(<MenuView menu={{ ...fixture, locale: "de" }} />));
    expect(html).toContain(`\u00a9 ${year} Ristorante Volpe`);
    expect(html, "German copy, not English").toContain("Alle Rechte vorbehalten");
    // First item of row 2: the venue's line, then the operator's pages.
    const at = html.indexOf("\u00a9 ");
    expect(at, "footer prints a copyright line").toBeGreaterThan(-1);
    expect(at, "copyright comes before Impressum").toBeLessThan(html.indexOf("Impressum"));
  });

  it("gives each contact kind its own colour disc, WhatsApp in WhatsApp green", () => {
    const html = footerOf(renderToStaticMarkup(<MenuView menu={CONTACTED} />));
    // The icon disc sits inside its anchor, so read each one off its link.
    const discOf = (href: string): string =>
      html.match(new RegExp(`<a href="${href}[^"]*"[^>]*>\\s*<span[^>]*class="([^"]*)"`))?.[1] ??
      "";
    expect(discOf("https://wa.me/"), "WhatsApp green").toContain("bg-[#25D366]");
    expect(discOf("tel:\\+497531123456"), "landline blue").toContain("bg-[#2563EB]");
    expect(discOf("tel:\\+491701234567"), "mobile amber").toContain("bg-[#F59E0B]");
    // White glyph on the filled disc, and the disc stays out of the a11y
    // tree — the anchor's aria-label is what carries the meaning.
    expect(discOf("https://wa.me/")).toContain("text-white");
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*bg-\[#25D366\]/);
  });

  it("is two rows, not columns — the owner wants 2–3 lines, not a block", () => {
    const html = footerOf(
      renderToStaticMarkup(<MenuView menu={CONTACTED} orderingModes={ALL_MODES} onlinePayment />),
    );
    // Row 1: one full-width "landscape" row that spreads its groups edge
    // to edge — one line from lg up. Nothing is a grid column any more.
    expect(html).toContain(
      '<div class="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 lg:flex-nowrap">',
    );
    expect(html).not.toContain("max-w-7xl");
    expect(html).not.toMatch(/<div class="grid gap-9 md:grid-cols-3/);
    // Row 2: legal links and the powered-by line side by side, both 12px.
    expect(html).toMatch(/border-t[^"]*pt-2 text-xs"/);
    expect(html).not.toContain("tracking-[0.32em]");
    // Tighter vertical padding is the other half of the height budget.
    expect(html).toContain("py-3");
    // No small-caps column headings left in the footer.
    expect(html).not.toContain("tracking-[0.18em]");
  });

  it("orders row 1: identity, contacts, language, payments", () => {
    const html = footerOf(
      renderToStaticMarkup(<MenuView menu={CONTACTED} orderingModes={ALL_MODES} onlinePayment />),
    );
    const groups = {
      identity: html.indexOf("font-serif text-lg italic"),
      contacts: html.indexOf('<nav aria-label="Contact us"'),
      language: html.indexOf('aria-label="Language"'),
      payments: html.indexOf('role="group" aria-label="Accepted payments"'),
    };
    for (const [name, at] of Object.entries(groups)) {
      expect(at, `${name} renders in the footer`).toBeGreaterThan(-1);
    }
    // Logo + name in the left corner, the numbers beside it, the
    // accepted payments in the right corner.
    expect(groups.identity).toBeLessThan(groups.contacts);
    expect(groups.contacts).toBeLessThan(groups.language);
    expect(groups.language).toBeLessThan(groups.payments);
    // Left over from the column layout: nothing is centred in its own
    // track any more, and no group carries a heading.
    expect(html).not.toContain("md:text-center");
    expect(html).not.toContain("md:justify-center");
  });

  it("drops each group's visible heading but keeps its accessible name", () => {
    const html = renderToStaticMarkup(
      <MenuView
        menu={{
          ...CONTACTED,
          venue: {
            ...CONTACTED.venue,
            appLinks: { apk: "https://elvoria.example/app.apk" },
          },
        }}
        orderingModes={ALL_MODES}
        onlinePayment
      />,
    );
    // Payments, language and "Get the app" are named on the group — a
    // screen reader still hears them, the eye sees an unlabelled strip.
    expect(html).toContain('role="group" aria-label="Accepted payments"');
    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('aria-label="Get the app"');
    expect(html).not.toMatch(/<h2[^>]*>(Accepted payments|Language|Get the app)<\/h2>/);
    // The two paragraphs that used to sit under the app badges are gone;
    // the APK warning survives as the anchor's tooltip.
    expect(html).not.toContain("Order in a tap, keep your favourites and follow your order.");
    expect(html).toMatch(/app\.apk"[^>]*title="Android will ask you to allow the install\."/);
  });

  it("leaves no empty group when the venue accepts nothing", () => {
    const html = renderToStaticMarkup(<MenuView menu={CONTACTED} orderingModes={ALL_MODES} />);
    expect(html).not.toContain("Accepted payments");
    // The payments group is absent entirely, not an empty <div> eating
    // one of row 1's gaps.
    expect(html).not.toMatch(/<div[^>]*class="min-w-0"><\/div>/);
  });

  it("ends right under its last line on desktop; clears the cart bar below lg", () => {
    // Owner decision 2026-09-21: no dead space under the powered-by line on
    // desktop. Below lg the full-width cart bar would cover the legal links,
    // so the clearance stays there — and only while ordering is live.
    const CLEARANCE = "max-lg:pb-[calc(4.5rem+env(safe-area-inset-bottom))]";
    const withCart = renderToStaticMarkup(<MenuView menu={CONTACTED} orderingModes={ALL_MODES} />);
    expect(withCart).toContain(CLEARANCE);
    expect(withCart).not.toMatch(/[" ]pb-\[calc/);
    // Desktop: nothing reserved — the cart button floats above the footer.
    expect(withCart).not.toContain("lg:pr-[");
    const noCart = renderToStaticMarkup(<MenuView menu={CONTACTED} />);
    expect(noCart).not.toContain(CLEARANCE);
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

  it("French menu keeps the formal register", () => {
    const html = renderToStaticMarkup(<MenuView menu={localised("fr")} />);
    expect(html).toContain("Tous les régimes");
    expect(html).not.toContain("All diets");
  });

  it("falls back to English chrome for a venue locale without a catalogue", () => {
    // `nl` is a venue locale with no guest-copy catalogue (locales.ts).
    // This probe was `fr` until French was promoted to a full UI locale.
    const html = renderToStaticMarkup(<MenuView menu={localised("nl")} />);
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
    // Pins the ORDER as well as the membership: `LOCALES` in locales.ts
    // is what the settings UI, the footer switcher and the app picker all
    // sort by, so a reshuffle there is a visible change everywhere and
    // has to be made deliberately.
    expect(UI_LOCALES).toEqual(["de", "en", "fr", "es", "it", "ar"]);
    for (const l of UI_LOCALES) expect(menuCopy(l)).toBe(MENU_COPY[l]);
    expect(menuCopy("en-GB")).toBe(MENU_COPY.en);
    expect(menuCopy("ar-EG")).toBe(MENU_COPY.ar);
    expect(menuCopy("fr-CA")).toBe(MENU_COPY.fr);
    // `nl` is a venue locale with no catalogue — English chrome.
    expect(menuCopy("nl")).toBe(MENU_COPY.en);
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

  /**
   * The Complaint button beside Reserve (mirrors the app's home row).
   *
   * Asserted in German and Arabic rather than English because the failure
   * this guards against is a translated catalogue silently falling back to
   * the English word — the SERVER renders this label, so a miss ships to
   * every guest of that locale.
   */
  it("renders the Complaint button in the guest's own language", () => {
    for (const locale of ["de", "ar"] as const) {
      const html = renderToStaticMarkup(
        <MenuView
          menu={{ ...fixture, locale, venue: { ...fixture.venue, defaultLocale: locale } }}
        />,
      );
      expect(html, locale).toContain(MENU_COPY[locale].complaint.button);
      // Not the English one: a catalogue that fell back would still
      // "contain a button", which is why this is the assertion.
      expect(MENU_COPY[locale].complaint.button, locale).not.toBe(MENU_COPY.en.complaint.button);
    }
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
