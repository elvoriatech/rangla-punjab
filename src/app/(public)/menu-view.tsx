import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { ComplaintLink } from "./complaint-link";
import { ReserveDialog } from "./reserve-dialog";
import {
  formatPrice,
  offerItems,
  siteUrl,
  OFFERS_CATEGORY_ID,
  OFFERS_CATEGORY_SLUG,
  type PublicMenu,
} from "@/lib/public-menu";
import { buildRestaurantJsonLd, jsonLdString } from "@/lib/structured-data";
import { DIETARY_VALUES, HALAL_DIET, categorySlugs } from "@/lib/dietary-filter";
import { menuThemeStyle, resolveMenuTheme } from "@/lib/menu-themes";
import { categoryIcon } from "@/lib/category-icons";
import { menuImageSrcSet, menuImageUrl, TRANSPARENT_PIXEL } from "@/lib/menu-images";
import type { EffectiveOrdering } from "@/lib/ordering-config";
import type { LoyaltyConfig } from "@/lib/loyalty-config";
import type { OpeningHours, OpenState } from "@/lib/opening-hours";
import { acceptedPaymentIds, PaymentMarks } from "./payment-marks";
import { AppStoreBadge, GooglePlayBadge } from "./app-badges";
import { bannerSrcSet, uploadedImageUrl } from "@/lib/menu-images";
import { AddToOrderButton, type AddToOrderLabels } from "./order/add-button";
import { CartDrawer } from "./order/cart-lazy";
import { AllergenDialog, type AllergenLabels } from "./allergen-dialog";
import { DishDescription, type DishDescriptionLabels } from "./dish-description";
import type { ReserveLabels } from "./reserve-dialog";
import { CategoryLink, CategoryTabs as CategoryTabsClient, TabLink } from "./category-tabs";
import { PrivacyNotice } from "./privacy-notice";
import { checkoutCopy } from "@/lib/i18n/checkout";
import { menuCopy, type MenuCopy } from "@/lib/i18n/menu";
import { LOCALES, uiLocale } from "@/lib/locales";

/**
 * Public menu render — theme_one aesthetic (deep chocolate + gold),
 * full-width desktop layout, sticky top bar with venue mark + category
 * tabs + diet tabs, below that a wide grid of full-width dish cards
 * (photo left, name + description + allergens right, price on top-right).
 *
 * Everything zero-JS. Animations are CSS keyframes with
 * `prefers-reduced-motion` guards; tabs stay URL-driven so the URL is
 * the state and the back button works.
 *
 * Accessibility:
 *   - <main> + one <h1> for the venue + <section> per category
 *   - a labelled <nav> for the category rail and one for the diet rail
 *     land in the sticky top bar (labels come from the guest-copy
 *     catalogue, so behaviour never keys off them)
 *   - Tab links carry aria-current="page" on the active one
 *   - Dish placeholder image is aria-hidden — screen-readers get the
 *     name + description + allergens as-is
 *   - No focus-trap in a hidden form (the P1-25 axe gate caught the
 *     earlier aria-hidden-focus bug; the tab anchors are the whole
 *     filter surface today)
 */

/** Icon per offered diet. Halal's "icon" is the حلال word-mark — the
 *  closest thing to the certification logo that ships as text. Dish rows
 *  show ICONS ONLY; the label (from the guest-copy catalogue) survives as
 *  tooltip + sr-only text so nothing is lost for screen readers. */
const DIET_META: Record<string, { icon: string; crossed?: boolean }> = {
  vegan: { icon: "🌱" },
  vegetarian: { icon: "🥬" },
  gluten_free: { icon: "🌾", crossed: true },
  dairy_free: { icon: "🥛", crossed: true },
  halal: { icon: "حلال" },
  kosher: { icon: "✡" },
};

/* ------------------------------------------------------------------ */
/* Copy handed to client components                                     */
/* ------------------------------------------------------------------ */
/**
 * P7-16 — every client component under this page receives the handful of
 * WORDS it renders, already resolved for the guest's language, instead of
 * importing a catalogue itself. A `"use client"` import of
 * `@/lib/i18n/*` ships all five locales to every guest;
 * `scripts/check-guest-bundle.ts` fails the build if one leaks back in.
 *
 * These live at module scope (not threaded as props) because `menuCopy`
 * and `checkoutCopy` are plain record lookups — resolving per dish costs
 * nothing on the server and keeps the section components' signatures
 * unchanged.
 */
function dishLabels(locale: string, dishName: string): DishDescriptionLabels {
  const c = menuCopy(locale).dish;
  return { more: c.more, moreAbout: c.moreAbout(dishName), close: c.close };
}

function allergenLabels(locale: string, dishName: string): AllergenLabels {
  const c = menuCopy(locale).allergens;
  return {
    info: c.info,
    infoFor: c.infoFor(dishName),
    heading: c.heading,
    contains: c.contains,
    traces: c.traces,
    close: c.close,
  };
}

function addToOrderLabels(locale: string, dishName: string): AddToOrderLabels {
  const c = checkoutCopy(locale);
  return { add: c.add, added: c.added, addAria: c.addAria(dishName) };
}

/** Party sizes the reservation stepper can reach (mirrors MIN/MAX_GUESTS
 *  in `reserve-dialog.tsx` and the server's own 1–20 bound). */
const RESERVE_MAX_GUESTS = 20;

function reserveLabels(locale: string): ReserveLabels {
  const { guestCount, ...rest } = menuCopy(locale).reserve;
  return {
    ...rest,
    // Pre-rendered per party size: plural rules differ per language
    // (Arabic needs four forms), and 20 short strings in ONE language are
    // cheaper than shipping a plural engine plus five catalogues.
    guestCounts: Array.from({ length: RESERVE_MAX_GUESTS }, (_, i) => guestCount(i + 1)),
  };
}

/** Diet ids are plain strings on the wire (a venue could carry one the
 *  catalogue has not met); an unknown id degrades to its humanised key
 *  rather than vanishing from the filter rail. */
function dietLabel(t: MenuCopy, id: string): string {
  return (t.diets as Record<string, string | undefined>)[id] ?? id.replace(/_/g, " ");
}

/** "mon" → "Mon" / "Mo" / "الاثنين" without a weekday table per language:
 *  2024-01-07 is a Sunday, so day index 0..6 lands on that calendar week
 *  and `Intl` supplies the CLDR short name. */
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * DOM id for a dish heading. The synthetic Offers section (P7-12) repeats
 * dishes that also appear in their own category, so it renders them under
 * a prefix: `aria-labelledby` must never resolve to two elements.
 */
function dishHeadingId(itemId: string, idPrefix?: string): string {
  return `${idPrefix ?? ""}item-${itemId}`;
}

/** Glyph for the Offers tab when the venue shows category icons. */
const OFFERS_ICON = "🔥";

/* ------------------------------------------------------------------ */
/* Google rating (P7-14)                                               */
/* ------------------------------------------------------------------ */

/** "4.6" in the guest's language (a comma decimal in de/es/it). Always one
 *  decimal, so the line never jumps between "4" and "4.6" on a refresh. */
function formatRatingValue(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale || "en", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return value.toFixed(1);
  }
}

/** "1,204" / "1.204" / "١٬٢٠٤" — the review count, grouped per locale. */
function formatRatingCount(count: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale || "en").format(count);
  } catch {
    return String(count);
  }
}

/**
 * "★ 4.6 (312)" — the venue's Google rating, as a PILL in the page's
 * top-corner badge stack, directly under the "Reserve table" button
 * (P7-14). Server-rendered, zero JS, and absent entirely unless the server
 * actually has a rating: a venue whose owner has neither saved a Place ID
 * nor typed a rating by hand arrives here as `null` and renders nothing.
 *
 * It wears the same two coats as `AppJumpLink`, the badge it sits next to
 * — `onDark` (white-on-scrim, for the hero's photo) and the light variant
 * (hairline + page ink, for the sticky bar) — so the corner reads as one
 * row of badges rather than three unrelated chips.
 *
 * The figure alone, no "Write a review" link: the web menu is where a
 * guest orders food, and a link that takes them off it to Google's review
 * form belongs in the app instead. `rating.reviewUrl` is still carried by
 * the type and the API for exactly that reason — it is simply not
 * rendered here, which is also why this is a `<span>` and not an anchor.
 *
 * Accessibility: the star and the bracketed count are decoration and mean
 * nothing read aloud, so the visual run is `aria-hidden` and a screen
 * reader gets one plain sentence instead ("Rated 4.6 out of 5 from 312
 * Google reviews").
 *
 * Deliberately NOT mirrored into JSON-LD: Google's structured-data policy
 * forbids a site marking up third-party ratings of itself, so
 * `structured-data.ts` stays untouched.
 */
function RatingLine({
  rating,
  locale,
  t,
  onDark = false,
}: {
  rating: NonNullable<PublicMenu["rating"]>;
  locale: string;
  t: MenuCopy;
  /** The pill sits on the hero's photo scrim, where the theme's page ink
   *  has no contrast guarantee — white on a translucent black wash, like
   *  every other badge up there. */
  onDark?: boolean;
}): React.ReactElement {
  const value = formatRatingValue(rating.value, locale);
  const count = formatRatingCount(rating.count, locale);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
        onDark
          ? "border-white/40 bg-black/45 text-white backdrop-blur"
          : "border-[var(--menu-text)]/25 text-[var(--menu-text)]/85"
      }`}
    >
      <span aria-hidden="true">
        <span className="text-[var(--menu-accent)]">★</span> {value} ({count})
      </span>
      <span className="sr-only">{t.rating.summary(value, count)}</span>
    </span>
  );
}

/** `?cat=` value for a category id — the Offers destination is synthetic,
 *  so it carries a fixed slug instead of a name-derived one. */
function catSlug(slugs: Map<string, string>, id: string): string {
  return id === OFFERS_CATEGORY_ID ? OFFERS_CATEGORY_SLUG : (slugs.get(id) ?? id);
}

function shortWeekday(day: string, locale: string): string {
  const i = WEEKDAY_INDEX[day];
  if (i === undefined) return day;
  try {
    return new Intl.DateTimeFormat(locale || "en", {
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2024, 0, 7 + i)));
  } catch {
    return day;
  }
}

export function MenuView({
  menu,
  allCategories,
  activeDiets,
  activeCategoryId,
  orderingModes,
  onlinePayment,
  paypalPayment,
  loyalty,
  openNow,
  requestSlots,
  orderingPaused,
  reserve,
}: {
  menu: PublicMenu;
  allCategories?: { id: string; name: string }[];
  activeDiets?: Set<string>;
  activeCategoryId?: string | null;
  orderingModes?: EffectiveOrdering;
  onlinePayment?: boolean;
  paypalPayment?: boolean;
  /** Owner's loyalty switches — the cart's "earn N points" line. Absent
   *  or disabled and the guest hears nothing about points. */
  loyalty?: LoyaltyConfig;
  openNow?: OpenState;
  requestSlots?: string[];
  /** P2-4: operator kill switch — menu stays visible, ordering is closed. */
  orderingPaused?: boolean;
  /** Table reservations: absent when the owner switched them off, so the
   *  button and its client bundle never reach the guest page. */
  reserve?: { slug: string; hours: OpeningHours; timezone: string };
}): React.ReactElement {
  const brand = menu.venue.branding.primaryColor ?? "#b8935f";
  const locale = menu.locale || menu.venue.defaultLocale || "en";
  // ONE catalogue lookup for the whole render; every sub-component takes
  // `t` as a prop rather than resolving the locale again.
  const t = menuCopy(locale);
  // Footer copyright year — read ONCE per render so every place that
  // prints it agrees, and so a test can pin a single value. The page is
  // rendered per request / per revalidation, so it rolls over on its own.
  const year = new Date().getFullYear();
  const diets = activeDiets ?? new Set<string>();
  const activeDiet = diets.size > 0 ? Array.from(diets)[0]! : null;
  const catList = allCategories ?? menu.categories.map((c) => ({ id: c.id, name: c.name }));
  /* P7-12 — "Offers" as a destination: one synthetic section, first on the
     page and first on every category rail, listing the dishes whose offer
     is live. Derived from the tree we are actually rendering (the diet
     filter may have removed every discounted dish), so the tab can never
     lead to an empty section. Items keep their real ids: the Add button
     places the dish from its own category, only the heading ids are
     prefixed so nothing in the DOM appears twice. */
  const offers = offerItems(menu);
  const offersSection =
    offers.length > 0
      ? { id: OFFERS_CATEGORY_ID, name: t.offers.title, photoKey: null, items: offers }
      : null;
  // A stale `?cat=offers` (offers ended, or the diet filter emptied them)
  // degrades to the whole menu rather than hiding every section.
  const activeCat =
    activeCategoryId === OFFERS_CATEGORY_ID && !offersSection ? null : (activeCategoryId ?? null);
  const offersLabel = offersSection ? t.offers.tab : null;
  const jsonLd = jsonLdString(buildRestaurantJsonLd(menu, { pageUrl: `${siteUrl()}/${locale}` }));
  // Theme + texture come from the venue's saved appearance; the whole
  // renderer reads colors from these CSS vars, so this style attribute IS
  // the theme switch. The theme also picks the page layout below.
  const theme = resolveMenuTheme(menu.venue.branding.theme);
  const themeStyle = menuThemeStyle(
    menu.venue.branding.theme,
    menu.venue.branding.texture,
    menu.venue.branding.backdrop,
    menu.venue.branding.headingColor,
  );
  // Self-ordering rides on the published menu only — the preview shows
  // draft item ids the order API would rightly reject. The modes come
  // from plan entitlements ∧ owner switches; no mode → no cart at all.
  const modes = orderingModes ?? {
    dineIn: false,
    takeaway: false,
    delivery: false,
    deliveryAreas: [],
    deliveryFeeCents: 0,
    deliveryMinCents: 0,
    acceptedPayments: [],
  };
  const ordering =
    !orderingPaused && !menu.isPreview && (modes.dineIn || modes.takeaway || modes.delivery);
  // Footer payment strip: what the owner ticked in settings PLUS the card
  // brands the live online rails can actually charge (Stripe → Visa /
  // Mastercard / Amex, PayPal → PayPal), so a venue that turned card
  // payment on never has to re-tick the same brands by hand.
  const payMarks = acceptedPaymentIds({
    accepted: modes.acceptedPayments,
    onlinePayment: Boolean(onlinePayment),
    paypalPayment: Boolean(paypalPayment),
  });
  // The restaurant's own numbers for the footer row. Already projected by
  // the loader — number, display string and `tel:` / `wa.me` href — so the
  // page renders links rather than deriving them a second time.
  const contact = menu.venue.contact ?? null;
  // One row per number the owner actually published, in call order.
  // Deriving the list here (rather than three conditional <li>s) is what
  // guarantees the footer can never render an empty list item.
  const contactRows: ContactRow[] = contact
    ? (
        [
          ["landline", contact.landline, t.contact.landline],
          ["mobile", contact.mobile, t.contact.mobile],
          ["whatsapp", contact.whatsapp, t.contact.whatsapp],
        ] as const
      ).flatMap(([key, entry, label]) =>
        entry
          ? [
              {
                key,
                label,
                display: entry.display,
                href: entry.href,
                // WhatsApp leaves the site, so its name says so out loud;
                // the two `tel:` links keep the "Call <slot> <number>" name
                // they have always had.
                aria:
                  key === "whatsapp"
                    ? t.contact.whatsappAria(entry.display)
                    : t.contact.callAria(label, entry.display),
              },
            ]
          : [],
      )
    : [];
  // "Get the app": the store listings + a direct APK, already validated by
  // the loader. Null for every venue whose owner has published none, which
  // hides the footer section AND the header link in one check.
  const appLinks = menu.venue.appLinks ?? null;
  const showIcons = menu.venue.branding.categoryIcons === "icons";
  // Owner-chosen category navigation for LARGE screens: "side" renders a
  // sticky left rail and drops the top-bar tabs on lg+. Phones always
  // keep the top bar regardless.
  const sideNav = menu.venue.branding.navLayout === "side" && catList.length >= 2;
  const offeredDiets: string[] = [
    ...DIETARY_VALUES,
    ...(menu.venue.branding.halalFilter === "on" ? [HALAL_DIET] : []),
  ];
  const Section =
    theme.layout === "grid" || theme.layout === "hero"
      ? GridSection
      : theme.layout === "list"
        ? ListSection
        : theme.layout === "showcase"
          ? ShowcaseSection
          : theme.layout === "floating"
            ? FloatingSection
            : EditorialSection;
  // Self-order kiosk: on very large PORTRAIT touchscreens (nothing a
  // phone or laptop ever reports) raise the root font size so the whole
  // rem-based UI — text, buttons, spacing, the rem-based max-widths —
  // scales together and fills the screen. Same URL everywhere; the
  // media query is the switch, the owner's appearance setting the gate.
  const kioskFontPx =
    menu.venue.branding.kiosk === "xl" ? 24 : menu.venue.branding.kiosk === "off" ? null : 21;

  const borderless = menu.venue.branding.cardBorders === "off";
  return (
    <div
      className={`menu-theme flex min-h-screen flex-col bg-[var(--menu-bg)] text-[var(--menu-text)] ${
        borderless ? "menu-borderless" : ""
      }`}
      style={themeStyle}
    >
      {borderless ? (
        // Owner switch: no hairline around dish cards — a resting shadow
        // keeps same-color cards separable from the page ground.
        <style>{`.menu-borderless .dish-card{border-color:transparent;box-shadow:0 14px 34px -24px rgba(0,0,0,0.38)}`}</style>
      ) : null}
      {/* Fade-in-up keyframes scoped to this page. `prefers-reduced-
          motion: reduce` disables the animation entirely so a
          vestibular-sensitive guest never sees the movement. */}
      <style>{ANIMATION_CSS}</style>
      {orderingPaused ? (
        <div
          role="status"
          className="bg-[var(--menu-accent,#b8935f)] px-4 py-2 text-center text-sm font-medium text-white"
        >
          {t.banners.orderingPaused}
        </div>
      ) : null}
      {kioskFontPx ? (
        // The Add pill's 11px label is deliberately fixed for phones; on
        // the kiosk it must grow too or the tap target stays finger-
        // hostile. Scoped rule, same media query as the root bump.
        <style>{`@media (min-width: 1000px) and (min-height: 1200px) {
          html { font-size: ${kioskFontPx}px; }
          .add-cta { font-size: 0.72rem; padding: 0.55rem 1.05rem; }
        }`}</style>
      ) : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <main className="flex-1">
        {/* Screen-reader-only H1 so assistive tech reads the venue
           name first thing. The inline `color: brand` keeps the
           venue's chosen accent hex on the page (structured-data +
           test-visible) without polluting the dark visual design
           the sighted user gets from the gold-on-espresso VenueMark. */}
        <h1 className="sr-only" style={{ color: brand }}>
          {t.metadata.srHeading(menu.venue.name)}
        </h1>
        {menu.isPreview ? (
          <p
            role="status"
            className="mx-auto max-w-6xl px-6 pt-6 text-xs font-semibold uppercase tracking-widest text-[var(--menu-accent)]"
          >
            {t.banners.draftPreview}
          </p>
        ) : null}

        {menu.venue.branding.bannerKey ? (
          /* Hero header: the banner IS the top of the page, with the
             restaurant's identity (logo + name) and the open/closed
             pill overlaid — the sticky bar below then carries only the
             menu controls. */
          <HeroBanner
            venue={menu.venue}
            rating={menu.rating}
            openNow={openNow}
            reserve={reserve}
            hasApp={appLinks !== null}
            t={t}
            locale={locale}
          />
        ) : null}

        <StickyBar
          venue={menu.venue}
          /* Only when there is no banner hero — the hero renders its own
             copy of the line, and two would be one too many. */
          rating={menu.venue.branding.bannerKey ? null : menu.rating}
          categories={catList}
          activeCategoryId={activeCat}
          offersLabel={offersLabel}
          activeDiet={activeDiet}
          showIcons={showIcons}
          offeredDiets={offeredDiets}
          openNow={openNow}
          reserve={reserve}
          hasApp={appLinks !== null}
          sideNav={sideNav}
          hero={Boolean(menu.venue.branding.bannerKey)}
          t={t}
          locale={locale}
        />

        {theme.layout === "hero" && !activeCat ? (
          <HeroSplash
            venue={menu.venue}
            categories={menu.categories}
            activeDiet={activeDiet}
            t={t}
          />
        ) : null}

        <div
          id="menu"
          className={`mx-auto max-w-7xl scroll-mt-28 px-4 py-8 sm:px-8 sm:py-10 lg:px-12 ${
            sideNav ? "lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10" : ""
          }`}
        >
          {sideNav ? (
            <SideRail
              categories={catList}
              active={activeCat}
              offersLabel={offersLabel}
              activeDiet={activeDiet}
              showIcons={showIcons}
              t={t}
            />
          ) : null}
          <div className="min-w-0">
            {menu.categories.length === 0 ? (
              <p className="mx-auto mt-16 max-w-lg text-center text-sm text-[var(--menu-text)]/70">
                {diets.size > 0 || activeCat ? t.emptyStates.noDietMatch : t.emptyStates.emptyMenu}
              </p>
            ) : (
              <div className={theme.layout === "editorial" ? "space-y-20" : "space-y-24"}>
                {offersSection ? (
                  <div
                    data-category-id={OFFERS_CATEGORY_ID}
                    hidden={activeCat ? activeCat !== OFFERS_CATEGORY_ID : undefined}
                  >
                    <p className="sr-only">{t.offers.count(offersSection.items.length)}</p>
                    <Section
                      cat={offersSection}
                      catIndex={0}
                      idPrefix="offer-"
                      locale={locale}
                      slug={menu.venue.slug}
                      ordering={ordering}
                      showIcons={showIcons}
                      t={t}
                    />
                  </div>
                ) : null}
                {menu.categories.map((cat, catIndex) => (
                  /* Every category is in the DOM; the tabs filter by toggling
                     `hidden` (client-side, instant). A ?cat= deep link arrives
                     pre-filtered from the server, so no-JS readers and search
                     engines see the same single category they asked for. */
                  <div
                    key={cat.id}
                    data-category-id={cat.id}
                    hidden={activeCat ? cat.id !== activeCat : undefined}
                  >
                    <Section
                      cat={cat}
                      /* Offers, when present, is section 01 — the numbered
                         editorial headings and the LCP-priority first photo
                         both follow the order on screen. */
                      catIndex={offersSection ? catIndex + 1 : catIndex}
                      locale={locale}
                      slug={menu.venue.slug}
                      ordering={ordering}
                      showIcons={showIcons}
                      t={t}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <footer className="border-t border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] text-[var(--menu-surface-text,var(--menu-text))]">
        {/* TWO rows, not three columns: the owner asked for a footer no
            taller than two or three lines on a desktop, and the column
            layout spent ~370px on five stacked blocks with a small-caps
            heading over each one.

            Row 1 is a single wrapping flex row that spreads its five
            groups across the width — identity, what you can pay with, the
            language switcher, "Get the app", the venue's numbers. The
            numbers sit at the far end on purpose: they are the one group
            a guest goes looking for, so they get the edge rather than
            the middle of the row.
            Row 2 is the operator's line: legal links and "powered by"
            side by side rather than stacked.

            Every visible <h2> is gone; each group keeps its name on the
            group itself (`aria-label` on the nav / section / role="group"),
            so a screen reader still hears what it has landed in while the
            eye gets an unlabelled, single-line strip. The app blurb and
            the APK hint went with them — the hint survives as the APK
            anchor's `title`, which is where a tooltip belongs.

            A phone wraps this into more lines, which is fine and expected;
            what must not happen is a sideways scroll, hence `flex-wrap`
            on every row and `min-w-0` on every group. */}
        {/* Bottom padding only while ordering is live: that is exactly when
            <CartDrawer> parks its floating cart button at `bottom-4`, and
            without the clearance it sat on top of the powered-by line on a
            phone. `env(safe-area-inset-bottom)` adds the home-indicator
            strip so the gap is the same on a notched iPhone. */}
        <div
          className={`mx-auto max-w-7xl px-6 py-5 sm:px-8 ${
            ordering ? "pb-[calc(6rem+env(safe-area-inset-bottom))]" : ""
          }`}
        >
          {/* ---------- Row 1 · everything a guest might act on ---------- */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 md:justify-between">
            {/* a · Who this restaurant is */}
            <div className="inline-flex min-w-0 items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  menu.venue.branding.logoKey
                    ? menuImageUrl(menu.venue.branding.logoKey, menu.venue.id, 160)
                    : "/brand/logo-192.png"
                }
                alt=""
                width={40}
                height={40}
                className={
                  menu.venue.branding.logoKey
                    ? "h-10 w-10 shrink-0 rounded-full object-cover"
                    : "h-10 w-10 shrink-0"
                }
              />
              <span className="min-w-0 font-serif text-lg italic">{menu.venue.name}</span>
            </div>

            {/* b · What you can pay with. Rendered ONLY when the owner
                accepts something — an always-present empty <div> would
                still eat one of the row's gaps. role="group" + the label
                keep the strip named now that its heading is gone, and the
                small chips keep the row one line tall. */}
            {payMarks.length > 0 ? (
              <div role="group" aria-label={t.footer.acceptedPayments} className="min-w-0">
                <PaymentMarks ids={payMarks} size="sm" />
              </div>
            ) : null}
            {/* c · What language you read it in. <LocaleSwitcher> is itself
                a <nav aria-label={t.nav.language}>, so the dropped heading
                costs the group nothing — and wrapping it in a SECOND
                element carrying the same name would announce "Language"
                twice, one landmark nested in another. */}
            {menu.venue.enabledLocales.length > 1 ? (
              <div className="min-w-0">
                <LocaleSwitcher
                  current={locale}
                  enabled={menu.venue.enabledLocales}
                  activeDiet={activeDiet}
                  t={t}
                />
              </div>
            ) : null}

            {/* d · "Get the app" — the landing spot for the header's jump
                link, and the only place in the product a guest is offered
                the venue's own app. Every piece is an ordinary anchor, so
                it works with JS off. Absent entirely until an owner
                publishes a link, and the badges come from a list so an
                unpublished store is never an empty list item. The artwork
                is our own brand-neutral drawing (see `app-badges.tsx`),
                not Apple's or Google's files. The section's aria-label is
                what names it now that the heading and the blurb are gone. */}
            {appLinks ? (
              <section id="get-the-app" aria-label={t.app.title} className="min-w-0 scroll-mt-32">
                <ul className="flex flex-wrap items-center gap-2">
                  {appLinks.ios ? (
                    <li>
                      <a
                        href={appLinks.ios}
                        target="_blank"
                        rel="noopener"
                        aria-label={t.app.storeAria(`${t.app.iosTop} ${t.app.iosName}`)}
                        className="inline-flex"
                      >
                        <AppStoreBadge
                          topLine={t.app.iosTop}
                          storeName={t.app.iosName}
                          className="h-[46px] w-[153px]"
                        />
                      </a>
                    </li>
                  ) : null}
                  {appLinks.android ? (
                    <li>
                      <a
                        href={appLinks.android}
                        target="_blank"
                        rel="noopener"
                        aria-label={t.app.storeAria(`${t.app.androidTop} ${t.app.androidName}`)}
                        className="inline-flex"
                      >
                        <GooglePlayBadge
                          topLine={t.app.androidTop}
                          storeName={t.app.androidName}
                          className="h-[46px] w-[153px]"
                        />
                      </a>
                    </li>
                  ) : null}
                  {appLinks.apk ? (
                    /* Deliberately a plain button, not a third badge: a
                       file the venue hosts itself is not a store listing,
                       and dressing it as one would be the wrong promise.
                       The "Android will ask you to allow the install"
                       hint used to be a paragraph under the row; it is
                       the anchor's `title` now, so the warning still
                       reaches the guest without costing the footer a
                       line. */
                    <li>
                      <a
                        href={appLinks.apk}
                        download
                        title={t.app.apkHint}
                        className="inline-flex h-[46px] items-center rounded-[9px] border border-current/45 px-4 text-xs font-semibold no-underline"
                      >
                        {t.app.apk}
                      </a>
                    </li>
                  ) : null}
                </ul>
              </section>
            ) : null}

            {/* e · The restaurant's own numbers — icon + number, one line.
                The icon says which line it is, so the visible "Call
                landline" / "Mobil anrufen" wording is dropped; each
                anchor's aria-label still spells out what the link does
                ("Call landline +49 …", "Message +49 … on WhatsApp"), so a
                screen reader hears more than a bare number and no sr-only
                copy is needed on top of it. Plain anchors — `tel:` dials,
                `wa.me` opens WhatsApp — so the group works with JS off,
                which is the contract for every public page. Built from a
                derived list so a slot the owner left empty produces no
                list item at all, ever. */}
            {contactRows.length > 0 ? (
              <nav aria-label={t.contact.title} className="min-w-0">
                <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {contactRows.map((row) => (
                    <li key={row.key}>
                      <a
                        href={row.href}
                        aria-label={row.aria}
                        {...(row.key === "whatsapp"
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                        className="inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline"
                      >
                        <ContactIcon kind={row.key} />
                        <span className="font-medium tabular-nums">{row.display}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>

          {/* ---------- Row 2 · the operator, and its legal pages ---------- */}
          {/* Footer = ON the surface: page-ink (--menu-text-soft) was
              1.8:1 against dark-red surfaces — surface ink instead, which
              is what the <footer> already sets, so a plain opacity is
              enough here. */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-[var(--menu-surface-text,var(--menu-text))]/10 pt-3 text-xs">
            {/* The restaurant's own line comes first — the two links and
                the operator's credit after it. One line on a desktop, the
                same wrap as the rest of the row on a phone. */}
            <span className="text-center text-xs opacity-75">
              {t.footer.copyright(year, menu.venue.name)}
            </span>
            <nav
              aria-label={t.footer.legal}
              className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1"
            >
              <Link
                href="/legal/impressum"
                className="underline underline-offset-4 hover:no-underline"
              >
                {t.footer.imprint}
              </Link>
              <Link
                href="/legal/privacy"
                className="underline underline-offset-4 hover:no-underline"
              >
                {t.footer.privacy}
              </Link>
            </nav>
            <span className="text-center text-xs opacity-75">{t.footer.poweredBy(BRAND.name)}</span>
          </div>
        </div>
      </footer>
      {ordering ? (
        <CartDrawer
          slug={menu.venue.slug}
          currency={menu.venue.currency}
          locale={locale}
          modes={modes}
          requestSlots={requestSlots ?? []}
          /* Closed right now → no "Now" chip, a later slot preselected,
             and dine-in off. Absent reads as "no opinion" = true, so a
             venue with no opening hours keeps ordering exactly as it is. */
          acceptsAsapNow={menu.ordering?.acceptsAsapNow ?? true}
          onlinePayment={Boolean(onlinePayment)}
          paypalPayment={Boolean(paypalPayment)}
          /* Apple Pay / Google Pay show up only when the owner ticked
             them in Settings → "Payment methods you accept". */
          acceptedPayments={modes.acceptedPayments}
          loyalty={
            loyalty?.enabled
              ? {
                  enabled: true,
                  minOrderCents: loyalty.minOrderCents,
                  pointsPerOrder: loyalty.pointsPerOrder,
                }
              : undefined
          }
        />
      ) : null}
      {/* Card reveal: ~600 bytes of inline JS. A scroll-scrubbed CSS
          timeline moves in lockstep with wheel ticks and feels steppy;
          this plays a *timed* ease-out rise instead. Above-fold cards
          animate immediately with a stagger; the rest are hidden and
          revealed by an IntersectionObserver as they enter the viewport.
          Fail-open by design: without JS nothing is ever hidden, and a
          3s timer un-hides anything the observer missed, so a broken
          observer can never blank the menu. Wrapped in a hidden div via
          dangerouslySetInnerHTML: the HTML parser executes it on first
          load, while React (which never runs literal script children)
          neither executes nor warns on client-side re-renders — soft
          navigations simply show cards without the entrance. */}
      <div
        hidden
        dangerouslySetInnerHTML={{
          __html: `<script>(function(){if(matchMedia('(prefers-reduced-motion: reduce)').matches||!('IntersectionObserver'in window))return;var cards=[].slice.call(document.querySelectorAll('.dish-card'));var vh=window.innerHeight,i=0;cards.forEach(function(c){if(c.getBoundingClientRect().top<vh){c.style.animationDelay=Math.min(i++*60,360)+'ms';c.classList.add('in-view');}else{c.classList.add('pre-reveal');}});var o=new IntersectionObserver(function(es){var j=0;es.forEach(function(e){var t=e.target;if(!e.isIntersecting)return;o.unobserve(t);if(!t.classList.contains('pre-reveal'))return;t.style.animationDelay=Math.min(j++*55,275)+'ms';t.classList.remove('pre-reveal');t.classList.add('in-view');});},{rootMargin:'0px 0px -6% 0px',threshold:0.05});cards.forEach(function(c){if(!c.classList.contains('in-view'))o.observe(c);});setTimeout(function(){cards.forEach(function(c){c.classList.remove('pre-reveal');});},3000);})();</script>`,
        }}
      />
      {/* First-visit privacy notice. Client-only (it reads the guest's own
          localStorage, which a static edge-cached page cannot), and never
          in the owner's draft preview — that surface is a proof of the
          menu, not a guest visit. */}
      {menu.isPreview ? null : <PrivacyNotice labels={t.privacy} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section layouts                                                     */
/* ------------------------------------------------------------------ */

type SectionProps = {
  cat: PublicMenu["categories"][number];
  catIndex: number;
  locale: string;
  slug: string;
  ordering: boolean;
  showIcons: boolean;
  t: MenuCopy;
  /** Set on the synthetic Offers section: prefixes the heading ids of the
   *  dishes it repeats so no DOM id (or aria-labelledby target) is
   *  duplicated on the page. */
  idPrefix?: string;
};

/** Round icon medallion used by section headings when icons are on and
 *  the category has no uploaded photo. */
function CategoryIconMedallion({ name }: { name: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--menu-accent)]/40 bg-[var(--menu-surface)] text-2xl"
    >
      {categoryIcon(name)}
    </span>
  );
}

type DishProps = {
  item: PublicMenu["categories"][number]["items"][number];
  locale: string;
  slug: string;
  ordering: boolean;
  t: MenuCopy;
  /**
   * The first dish on the page — almost always the Largest Contentful
   * Paint element. Lazy-loading it defers the very pixel LCP is measured
   * on: Lighthouse scored `lcp-lazy-loaded` 0 and LCP landed at 3.6s
   * against a 2.7s budget. Eager + high fetch priority for that one image
   * only; everything below the fold stays lazy.
   */
  priority?: boolean;
  /** See `SectionProps.idPrefix` — the Offers section renders the same
   *  dish twice on one page, so its copy needs its own heading id. */
  idPrefix?: string;
};

/** Numbered heading + wide photo-left cards (the serif editorial look). */
function EditorialSection({
  cat,
  catIndex,
  locale,
  slug,
  ordering,
  showIcons,
  idPrefix,
  t,
}: SectionProps): React.ReactElement {
  return (
    <section
      aria-labelledby={`cat-${cat.id}`}
      className="scroll-mt-40 fade-in-up"
      style={{ animationDelay: `${catIndex * 60}ms` }}
    >
      <div className="mb-8 flex items-center gap-6">
        {cat.photoKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={menuImageUrl(cat.photoKey, cat.id, 160)}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="h-16 w-16 shrink-0 rounded-full border border-[var(--menu-accent)]/40 object-cover"
          />
        ) : showIcons ? (
          <CategoryIconMedallion name={cat.name} />
        ) : (
          <span
            aria-hidden="true"
            className="font-serif text-4xl italic text-[var(--menu-heading,var(--menu-accent))] sm:text-5xl"
          >
            {String(catIndex + 1).padStart(2, "0")}
          </span>
        )}
        <h2
          id={`cat-${cat.id}`}
          className="font-serif text-3xl leading-tight text-[var(--menu-heading,var(--menu-accent))] sm:text-4xl md:text-5xl"
        >
          {cat.name}
        </h2>
        <span
          aria-hidden="true"
          className="ms-2 h-px flex-1 self-end bg-gradient-to-r from-[var(--menu-accent)]/40 to-transparent rtl:bg-gradient-to-l"
        />
      </div>
      {cat.items.length === 0 ? (
        <p className="text-sm text-[var(--menu-text)]/60">{t.emptyStates.noDishesInSection}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {cat.items.map((item, itemIndex) => (
            <li
              key={item.id}
              className="fade-in-up"
              style={{ animationDelay: `${catIndex * 60 + itemIndex * 40}ms` }}
            >
              <DishCard
                item={item}
                locale={locale}
                slug={slug}
                ordering={ordering}
                priority={catIndex === 0 && itemIndex === 0}
                idPrefix={idPrefix}
                t={t}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Centered heading + photo-top cards in a responsive grid (Fresh Bistro). */
/**
 * Landing splash for the "hero" layout — the fast-food reference: dark
 * band with a two-tone display headline, tagline, CTA, a round hero dish
 * photo, feature badges, a wave into the body, then unboxed photo
 * category tiles. Server-rendered, zero JS.
 */
function HeroSplash({
  venue,
  categories,
  activeDiet,
  t,
}: {
  venue: PublicMenu["venue"];
  categories: PublicMenu["categories"];
  activeDiet: string | null;
  t: MenuCopy;
}): React.ReactElement {
  const words = venue.name.split(/\s+/);
  const first = words[0] ?? venue.name;
  const rest = words.slice(1).join(" ");
  const heroItem = categories.flatMap((c) => c.items).find((i) => i.photoKey && i.isAvailable);
  const slugOf = categorySlugs(categories.map((c) => ({ id: c.id, name: c.name })));
  const dietQs = activeDiet ? `&diet=${activeDiet}` : "";
  return (
    <section aria-label={t.hero.welcomeAria} className="bg-[#0f0d0a] text-[#f5f1e8]">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 pb-6 pt-12 sm:px-8 md:grid-cols-[minmax(0,1fr)_auto] lg:px-12">
        <div>
          <p className="font-serif text-xl italic text-[var(--menu-accent)]">{t.hero.welcomeTo}</p>
          <h2 className="mt-2 text-4xl font-black uppercase leading-[1.05] tracking-tight sm:text-6xl">
            {first}
            {rest ? (
              <>
                {" "}
                <span className="text-[var(--menu-accent)]">{rest}</span>
              </>
            ) : null}
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[#f5f1e8]/75">
            {t.hero.tagline}
          </p>
          <div className="mt-6">
            <a
              href="#menu"
              className="inline-block rounded-full bg-[var(--menu-accent)] px-7 py-3 text-sm font-bold uppercase tracking-wider text-[#171207] transition hover:opacity-90"
            >
              {t.hero.orderNow}
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-xs text-[#f5f1e8]/80">
            {t.hero.features.map((f) => (
              <li key={f.title} className="flex items-center gap-2.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--menu-accent)]" />
                <span>
                  <span className="block font-bold uppercase tracking-wide">{f.title}</span>
                  <span className="block text-[#f5f1e8]/60">{f.sub}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        {heroItem ? (
          // This splash photo is decorative and only ever shown from md
          // up (`hidden … md:block`). Browsers still download
          // display:none images, so the desktop-only source lives on a
          // media-gated <source> and the <img> falls back to an inline
          // transparent pixel — a phone guest now fetches nothing here.
          <picture className="hidden md:block">
            <source
              media="(min-width: 768px)"
              srcSet={menuImageSrcSet(heroItem.photoKey, heroItem.id, 640)}
            />
            <img
              src={TRANSPARENT_PIXEL}
              alt=""
              aria-hidden="true"
              className="h-64 w-64 rounded-full border-4 border-[var(--menu-accent)]/70 object-cover shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] lg:h-80 lg:w-80"
            />
          </picture>
        ) : null}
      </div>
      {/* Wave into the body color, like the reference. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 70"
        preserveAspectRatio="none"
        className="block h-10 w-full sm:h-14"
      >
        <path
          d="M0,32 C240,72 480,72 720,44 C960,16 1200,10 1440,38 L1440,70 L0,70 Z"
          fill="var(--menu-bg)"
        />
      </svg>
      {/* Unboxed photo categories on the body ground. */}
      {categories.length >= 2 ? (
        <nav
          aria-label={t.hero.categoriesAria}
          className="bg-[var(--menu-bg)] pb-2 pt-8 text-[var(--menu-text)]"
        >
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-[var(--menu-accent)]">
            {t.hero.categoriesHeading}
          </p>
          <ul className="mx-auto mt-6 flex max-w-6xl flex-wrap items-start justify-center gap-x-10 gap-y-8 px-6">
            {categories.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/?cat=${slugOf.get(c.id) ?? c.id}${dietQs}`}
                  prefetch={false}
                  className="group block w-24 text-center"
                >
                  {c.photoKey ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={menuImageUrl(c.photoKey, c.id, 240)}
                      alt=""
                      loading="lazy"
                      className="mx-auto h-20 w-20 rounded-full object-cover shadow-md transition group-hover:scale-105"
                    />
                  ) : (
                    <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[var(--menu-line)] text-3xl">
                      {categoryIcon(c.name)}
                    </span>
                  )}
                  <span className="mt-2 block text-sm font-semibold leading-tight">{c.name}</span>
                  <span className="block text-[11px] text-[var(--menu-text-soft)]">
                    {t.hero.dishCount(c.items.length)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </section>
  );
}

/**
 * "Floating" layout — the unboxed reference: big round dish photo on the
 * plain page ground (no card box), serif-italic name, soft description,
 * price + pill add button. Generous air between items.
 */
function FloatingSection({
  cat,
  catIndex,
  locale,
  slug,
  ordering,
  showIcons,
  idPrefix,
  t,
}: SectionProps): React.ReactElement {
  return (
    <section
      aria-labelledby={`cat-${cat.id}`}
      className="scroll-mt-40 fade-in-up"
      style={{ animationDelay: `${catIndex * 60}ms` }}
    >
      <div className="mb-12 flex flex-col items-center text-center">
        {showIcons ? (
          <span className="mb-4">
            <CategoryIconMedallion name={cat.name} />
          </span>
        ) : null}
        <h2
          id={`cat-${cat.id}`}
          className="font-serif text-3xl font-semibold leading-tight text-[var(--menu-heading,var(--menu-text))] [text-shadow:0_1px_14px_rgba(0,0,0,0.12)] sm:text-4xl"
        >
          {cat.name}
        </h2>
        <span aria-hidden="true" className="mt-3 h-1 w-16 rounded-full bg-[var(--menu-accent)]" />
      </div>
      {cat.items.length === 0 ? (
        <p className="text-center text-sm text-[var(--menu-text)]/60">
          {t.emptyStates.noDishesInSection}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-6 gap-y-14 sm:gap-x-10 md:grid-cols-3">
          {cat.items.map((item, itemIndex) => (
            <li
              key={item.id}
              className="fade-in-up"
              style={{ animationDelay: `${catIndex * 60 + itemIndex * 30}ms` }}
            >
              <article
                suppressHydrationWarning
                aria-labelledby={dishHeadingId(item.id, idPrefix)}
                className="dish-card group flex h-full flex-col text-[var(--menu-text)]"
              >
                <div aria-hidden="true" className="relative mx-auto w-full max-w-56">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={menuImageUrl(item.photoKey, item.id, 480)}
                    srcSet={menuImageSrcSet(item.photoKey, item.id, 480)}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full rounded-full object-cover shadow-[0_18px_40px_-18px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="absolute start-1 top-1 z-10 max-h-[calc(100%-0.5rem)] overflow-hidden">
                    <PhotoDietBadges dietary={item.dietary} t={t} />
                  </div>
                </div>
                <h3
                  id={dishHeadingId(item.id, idPrefix)}
                  className={`mt-4 font-serif text-lg italic leading-snug ${
                    item.isAvailable ? "" : "line-through opacity-60"
                  }`}
                >
                  {item.name}
                  {!item.isAvailable ? (
                    <span className="ms-1 align-middle text-[9px] uppercase tracking-widest text-[var(--menu-text-soft)] no-underline">
                      {t.badges.unavailable}
                    </span>
                  ) : null}
                </h3>
                {item.description ? (
                  <DishDescription
                    text={item.description}
                    dishName={item.name}
                    labels={dishLabels(locale, item.name)}
                    className="mt-1 text-xs leading-relaxed text-[var(--menu-text-soft)]"
                  />
                ) : null}
                <BadgeRow
                  allergens={item.allergens}
                  traces={item.traces}
                  spice={item.spice}
                  dishName={item.name}
                  t={t}
                  locale={locale}
                />
                <div className="mt-auto flex w-full items-center justify-between gap-2 pt-3">
                  <p
                    aria-label={t.badges.price}
                    className="text-base font-bold tabular-nums text-[var(--menu-text)]"
                  >
                    {item.offer ? (
                      <s className="me-1.5 text-[0.85em] font-normal opacity-55">
                        {formatPrice(item.offer.basePriceCents, item.currency, locale)}
                      </s>
                    ) : null}
                    {formatPrice(item.priceCents, item.currency, locale)}
                  </p>
                  {ordering && item.isAvailable ? (
                    <AddToOrderButton
                      slug={slug}
                      itemId={item.id}
                      name={item.name}
                      labels={addToOrderLabels(locale, item.name)}
                      priceCents={item.priceCents}
                    />
                  ) : null}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GridSection({
  cat,
  catIndex,
  locale,
  slug,
  ordering,
  showIcons,
  idPrefix,
  t,
}: SectionProps): React.ReactElement {
  return (
    <section
      aria-labelledby={`cat-${cat.id}`}
      className="scroll-mt-40 fade-in-up"
      style={{ animationDelay: `${catIndex * 60}ms` }}
    >
      <div className="mb-10 flex flex-col items-center text-center">
        {cat.photoKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={menuImageUrl(cat.photoKey, cat.id, 160)}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="mb-4 h-16 w-16 rounded-full border border-[var(--menu-text)]/12 object-cover"
          />
        ) : showIcons ? (
          <span className="mb-4">
            <CategoryIconMedallion name={cat.name} />
          </span>
        ) : null}
        <h2
          id={`cat-${cat.id}`}
          className="font-serif text-3xl font-semibold leading-tight text-[var(--menu-heading,var(--menu-text))] [text-shadow:0_1px_14px_rgba(0,0,0,0.12)] sm:text-4xl"
        >
          {cat.name}
        </h2>
        <span aria-hidden="true" className="mt-3 h-1 w-16 rounded-full bg-[var(--menu-accent)]" />
      </div>
      {cat.items.length === 0 ? (
        <p className="text-center text-sm text-[var(--menu-text)]/60">
          {t.emptyStates.noDishesInSection}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
          {cat.items.map((item, itemIndex) => (
            <li
              key={item.id}
              className="fade-in-up"
              style={{ animationDelay: `${catIndex * 60 + itemIndex * 30}ms` }}
            >
              <GridDishCard
                item={item}
                locale={locale}
                slug={slug}
                ordering={ordering}
                priority={catIndex === 0 && itemIndex === 0}
                idPrefix={idPrefix}
                t={t}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Photo on top, name + price centered underneath — the bistro card. */
function GridDishCard({
  item,
  locale,
  slug,
  ordering,
  priority,
  t,
  idPrefix,
}: DishProps): React.ReactElement {
  const src = menuImageUrl(item.photoKey, item.id, 480);
  const srcSet = menuImageSrcSet(item.photoKey, item.id, 480);
  return (
    <article
      // The reveal script mutates class/style before hydration; React
      // must not warn about (or fight) those attribute differences.
      suppressHydrationWarning
      aria-labelledby={dishHeadingId(item.id, idPrefix)}
      className="dish-card text-[var(--menu-surface-text,var(--menu-text))] group relative flex h-full flex-col overflow-hidden rounded-md border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-18px_rgba(36,50,78,0.35)]"
    >
      <div
        aria-hidden="true"
        className="relative aspect-square overflow-hidden bg-[var(--menu-line)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          srcSet={srcSet}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span
          aria-hidden="true"
          className="dish-shine pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent"
        />
        <div className="absolute start-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-hidden">
          <PhotoDietBadges dietary={item.dietary} t={t} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-2.5 py-3 sm:px-3 sm:py-4">
        <div className="flex items-start justify-between gap-2">
          <h3
            id={dishHeadingId(item.id, idPrefix)}
            className={
              item.isAvailable
                ? "text-sm font-medium leading-snug"
                : "text-sm font-medium leading-snug text-[var(--menu-surface-text,var(--menu-text))]/60 line-through"
            }
          >
            {item.name}
            {!item.isAvailable ? (
              <span className="ms-1 align-middle text-[9px] uppercase tracking-widest text-[var(--menu-surface-text-soft,var(--menu-text-soft))] no-underline">
                {t.badges.unavailable}
              </span>
            ) : null}
          </h3>
          <div className="hidden shrink-0 justify-end sm:flex">
            <BadgeRow
              allergens={item.allergens}
              traces={item.traces}
              spice={item.spice}
              dishName={item.name}
              t={t}
              locale={locale}
            />
          </div>
        </div>
        {item.description ? (
          <DishDescription
            text={item.description}
            dishName={item.name}
            labels={dishLabels(locale, item.name)}
            className="text-xs leading-relaxed text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
          />
        ) : null}
        <MobileAllergenLine
          allergens={item.allergens}
          traces={item.traces}
          spice={item.spice}
          dishName={item.name}
          t={t}
          locale={locale}
        />

        {item.variants.length > 0 ? (
          <ul className="w-full space-y-0.5 text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
            {item.variants.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between gap-2">
                <span>{v.name}</span>
                <span className="tabular-nums">
                  {v.priceDeltaCents >= 0 ? "+" : ""}
                  {formatPrice(v.priceDeltaCents, item.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex w-full items-center justify-between gap-2 pt-2">
          <p
            aria-label={t.badges.price}
            className="text-base font-semibold tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))]"
          >
            {item.offer ? (
              <>
                <span className="me-1.5 rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-[var(--menu-surface)]">
                  {t.badges.offer}
                </span>
                <s className="me-1.5 text-[0.85em] font-normal opacity-55">
                  <span className="sr-only">{t.badges.regularPrice} </span>
                  {formatPrice(item.offer.basePriceCents, item.currency, locale)}
                </s>
                <span className="sr-only">{t.badges.offerPrice} </span>
              </>
            ) : null}
            {formatPrice(item.priceCents, item.currency, locale)}
          </p>
          {ordering && item.isAvailable ? (
            <AddToOrderButton
              slug={slug}
              itemId={item.id}
              name={item.name}
              labels={addToOrderLabels(locale, item.name)}
              priceCents={item.priceCents}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Ornamental print-menu rows: ruled centered heading, small round photo,
 *  name + description left, price right (Royal Sapphire, Garden Gold). */
function ListSection({
  cat,
  catIndex,
  locale,
  slug,
  ordering,
  showIcons,
  idPrefix,
  t,
}: SectionProps): React.ReactElement {
  return (
    <section
      aria-labelledby={`cat-${cat.id}`}
      className="scroll-mt-40 fade-in-up"
      style={{ animationDelay: `${catIndex * 60}ms` }}
    >
      <div className="mb-8 flex items-center gap-4">
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--menu-accent)]/50" />
        {cat.photoKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={menuImageUrl(cat.photoKey, cat.id, 160)}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="h-12 w-12 shrink-0 rounded-full border border-[var(--menu-accent)]/50 object-cover"
          />
        ) : showIcons ? (
          <CategoryIconMedallion name={cat.name} />
        ) : null}
        <h2
          id={`cat-${cat.id}`}
          className="text-center font-serif text-2xl uppercase tracking-[0.18em] text-[var(--menu-heading,var(--menu-accent))] sm:text-3xl"
        >
          {cat.name}
        </h2>
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--menu-accent)]/50" />
      </div>
      {cat.items.length === 0 ? (
        <p className="text-center text-sm text-[var(--menu-text)]/60">
          {t.emptyStates.noDishesInSection}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-14 gap-y-6 md:grid-cols-2">
          {cat.items.map((item, itemIndex) => (
            <li
              key={item.id}
              className="fade-in-up"
              style={{ animationDelay: `${catIndex * 60 + itemIndex * 25}ms` }}
            >
              <ListDishRow
                item={item}
                locale={locale}
                slug={slug}
                ordering={ordering}
                priority={catIndex === 0 && itemIndex === 0}
                idPrefix={idPrefix}
                t={t}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ListDishRow({
  item,
  locale,
  slug,
  ordering,
  priority,
  t,
  idPrefix,
}: DishProps): React.ReactElement {
  return (
    <article
      // The reveal script mutates class/style before hydration; React
      // must not warn about (or fight) those attribute differences.
      suppressHydrationWarning
      aria-labelledby={dishHeadingId(item.id, idPrefix)}
      className="dish-card text-[var(--menu-surface-text,var(--menu-text))] flex h-full items-stretch overflow-hidden rounded-lg border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] transition-all duration-300 hover:shadow-[0_16px_32px_-18px_rgba(0,0,0,0.35)]"
    >
      <div
        aria-hidden="true"
        className="relative m-2 aspect-square w-24 shrink-0 self-center overflow-hidden rounded-lg bg-[var(--menu-line)] sm:m-2.5 sm:w-28"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={menuImageUrl(item.photoKey, item.id, 320)}
          srcSet={menuImageSrcSet(item.photoKey, item.id, 320)}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute start-1.5 top-1.5 z-10 max-h-[calc(100%-0.75rem)] overflow-hidden">
          <PhotoDietBadges dietary={item.dietary} t={t} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col py-2.5 ps-1.5 pe-3 sm:py-3 sm:ps-2 sm:pe-4">
        <div className="flex items-start justify-between gap-3">
          <h3
            id={dishHeadingId(item.id, idPrefix)}
            className={
              item.isAvailable
                ? "font-serif text-lg leading-snug sm:text-xl"
                : "font-serif text-lg leading-snug text-[var(--menu-surface-text,var(--menu-text))]/60 line-through sm:text-xl"
            }
          >
            {item.name}
          </h3>
          <div className="hidden shrink-0 justify-end sm:flex">
            <BadgeRow
              allergens={item.allergens}
              traces={item.traces}
              spice={item.spice}
              dishName={item.name}
              t={t}
              locale={locale}
            />
          </div>
        </div>
        {item.description ? (
          <DishDescription
            text={item.description}
            dishName={item.name}
            labels={dishLabels(locale, item.name)}
            className="mt-1 text-sm leading-relaxed text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
          />
        ) : null}
        <MobileAllergenLine
          allergens={item.allergens}
          traces={item.traces}
          spice={item.spice}
          dishName={item.name}
          t={t}
          locale={locale}
        />
        {item.variants.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5 text-sm text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
            {item.variants.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between gap-3">
                <span>{v.name}</span>
                <span className="tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))]">
                  {v.priceDeltaCents >= 0 ? "+" : ""}
                  {formatPrice(v.priceDeltaCents, item.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <p
            aria-label={t.badges.price}
            className="whitespace-nowrap text-lg font-bold tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))] sm:text-xl"
          >
            {item.offer ? (
              <>
                <span className="me-1.5 rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-[var(--menu-surface)]">
                  {t.badges.offer}
                </span>
                <s className="me-1.5 text-[0.85em] font-normal opacity-55">
                  <span className="sr-only">{t.badges.regularPrice} </span>
                  {formatPrice(item.offer.basePriceCents, item.currency, locale)}
                </s>
                <span className="sr-only">{t.badges.offerPrice} </span>
              </>
            ) : null}
            {formatPrice(item.priceCents, item.currency, locale)}
          </p>
          {ordering && item.isAvailable ? (
            <AddToOrderButton
              slug={slug}
              itemId={item.id}
              name={item.name}
              labels={addToOrderLabels(locale, item.name)}
              priceCents={item.priceCents}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Chalkboard gallery: big round photos, no card boxes, price badge
 *  (Trattoria Chalk). */
function ShowcaseSection({
  cat,
  catIndex,
  locale,
  slug,
  ordering,
  showIcons,
  idPrefix,
  t,
}: SectionProps): React.ReactElement {
  return (
    <section
      aria-labelledby={`cat-${cat.id}`}
      className="scroll-mt-40 fade-in-up"
      style={{ animationDelay: `${catIndex * 60}ms` }}
    >
      <div className="mb-12 flex flex-col items-center text-center">
        {cat.photoKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={menuImageUrl(cat.photoKey, cat.id, 160)}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="mb-4 h-16 w-16 rounded-full border-2 border-[var(--menu-accent)]/50 object-cover"
          />
        ) : showIcons ? (
          <span className="mb-4">
            <CategoryIconMedallion name={cat.name} />
          </span>
        ) : null}
        <h2
          id={`cat-${cat.id}`}
          className="font-serif text-3xl italic leading-tight text-[var(--menu-heading,var(--menu-text))] sm:text-4xl md:text-5xl"
        >
          {cat.name}
        </h2>
        <span
          aria-hidden="true"
          className="mt-4 h-px w-24 bg-gradient-to-r from-transparent via-[var(--menu-accent)] to-transparent"
        />
      </div>
      {cat.items.length === 0 ? (
        <p className="text-center text-sm text-[var(--menu-text)]/60">
          {t.emptyStates.noDishesInSection}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 sm:gap-y-14 lg:grid-cols-3">
          {cat.items.map((item, itemIndex) => (
            <li
              key={item.id}
              className="fade-in-up"
              style={{ animationDelay: `${catIndex * 60 + itemIndex * 35}ms` }}
            >
              <ShowcaseDishCard
                item={item}
                locale={locale}
                slug={slug}
                ordering={ordering}
                priority={catIndex === 0 && itemIndex === 0}
                idPrefix={idPrefix}
                t={t}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ShowcaseDishCard({
  item,
  locale,
  slug,
  ordering,
  priority,
  t,
  idPrefix,
}: DishProps): React.ReactElement {
  const src = menuImageUrl(item.photoKey, item.id, 480);
  const srcSet = menuImageSrcSet(item.photoKey, item.id, 480);
  return (
    <article
      // The reveal script mutates class/style before hydration; React
      // must not warn about (or fight) those attribute differences.
      suppressHydrationWarning
      aria-labelledby={dishHeadingId(item.id, idPrefix)}
      className="dish-card text-[var(--menu-surface-text,var(--menu-text))] group flex h-full flex-col items-center text-center"
    >
      <div
        aria-hidden="true"
        className="relative mb-4 aspect-square w-32 overflow-hidden rounded-full border-2 border-[var(--menu-text)]/12 shadow-[0_18px_36px_-18px_rgba(0,0,0,0.6)] transition-transform duration-300 group-hover:scale-[1.03] sm:mb-5 sm:w-44"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          srcSet={srcSet}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute start-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-hidden">
          <PhotoDietBadges dietary={item.dietary} t={t} />
        </div>
      </div>
      <div className="flex w-full items-start justify-between gap-3 text-start">
        <h3
          id={dishHeadingId(item.id, idPrefix)}
          className={
            item.isAvailable
              ? "font-serif text-xl leading-snug sm:text-2xl"
              : "font-serif text-xl leading-snug text-[var(--menu-surface-text,var(--menu-text))]/60 line-through sm:text-2xl"
          }
        >
          {item.name}
        </h3>
        <div className="hidden shrink-0 justify-end pt-1 sm:flex">
          <BadgeRow
            allergens={item.allergens}
            traces={item.traces}
            spice={item.spice}
            dishName={item.name}
            t={t}
            locale={locale}
          />
        </div>
      </div>
      {item.description ? (
        <DishDescription
          text={item.description}
          dishName={item.name}
          labels={dishLabels(locale, item.name)}
          className="mt-1 max-w-xs text-xs leading-relaxed text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
        />
      ) : null}
      <MobileAllergenLine
        allergens={item.allergens}
        traces={item.traces}
        spice={item.spice}
        dishName={item.name}
        t={t}
        locale={locale}
      />
      {item.variants.length > 0 ? (
        <ul className="mt-1 w-full max-w-[220px] space-y-0.5 text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
          {item.variants.map((v) => (
            <li key={v.id} className="flex items-baseline justify-between gap-3">
              <span>{v.name}</span>
              <span className="tabular-nums">
                {v.priceDeltaCents >= 0 ? "+" : ""}
                {formatPrice(v.priceDeltaCents, item.currency, locale)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex w-full items-center justify-between gap-3 pt-3">
        <p
          aria-label={t.badges.price}
          className="inline-block rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))]/14 px-4 py-1 text-base font-bold tabular-nums text-[var(--menu-surface-text,var(--menu-text))]"
        >
          {item.offer ? (
            <>
              <span className="me-1.5 rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-[var(--menu-surface)]">
                {t.badges.offer}
              </span>
              <s className="me-1.5 text-[0.85em] font-normal opacity-55">
                <span className="sr-only">{t.badges.regularPrice} </span>
                {formatPrice(item.offer.basePriceCents, item.currency, locale)}
              </s>
              <span className="sr-only">{t.badges.offerPrice} </span>
            </>
          ) : null}
          {formatPrice(item.priceCents, item.currency, locale)}
        </p>
        {ordering && item.isAvailable ? (
          <AddToOrderButton
            slug={slug}
            itemId={item.id}
            name={item.name}
            labels={addToOrderLabels(locale, item.name)}
            priceCents={item.priceCents}
          />
        ) : null}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Sticky top bar — venue mark + category tabs + diet tabs             */
/* ------------------------------------------------------------------ */

/** Fallback shape for a banner whose upload predates the `media` row we
 *  read the real proportions from: 16:7, the ratio the old fixed-height
 *  box came closest to at desktop width. */
const FALLBACK_BANNER_RATIO = 16 / 7;

/** `aspect-ratio` value for the hero, as a string so React writes the
 *  custom property verbatim instead of guessing a unit. */
function heroRatio(aspect: number | null | undefined): string {
  return String(aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : FALLBACK_BANNER_RATIO);
}

/** Banner hero: the owner's wide image as the page top, identity
 *  overlaid — logo + name bottom-left on a scrim; and top-right the badge
 *  stack, open/closed → reserve → rating → get-the-app. The sticky bar
 *  below carries only menu controls. */
function HeroBanner({
  venue,
  rating,
  openNow,
  reserve,
  hasApp = false,
  t,
  locale,
}: {
  venue: PublicMenu["venue"];
  /** P7-14 — the rating pill in the top-corner badge stack, under the
   *  reserve button. Only a page WITH a banner gets it here; without one
   *  the sticky bar's cluster carries it instead. */
  rating?: PublicMenu["rating"];
  openNow?: OpenState;
  reserve?: { slug: string; hours: OpeningHours; timezone: string };
  /** True once the owner has published at least one app link — the jump
   *  link renders only then, because it would otherwise scroll a guest to
   *  a footer section that isn't there. */
  hasApp?: boolean;
  t: MenuCopy;
  locale: string;
}): React.ReactElement {
  return (
    /* The banner spans the FULL page width at every breakpoint — no
       centred max-width box, no page background showing down either
       side. Its HEIGHT comes from the upload's own proportions:
       `aspect-ratio` set from the media row's width/height (16:7 when we
       do not know them) reserves the exact box before a byte arrives, so
       CLS stays 0 with no width/height guess.

       `max-h-[78vh]` is the only cap, so a tall or square upload cannot
       eat a whole 1900px-wide screen. Below the cap the box matches the
       photo's ratio exactly and `object-cover` therefore shows the whole
       image — identical to `contain`, which is what keeps a headline
       baked into the artwork (Rangla's reads "Indian & Pakistani
       Restaurant" across the top) uncropped. Only once the cap bites
       does `object-cover object-center` trim — evenly off the top and
       bottom, the banner staying full width — which is still better
       than two letterbox bars across the top of the page. */
    <div
      className="relative max-h-[78vh] w-full bg-[var(--menu-surface)]"
      style={
        {
          "--hero-ratio": heroRatio(venue.branding.bannerAspect),
          aspectRatio: "var(--hero-ratio)",
        } as React.CSSProperties
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={uploadedImageUrl(venue.branding.bannerKey!, 1920)}
        // Full-bleed at every breakpoint, so width descriptors — a phone
        // takes the 640px render instead of the 1920px desktop one.
        srcSet={bannerSrcSet(venue.branding.bannerKey!)}
        sizes="100vw"
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-black/30"
      />
      {/* Badge stack, top corner: open/closed, then reserve, then the
          rating, then the app jump. P7-14 — the rating pill hangs off the
          reserve button rather than the identity, which keeps the
          bottom-left to one job (who this restaurant is) and puts the
          social proof where a guest is already deciding whether to book. */}
      <div className="absolute end-4 top-4 flex flex-col items-end gap-2 sm:end-6">
        <OpenBadge state={openNow} t={t} locale={locale} />
        {reserve ? (
          <ReserveDialog {...reserve} locale={locale} labels={reserveLabels(locale)} />
        ) : null}
        {/* Directly after Reserve, before the rating: the two are the
            same kind of thing — something the guest DOES about this
            restaurant — and the app's home screen already pairs them. */}
        <ComplaintLink slug={venue.slug} labels={t.complaint} onDark />
        {rating ? <RatingLine rating={rating} locale={locale} t={t} onDark /> : null}
        {hasApp ? <AppJumpLink t={t} onDark /> : null}
      </div>
      <div className="absolute bottom-4 start-4 flex items-center gap-3 sm:bottom-5 sm:start-6 lg:start-12">
        {/* `showName={false}`: the big white serif below IS the name here,
            so the mark contributes the logo only and the venue is not
            written twice on the same scrim. */}
        <VenueMark venue={venue} showName={false} />
        <div className="min-w-0">
          <span className="block font-serif text-2xl italic text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] sm:text-3xl">
            {venue.name}
          </span>
        </div>
      </div>
    </div>
  );
}

function StickyBar({
  venue,
  rating,
  categories,
  activeCategoryId,
  offersLabel,
  activeDiet,
  showIcons,
  offeredDiets,
  openNow,
  reserve,
  hasApp = false,
  sideNav = false,
  hero = false,
  t,
  locale,
}: {
  venue: PublicMenu["venue"];
  /** P7-14 — the rating pill in the right-corner badge cluster, but only
   *  on a page with no banner hero; with a banner the hero's own stack
   *  carries it. Exactly one of the two renders on any given page. */
  rating?: PublicMenu["rating"];
  categories: { id: string; name: string }[];
  activeCategoryId: string | null;
  /** Translated "Offers" tab label, or null when the venue has no live
   *  offer — the synthetic tab then never renders. */
  offersLabel: string | null;
  activeDiet: string | null;
  showIcons: boolean;
  offeredDiets: string[];
  openNow?: OpenState;
  reserve?: { slug: string; hours: OpeningHours; timezone: string };
  /** See `HeroBanner` — the jump link is only ever offered when there is
   *  something at the other end of it. */
  hasApp?: boolean;
  sideNav?: boolean;
  /** Banner hero above carries logo + open pill — this bar then holds
   *  only the menu controls (categories + diets), grouped together. */
  hero?: boolean;
  t: MenuCopy;
  locale: string;
}): React.ReactElement {
  return (
    <header className="menu-hero sticky top-0 z-20 border-b border-[var(--menu-text)]/10 bg-[var(--menu-bg)]/95 backdrop-blur">
      {hero ? (
        /* Identity + pill live on the hero above; this row keeps only
           the desktop category tabs (side rail replaces them on lg). */
        !sideNav ? (
          <div className="mx-auto hidden max-w-none px-4 py-3 sm:px-6 lg:block lg:px-12">
            <CategoryTabs
              categories={categories}
              offersLabel={offersLabel}
              active={activeCategoryId}
              activeDiet={activeDiet}
              showIcons={showIcons}
              t={t}
            />
          </div>
        ) : null
      ) : (
        <div className="mx-auto flex min-h-[3.5rem] max-w-none items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:min-h-0 lg:px-12">
          {/* Logo + restaurant name, leading edge at every width (right
              of the bar under dir="rtl"). */}
          <VenueMark venue={venue} />
          {/* Category tabs: desktop only, fill the middle — unless the
              owner chose the side rail, which replaces them on lg+. */}
          <div className={`min-w-0 flex-1 lg:px-6 ${sideNav ? "hidden" : "hidden lg:block"}`}>
            <CategoryTabs
              categories={categories}
              offersLabel={offersLabel}
              active={activeCategoryId}
              activeDiet={activeDiet}
              showIcons={showIcons}
              t={t}
            />
          </div>
          {/* Open/closed pill + reserve button + rating + app jump: right
              corner at every width. Same order as the hero's stack, so a
              venue with a banner and one without put the badges in the
              same places. */}
          <div className="flex shrink-0 items-center gap-2">
            <OpenBadge state={openNow} t={t} locale={locale} />
            {reserve ? (
              <ReserveDialog {...reserve} locale={locale} labels={reserveLabels(locale)} />
            ) : null}
            <ComplaintLink slug={venue.slug} labels={t.complaint} />
            {rating ? <RatingLine rating={rating} locale={locale} t={t} /> : null}
            {hasApp ? <AppJumpLink t={t} /> : null}
          </div>
        </div>
      )}
      {/* Categories on a second row on tablet/mobile (hidden above on lg) */}
      <div className="border-t border-[var(--menu-text)]/10 lg:hidden">
        <div className="mx-auto max-w-none px-4 py-2.5 sm:px-6 sm:py-3">
          <CategoryTabs
            categories={categories}
            offersLabel={offersLabel}
            active={activeCategoryId}
            activeDiet={activeDiet}
            showIcons={showIcons}
            t={t}
          />
        </div>
      </div>
      <div className="border-t border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)]">
        <div className="mx-auto max-w-none px-4 py-2.5 sm:px-6 sm:py-3 lg:px-12">
          <DietTabs
            active={activeDiet}
            activeCategorySlug={
              activeCategoryId ? catSlug(categorySlugs(categories), activeCategoryId) : null
            }
            offeredDiets={offeredDiets}
            t={t}
          />
        </div>
      </div>
    </header>
  );
}

/**
 * Compact "📱 App" link in the header.
 *
 * A plain in-page anchor to the footer's `#get-the-app` section — the
 * browser scrolls to it with no JavaScript, which is the contract for
 * every public page here, and `scroll-behavior` is left to the user's own
 * `prefers-reduced-motion` setting rather than forced smooth.
 *
 * A jump rather than a dropdown of three store links because the header
 * shares a 320px row with the open pill and the reserve button: one word
 * and an emoji is all the room there is, and the footer section it lands
 * on can afford the badges, the blurb and the install warning.
 *
 * The emoji is `aria-hidden` and the anchor carries its own label, so a
 * screen reader hears "Get the app — jump to the download links", not
 * "mobile phone App".
 */
function AppJumpLink({ t, onDark = false }: { t: MenuCopy; onDark?: boolean }): React.ReactElement {
  return (
    <a
      href="#get-the-app"
      aria-label={t.app.navAria}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium no-underline ${
        onDark
          ? "border-white/40 bg-black/45 text-white backdrop-blur"
          : "border-[var(--menu-text)]/25 text-[var(--menu-text)]/85 hover:border-[var(--menu-text)]/50"
      }`}
    >
      <span aria-hidden="true">📱</span>
      {t.app.navLabel}
    </a>
  );
}

/** Live open/closed pill in the top bar. Silent when hours are unset —
 *  never shows a misleading "Closed" for a venue that hasn't entered
 *  hours. Positive/negative use the theme's own tokens. */
function OpenBadge({
  state,
  t,
  locale,
}: {
  state?: OpenState;
  t: MenuCopy;
  locale: string;
}): React.ReactElement | null {
  if (!state || !state.configured) return null;

  // Compact on phones (dot + word), full detail from sm up — so the pill
  // never crowds the centred logo on a narrow screen. `whitespace-nowrap`
  // keeps it on one line; it sits in the top-right corner at every width.
  // Both pills sit on the PAGE ground, so they wash page ink and label in page
  // ink. The status hue lives in the fill and the dot, never in the 12px words:
  // `positive` and `danger` are guaranteed against a surface at 3:1, not 4.5:1,
  // so `text-[var(--menu-positive)]` at this size was short of AA on the themes
  // where positive is a pale mint. The dots were hard-coded #22c55e / #ef4444,
  // which ignored the theme entirely.
  if (state.open) {
    return (
      <span className="z-10 flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--menu-positive)]/14 py-1.5 ps-2.5 pe-3 text-xs font-semibold text-[var(--menu-text)]">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--menu-positive)] ring-4 ring-[var(--menu-positive)]/25"
        />
        {t.badges.open}
        <span className="hidden font-medium opacity-80 sm:inline">
          · {t.badges.until(state.until)}
        </span>
      </span>
    );
  }
  const opensLabel =
    state.opensDay && state.opensAt
      ? t.badges.opensAt(shortWeekday(state.opensDay, locale), state.opensAt)
      : "";
  return (
    <span className="z-10 flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--menu-danger)]/12 py-1.5 ps-2.5 pe-3 text-xs font-semibold text-[var(--menu-text)]">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--menu-danger)] ring-4 ring-[var(--menu-danger)]/25"
      />
      {t.badges.closed}
      {opensLabel ? (
        <span className="hidden font-medium opacity-80 sm:inline">· {opensLabel}</span>
      ) : null}
    </span>
  );
}

/**
 * Logo + restaurant name, the venue's identity as the sticky bar carries
 * it. The rating is NOT part of this any more — it lives in the top-corner
 * badge stack beside the reserve button (see `RatingLine`).
 */
function VenueMark({
  venue,
  showName = true,
}: {
  venue: PublicMenu["venue"];
  /** The banner hero prints the venue name itself, in its own large white
   *  serif — so it asks for the logo alone and the name is not set twice
   *  on the same scrim. Everywhere else the mark is the name. */
  showName?: boolean;
}): React.ReactElement {
  // Top bar leads with the logo + restaurant name, so the venue's identity
  // stays visible as the guest scrolls. The name truncates on narrow
  // screens so it never crowds the open/closed pill.
  const logoSrc = venue.branding.logoKey
    ? menuImageUrl(venue.branding.logoKey, venue.id, 96)
    : "/brand/logo-192.png";
  return (
    <div className="flex min-w-0 shrink items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoSrc}
        alt=""
        width={44}
        height={44}
        className={`shrink-0 ${venue.branding.logoKey ? "h-11 w-11 rounded-full object-cover" : "h-11 w-11"}`}
      />
      {showName ? (
        <div className="min-w-0">
          <span className="block min-w-0 truncate font-serif text-lg italic leading-tight text-[var(--menu-text)]">
            {venue.name}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dish card — full-width tile with gradient photo + gold accents      */
/* ------------------------------------------------------------------ */

function DishCard({
  item,
  locale,
  slug,
  ordering,
  priority,
  t,
  idPrefix,
}: DishProps): React.ReactElement {
  return (
    <article
      // The reveal script mutates class/style before hydration; React
      // must not warn about (or fight) those attribute differences.
      suppressHydrationWarning
      aria-labelledby={dishHeadingId(item.id, idPrefix)}
      className="dish-card text-[var(--menu-surface-text,var(--menu-text))] group relative grid grid-cols-[minmax(0,104px)_1fr] gap-4 overflow-hidden rounded-md border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] p-3 transition-all duration-300 hover:shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)] sm:grid-cols-[minmax(0,180px)_1fr] sm:gap-5"
    >
      <div className="relative self-stretch">
        <DishPhoto item={item} priority={priority} />
        <div className="absolute start-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-hidden">
          <PhotoDietBadges dietary={item.dietary} t={t} />
        </div>
      </div>
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <h3
            id={dishHeadingId(item.id, idPrefix)}
            className={
              item.isAvailable
                ? "font-serif text-lg leading-tight text-[var(--menu-surface-text,var(--menu-text))] sm:text-xl"
                : "font-serif text-lg leading-tight text-[var(--menu-surface-text,var(--menu-text))]/60 line-through sm:text-xl"
            }
          >
            {item.name}
            {!item.isAvailable ? (
              <span className="ms-2 align-middle text-[9px] uppercase tracking-widest text-[var(--menu-surface-text-soft,var(--menu-text-soft))] no-underline">
                {t.badges.unavailable}
              </span>
            ) : null}
          </h3>
          <div className="hidden shrink-0 justify-end sm:flex">
            <BadgeRow
              allergens={item.allergens}
              traces={item.traces}
              spice={item.spice}
              dishName={item.name}
              t={t}
              locale={locale}
            />
          </div>
        </div>
        {item.description ? (
          <DishDescription
            text={item.description}
            dishName={item.name}
            labels={dishLabels(locale, item.name)}
            className="mt-1 text-sm leading-relaxed text-[var(--menu-surface-text,var(--menu-text))]"
          />
        ) : null}
        <MobileAllergenLine
          allergens={item.allergens}
          traces={item.traces}
          spice={item.spice}
          dishName={item.name}
          t={t}
          locale={locale}
        />
        {item.variants.length > 0 ? (
          <ul className="mt-2 space-y-0.5 text-xs text-[var(--menu-surface-text,var(--menu-text))]">
            {item.variants.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between gap-3">
                <span>{v.name}</span>
                <span className="tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))]">
                  {v.priceDeltaCents >= 0 ? "+" : ""}
                  {formatPrice(v.priceDeltaCents, item.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <p
            aria-label={t.badges.price}
            className="whitespace-nowrap text-lg font-bold tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))] sm:text-xl"
          >
            {item.offer ? (
              <>
                <span className="me-1.5 rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-[var(--menu-surface)]">
                  {t.badges.offer}
                </span>
                <s className="me-1.5 text-[0.85em] font-normal opacity-55">
                  <span className="sr-only">{t.badges.regularPrice} </span>
                  {formatPrice(item.offer.basePriceCents, item.currency, locale)}
                </s>
                <span className="sr-only">{t.badges.offerPrice} </span>
              </>
            ) : null}
            {formatPrice(item.priceCents, item.currency, locale)}
          </p>
          {ordering && item.isAvailable ? (
            <AddToOrderButton
              slug={slug}
              itemId={item.id}
              name={item.name}
              labels={addToOrderLabels(locale, item.name)}
              priceCents={item.priceCents}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function DishPhoto({
  item,
  priority,
}: {
  item: PublicMenu["categories"][number]["items"][number];
  priority?: boolean;
}): React.ReactElement {
  // Uploaded photo (resized via /img) or a stable styled default from
  // /public — same dish, same picture, on every visit.
  const src = menuImageUrl(item.photoKey, item.id, 480);
  const srcSet = menuImageSrcSet(item.photoKey, item.id, 480);
  return (
    <div
      aria-hidden="true"
      className="dish-photo relative flex h-full min-h-[120px] items-center justify-center overflow-hidden rounded-sm bg-[var(--menu-line)] sm:min-h-[150px]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        srcSet={srcSet}
        alt=""
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Subtle shine sweep on hover — pure CSS. */}
      <span
        aria-hidden="true"
        className="dish-shine pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Category + diet tabs                                                */
/* ------------------------------------------------------------------ */

/** Sticky left category rail (lg+ only) — the owner's alternative to
 *  the top tabs for long menus. Same filter links, vertical layout. */
function SideRail({
  categories,
  active,
  offersLabel,
  activeDiet,
  showIcons,
  t,
}: {
  categories: { id: string; name: string }[];
  active: string | null;
  /** Translated "Offers" label, or null when there is nothing on offer. */
  offersLabel: string | null;
  activeDiet: string | null;
  showIcons: boolean;
  t: MenuCopy;
}): React.ReactElement {
  const dietQs = activeDiet ? `&diet=${activeDiet}` : "";
  const slugOf = categorySlugs(categories);
  // Offers lead the rail — a destination, not a category. Real category
  // slugs are computed from the real list above, so adding it can never
  // renumber an existing `?cat=` URL.
  const railCategories = offersLabel
    ? [{ id: OFFERS_CATEGORY_ID, name: offersLabel }, ...categories]
    : categories;
  // Modern rail: a soft translucent surface so the labels are readable
  // over ANY artwork/gradient; the active category is the app's red
  // bubble with the sharp bottom-right corner.
  const linkBase = "block rounded-xl px-3.5 py-2 text-[13px] leading-snug transition-colors";
  const railActive =
    "bg-[var(--menu-surface-accent,var(--menu-accent))] font-semibold text-[var(--menu-surface,#fffdf8)] [border-end-end-radius:3px]";
  const railIdle =
    "text-[var(--menu-surface-text,var(--menu-text))]/80 hover:bg-[var(--menu-surface-accent,var(--menu-accent))]/10 hover:text-[var(--menu-surface-accent,var(--menu-accent))]";
  return (
    <aside className="hidden lg:block">
      <nav
        aria-label={t.nav.categories}
        className="sticky top-32 max-h-[calc(100vh-10rem)] overflow-y-auto rounded-2xl bg-[var(--menu-surface)]/85 p-2 shadow-[0_2px_16px_rgba(0,0,0,0.08)] backdrop-blur-sm [scrollbar-width:thin]"
      >
        <ul className="space-y-0.5">
          <li>
            <CategoryLink
              id={null}
              slug={null}
              href={`/${activeDiet ? `?diet=${activeDiet}` : ""}`}
              initialActive={active}
              activeClass={`${linkBase} ${railActive}`}
              idleClass={`${linkBase} ${railIdle}`}
            >
              {t.nav.all}
            </CategoryLink>
          </li>
          {railCategories.map((c) => (
            <li key={c.id}>
              <CategoryLink
                id={c.id}
                slug={catSlug(slugOf, c.id)}
                href={`/?cat=${catSlug(slugOf, c.id)}${dietQs}`}
                initialActive={active}
                activeClass={`${linkBase} ${railActive}`}
                idleClass={`${linkBase} ${railIdle}`}
              >
                {showIcons ? (
                  <span aria-hidden="true" className="me-1.5 text-sm normal-case tracking-normal">
                    {c.id === OFFERS_CATEGORY_ID ? OFFERS_ICON : categoryIcon(c.name)}
                  </span>
                ) : null}
                {c.name}
              </CategoryLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

function CategoryTabs({
  categories,
  active,
  offersLabel,
  activeDiet,
  showIcons,
  t,
}: {
  categories: { id: string; name: string }[];
  active: string | null;
  /** Translated "Offers" label, or null when there is nothing on offer. */
  offersLabel: string | null;
  activeDiet: string | null;
  showIcons: boolean;
  t: MenuCopy;
}): React.ReactElement | null {
  const slugOf = categorySlugs(categories);
  // "Offers" leads the rail when the venue has a live offer. Its slug and
  // icon are fixed here on the server; the real categories keep the slugs
  // they have always had.
  const railCategories = offersLabel
    ? [{ id: OFFERS_CATEGORY_ID, name: offersLabel }, ...categories]
    : categories;
  return (
    <CategoryTabsClient
      categories={railCategories}
      slugs={Object.fromEntries(railCategories.map((c) => [c.id, catSlug(slugOf, c.id)]))}
      icons={Object.fromEntries(
        railCategories.map((c) => [
          c.id,
          c.id === OFFERS_CATEGORY_ID ? OFFERS_ICON : categoryIcon(c.name),
        ]),
      )}
      active={active}
      activeDiet={activeDiet}
      showIcons={showIcons}
      /* The rail is a client component but the catalogue stays on the
         server: it takes the two strings it renders, not the locale. */
      navLabel={t.nav.categories}
      allLabel={t.nav.all}
    />
  );
}

function DietTabs({
  active,
  activeCategorySlug,
  offeredDiets,
  t,
}: {
  active: string | null;
  activeCategorySlug: string | null;
  offeredDiets: string[];
  t: MenuCopy;
}): React.ReactElement {
  const catQs = activeCategorySlug ? `cat=${activeCategorySlug}` : "";
  const buildHref = (diet: string | null): string => {
    const parts: string[] = [];
    if (catQs) parts.push(catQs);
    if (diet) parts.push(`diet=${diet}`);
    return parts.length > 0 ? `/?${parts.join("&")}` : `/`;
  };
  return (
    /* `data-diet-filter` is the hook category-tabs.tsx rewrites these
       hrefs through — the aria-label is translated and must never be a
       selector. */
    <nav
      data-diet-filter=""
      aria-label={t.nav.dietaryFilter}
      className="-mx-1 w-full overflow-x-auto"
    >
      <ul className="mx-auto flex w-max min-w-max items-center gap-1 px-1 text-[10px] uppercase tracking-[0.28em]">
        <li>
          <TabLink href={buildHref(null)} active={active === null} variant="secondary">
            {t.nav.allDiets}
          </TabLink>
        </li>
        {offeredDiets.map((d) => (
          <li key={d}>
            <TabLink href={buildHref(d)} active={active === d} variant="secondary">
              <span
                aria-hidden="true"
                className="relative me-1 inline-block normal-case tracking-normal"
              >
                {DIET_META[d]?.icon}
                {DIET_META[d]?.crossed ? (
                  <span className="absolute left-1/2 top-1/2 h-[1.5px] w-[1.4em] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current opacity-90" />
                ) : null}
              </span>
              {dietLabel(t, d)}
            </TabLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Allergen/dietary badge row                                          */
/* ------------------------------------------------------------------ */

function BadgeRow({
  allergens,
  traces,
  spice = 0,
  dishName,
  t,
  locale,
}: {
  allergens: string[];
  traces: string[];
  spice?: number;
  dishName: string;
  t: MenuCopy;
  locale: string;
}): React.ReactElement | null {
  if (allergens.length === 0 && traces.length === 0 && spice === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm leading-none">
      {/* Diet icons live on the photo at every width — this row keeps
          only spice + the allergen popup, so nothing shows twice. */}
      {spice > 0 ? (
        <span
          title={t.badges.spicyTitle(Math.min(spice, 3))}
          className="inline-flex h-6 items-center justify-center rounded-full bg-[var(--menu-danger)]/12 px-1.5 tracking-tighter"
        >
          <span aria-hidden="true">{"🌶".repeat(Math.min(spice, 3))}</span>
          <span className="sr-only">{t.badges.spicyLevel(Math.min(spice, 3))}</span>
        </span>
      ) : null}
      <AllergenDialog
        allergens={allergens}
        traces={traces}
        dishName={dishName}
        lang={uiLocale(locale)}
        labels={allergenLabels(locale, dishName)}
      />
    </div>
  );
}

/** Icon chips overlaid on the dish photo — every device. Stacked
 *  VERTICALLY so a long list never spills past the photo's edge; the
 *  wrapper clips at the photo boundary. */
function PhotoDietBadges({
  dietary,
  t,
}: {
  dietary: string[];
  t: MenuCopy;
}): React.ReactElement | null {
  const known = dietary.filter((d) => DIET_META[d]);
  if (known.length === 0) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      {known.map((d) => (
        <span
          key={d}
          title={dietLabel(t, d)}
          className={`rounded-full bg-black/60 px-1.5 py-0.5 backdrop-blur-sm ${
            d === "halal" ? "text-[9px] font-bold text-emerald-200" : "text-[11px] leading-none"
          }`}
        >
          <span aria-hidden="true" className="relative inline-block">
            {DIET_META[d]!.icon}
            {DIET_META[d]!.crossed ? (
              <span className="absolute left-1/2 top-1/2 h-[1.5px] w-[1.4em] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current opacity-90" />
            ) : null}
          </span>
          <span className="sr-only">{dietLabel(t, d)}</span>
        </span>
      ))}
    </div>
  );
}

/** Mobile-only: spice + the ⚠ allergen popup on their own compact row
 *  (diet icons already sit on the photo). */
function MobileAllergenLine({
  allergens,
  traces,
  spice = 0,
  dishName,
  t,
  locale,
}: {
  allergens: string[];
  traces: string[];
  spice?: number;
  dishName: string;
  t: MenuCopy;
  locale: string;
}): React.ReactElement | null {
  if (allergens.length === 0 && traces.length === 0 && spice === 0) return null;
  return (
    <div className="mt-1 flex items-center gap-1 sm:hidden">
      {spice > 0 ? (
        <span
          title={t.badges.spicyTitle(Math.min(spice, 3))}
          className="inline-flex h-6 items-center rounded-full bg-[var(--menu-danger)]/12 px-1.5 text-sm leading-none tracking-tighter"
        >
          <span aria-hidden="true">{"🌶".repeat(Math.min(spice, 3))}</span>
          <span className="sr-only">{t.badges.spicyLevel(Math.min(spice, 3))}</span>
        </span>
      ) : null}
      <AllergenDialog
        allergens={allergens}
        traces={traces}
        dishName={dishName}
        lang={uiLocale(locale)}
        labels={allergenLabels(locale, dishName)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Locale switcher                                                     */
/* ------------------------------------------------------------------ */

// Flag + native name per menu language, straight off the ONE registry.
// Flags stand for the language, not a country — an imperfect but
// universally understood convention.
const LOCALE_META = new Map<string, { flag: string; label: string }>(
  LOCALES.map((l) => [l.code as string, { flag: l.flag as string, label: l.label as string }]),
);

function localeMeta(code: string): { flag: string; label: string } {
  return (
    LOCALE_META.get(code.slice(0, 2).toLowerCase()) ?? { flag: "🌐", label: code.toUpperCase() }
  );
}

interface ContactRow {
  key: "landline" | "mobile" | "whatsapp";
  label: string;
  display: string;
  href: string;
  aria: string;
}

/** One filled circle per contact kind, so the three rows are told apart
 *  at a glance rather than by reading the number: WhatsApp's own green,
 *  a blue for the landline, an amber for the mobile. Solid fills with a
 *  white glyph, which clears 4.5:1 on both the dark-red surface and the
 *  light one — the colour is decoration, never the only cue, since the
 *  anchor's `aria-label` still names the line. A kind we do not know
 *  keeps the neutral translucent disc. */
const CONTACT_ICON_SKIN: Record<ContactRow["key"], string> = {
  landline: "bg-[#2563EB] text-white",
  mobile: "bg-[#F59E0B] text-white",
  whatsapp: "bg-[#25D366] text-white",
};

const CONTACT_ICON_NEUTRAL = "bg-[var(--menu-surface-text,var(--menu-text))]/10";

/** Leading glyph for a footer contact row. Our own geometry rather than
 *  any messenger's logo — the row already says "WhatsApp" in words, and a
 *  re-drawn brand mark is the one thing worse than none. `aria-hidden`:
 *  the anchor carries the accessible name. */
function ContactIcon({ kind }: { kind: ContactRow["key"] }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
        CONTACT_ICON_SKIN[kind] ?? CONTACT_ICON_NEUTRAL
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        {kind === "landline" ? (
          <path d="M5 4h3l1.5 4-2 1.3a12 12 0 0 0 6 6l1.3-2 4 1.5V19a1 1 0 0 1-1.1 1A15 15 0 0 1 4 5.1 1 1 0 0 1 5 4Z" />
        ) : kind === "mobile" ? (
          <>
            <rect x="7" y="2.6" width="10" height="18.8" rx="2.4" />
            <path d="M10.6 18.4h2.8" />
          </>
        ) : (
          <>
            <path d="M20 11.6a7.6 7.6 0 0 1-11.1 6.8L4.4 19.6l1.3-4.4A7.6 7.6 0 1 1 20 11.6Z" />
            <path d="M9.4 9.1c.3 1 .8 1.9 1.6 2.7.8.8 1.7 1.3 2.7 1.6" />
          </>
        )}
      </svg>
    </span>
  );
}

/** Flag dropdown built on <details> — opens upward from the footer and
 *  needs no JavaScript. The current language is the summary; the others
 *  are plain links. */
function LocaleSwitcher({
  current,
  enabled,
  activeDiet,
  t,
}: {
  current: string;
  enabled: string[];
  /** Carried across the language switch — the locale route parses
   *  `?diet=`, so the guest keeps the filter they came with. `?cat=` is
   *  deliberately dropped: the locale route does not read it. */
  activeDiet: string | null;
  t: MenuCopy;
}): React.ReactElement | null {
  if (enabled.length < 2) return null;
  const active = localeMeta(current);
  const dietQs = activeDiet ? `?diet=${activeDiet}` : "";
  return (
    <nav aria-label={t.nav.language} className="relative w-fit">
      <details className="group relative">
        <summary
          aria-current="true"
          /* In the footer, so surface ink — it was page ink on the surface
             ground. Wash instead of a border, and the hover raises the wash
             rather than drawing an accent edge. */
          className="flex cursor-pointer list-none items-center gap-2 rounded-full bg-[var(--menu-surface-text,var(--menu-text))]/7 px-3.5 py-1.5 text-xs font-medium text-[var(--menu-surface-text,var(--menu-text))] transition-colors hover:bg-[var(--menu-surface-text,var(--menu-text))]/13 [&::-webkit-details-marker]:hidden"
        >
          <span aria-hidden="true" className="text-base leading-none">
            {active.flag}
          </span>
          <span>{active.label}</span>
          <span
            aria-hidden="true"
            className="text-[9px] text-[var(--menu-text-soft)] transition-transform group-open:rotate-180"
          >
            ▲
          </span>
        </summary>
        {/* A DIV of links, not a <ul>: the panel lives in the DOM even
            while the <details> is shut, and a list whose every label sits
            inside a nested <a> reads as a run of empty bullets to anything
            that walks the DOM instead of the pixels — which is exactly what
            the old footer showed as "* * * * * *". A labelled <nav> full of
            links says the same thing with nothing left over. */}
        <div className="absolute bottom-full start-0 z-30 mb-2 w-44 overflow-hidden rounded-xl border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] py-1 shadow-[0_18px_36px_-12px_rgba(0,0,0,0.45)]">
          {enabled.map((l) => {
            const meta = localeMeta(l);
            return l === current ? (
              <span
                key={l}
                aria-current="true"
                className="flex items-center gap-2.5 bg-[var(--menu-surface-accent,var(--menu-accent))]/14 px-3.5 py-2 text-xs font-semibold text-[var(--menu-surface-text,var(--menu-text))]"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {meta.flag}
                </span>
                {meta.label}
                <span aria-hidden="true" className="ms-auto">
                  ✓
                </span>
              </span>
            ) : (
              <a
                key={l}
                href={`/${l}${dietQs}`}
                hrefLang={l}
                className="flex items-center gap-2.5 px-3.5 py-2 text-xs text-[var(--menu-surface-text,var(--menu-text))] transition-colors hover:bg-[var(--menu-surface-text,var(--menu-text))]/10"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {meta.flag}
                </span>
                {meta.label}
              </a>
            );
          })}
        </div>
      </details>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Inline CSS animations                                               */
/* ------------------------------------------------------------------ */

const ANIMATION_CSS = `
  /* Only translate — never fade — so text renders at full opacity from
     the first paint. An earlier version animated opacity 0→1 and axe
     snapshotted mid-animation, mis-reading every price + heading as a
     dim mid-tone gold. Sliding up 12px keeps the "arrive" feel without
     compromising the contrast measurement or the WCAG AA guarantee. */
  @keyframes menu-slide-up {
    from { transform: translate3d(0, 12px, 0); }
    to   { transform: translate3d(0, 0, 0); }
  }
  @keyframes menu-shine {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  .menu-theme .fade-in-up {
    animation: menu-slide-up 480ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
  }
  .menu-theme .dish-card:hover .dish-shine {
    animation: menu-shine 900ms ease-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .menu-theme .fade-in-up,
    .menu-theme .dish-card:hover .dish-shine {
      animation: none !important;
    }
  }
  /* The tab rails scroll horizontally on overflow; the OS scrollbar
     reads as a stray white bar on dark themes. Hide it — the rail stays
     wheel-, touch-, and keyboard-scrollable. */
  .menu-theme .overflow-x-auto {
    scrollbar-width: none;
  }
  .menu-theme .overflow-x-auto::-webkit-scrollbar {
    display: none;
  }
`;
