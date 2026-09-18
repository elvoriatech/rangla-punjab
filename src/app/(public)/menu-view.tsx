import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { ReserveDialog } from "./reserve-dialog";
import { formatPrice, siteUrl, type PublicMenu } from "@/lib/public-menu";
import { buildRestaurantJsonLd, jsonLdString } from "@/lib/structured-data";
import { DIETARY_VALUES, HALAL_DIET, categorySlugs } from "@/lib/dietary-filter";
import { menuThemeStyle, resolveMenuTheme } from "@/lib/menu-themes";
import { categoryIcon } from "@/lib/category-icons";
import { menuImageSrcSet, menuImageUrl, TRANSPARENT_PIXEL } from "@/lib/menu-images";
import type { EffectiveOrdering } from "@/lib/ordering-config";
import type { OpeningHours, OpenState } from "@/lib/opening-hours";
import { PAYMENT_METHODS } from "@/lib/ordering-config";
import {
  siAmericanexpress,
  siApplepay,
  siGooglepay,
  siMastercard,
  siPaypal,
  siVisa,
} from "simple-icons";
import { WEEKDAY_LABELS } from "@/lib/opening-hours";
import { bannerSrcSet, uploadedImageUrl } from "@/lib/menu-images";
import { AddToOrderButton } from "./order/add-button";
import { CartDrawer } from "./order/cart-lazy";
import { AllergenDialog } from "./allergen-dialog";
import { DishDescription } from "./dish-description";
import { CategoryLink, CategoryTabs as CategoryTabsClient, TabLink } from "./category-tabs";

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
 *   - <nav aria-label="Categories"> and <nav aria-label="Dietary
 *     filter"> land in the sticky top bar
 *   - Tab links carry aria-current="page" on the active one
 *   - Dish placeholder image is aria-hidden — screen-readers get the
 *     name + description + allergens as-is
 *   - No focus-trap in a hidden form (the P1-25 axe gate caught the
 *     earlier aria-hidden-focus bug; the tab anchors are the whole
 *     filter surface today)
 */

/** Label + icon per offered diet. Halal's "icon" is the حلال word-mark —
 *  the closest thing to the certification logo that ships as text.
 *  Dish rows show ICONS ONLY; the label survives as tooltip + sr-only
 *  text so nothing is lost for screen readers. */
const DIET_META: Record<string, { label: string; icon: string; crossed?: boolean }> = {
  vegan: { label: "Vegan", icon: "🌱" },
  vegetarian: { label: "Vegetarian", icon: "🥬" },
  gluten_free: { label: "Gluten-free", icon: "🌾", crossed: true },
  dairy_free: { label: "Dairy-free", icon: "🥛", crossed: true },
  halal: { label: "Halal", icon: "حلال" },
  kosher: { label: "Kosher", icon: "✡" },
};

/** Brand acceptance marks (Simple Icons, CC0 icon data) rendered as
 *  inline SVG in currentColor so they read on every menu theme. Methods
 *  without a brand glyph (cash, girocard) fall back to their emoji. */
const PAYMENT_ICONS: Record<string, { path: string; title: string }> = {
  visa: { path: siVisa.path, title: "Visa" },
  mastercard: { path: siMastercard.path, title: "Mastercard" },
  amex: { path: siAmericanexpress.path, title: "American Express" },
  paypal: { path: siPaypal.path, title: "PayPal" },
  apple_pay: { path: siApplepay.path, title: "Apple Pay" },
  google_pay: { path: siGooglepay.path, title: "Google Pay" },
};

const PAYMENT_EMOJI: Record<string, { emoji: string; label: string }> = Object.fromEntries(
  PAYMENT_METHODS.filter((m) => m.emoji).map((m) => [m.id, { emoji: m.emoji, label: m.label }]),
);

export function MenuView({
  menu,
  allCategories,
  activeDiets,
  activeCategoryId,
  orderingModes,
  onlinePayment,
  paypalPayment,
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
  const diets = activeDiets ?? new Set<string>();
  const activeDiet = diets.size > 0 ? Array.from(diets)[0]! : null;
  const catList = allCategories ?? menu.categories.map((c) => ({ id: c.id, name: c.name }));
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
          Online ordering is paused right now — please check back soon.
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
          {menu.venue.name} menu
        </h1>
        {menu.isPreview ? (
          <p
            role="status"
            className="mx-auto max-w-6xl px-6 pt-6 text-xs font-semibold uppercase tracking-widest text-[var(--menu-accent)]"
          >
            Draft preview — your private link. Guests only see what you publish.
          </p>
        ) : null}

        {menu.venue.branding.bannerKey ? (
          /* Hero header: the banner IS the top of the page, with the
             restaurant's identity (logo + name) and the open/closed
             pill overlaid — the sticky bar below then carries only the
             menu controls. */
          <HeroBanner venue={menu.venue} openNow={openNow} reserve={reserve} />
        ) : null}

        <StickyBar
          venue={menu.venue}
          categories={catList}
          activeCategoryId={activeCategoryId ?? null}
          activeDiet={activeDiet}
          showIcons={showIcons}
          offeredDiets={offeredDiets}
          openNow={openNow}
          reserve={reserve}
          sideNav={sideNav}
          hero={Boolean(menu.venue.branding.bannerKey)}
        />

        {theme.layout === "hero" && !activeCategoryId ? (
          <HeroSplash venue={menu.venue} categories={menu.categories} activeDiet={activeDiet} />
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
              active={activeCategoryId ?? null}
              activeDiet={activeDiet}
              showIcons={showIcons}
            />
          ) : null}
          <div className="min-w-0">
            {menu.categories.length === 0 ? (
              <p className="mx-auto mt-16 max-w-lg text-center text-sm text-[var(--menu-text)]/70">
                {diets.size > 0 || activeCategoryId
                  ? "No dishes match every diet you picked. Uncheck a filter above to see more."
                  : "Nothing on the menu yet — the restaurant is still building it."}
              </p>
            ) : (
              <div className={theme.layout === "editorial" ? "space-y-20" : "space-y-24"}>
                {menu.categories.map((cat, catIndex) => (
                  /* Every category is in the DOM; the tabs filter by toggling
                     `hidden` (client-side, instant). A ?cat= deep link arrives
                     pre-filtered from the server, so no-JS readers and search
                     engines see the same single category they asked for. */
                  <div
                    key={cat.id}
                    data-category-id={cat.id}
                    hidden={activeCategoryId ? cat.id !== activeCategoryId : undefined}
                  >
                    <Section
                      cat={cat}
                      catIndex={catIndex}
                      locale={locale}
                      slug={menu.venue.slug}
                      ordering={ordering}
                      showIcons={showIcons}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <footer className="border-t border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-8">
          <div className="flex w-full items-center justify-between gap-4 sm:contents">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  menu.venue.branding.logoKey
                    ? menuImageUrl(menu.venue.branding.logoKey, menu.venue.id, 96)
                    : "/brand/icon-192.png"
                }
                alt=""
                width={40}
                height={40}
                className={
                  menu.venue.branding.logoKey ? "h-10 w-10 rounded-full object-cover" : "h-10 w-10"
                }
              />
              <span className="font-serif text-xl italic text-[var(--menu-surface-text,var(--menu-text))]">
                {menu.venue.name}
              </span>
            </div>
            <LocaleSwitcher current={locale} enabled={menu.venue.enabledLocales} />
          </div>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-baseline sm:justify-between">
            {/* Footer = ON the surface: page-ink (--menu-text-soft) was
                1.8:1 against dark-red surfaces — surface ink instead. */}
            <span className="text-center text-[10px] uppercase tracking-[0.32em] text-[var(--menu-surface-text,var(--menu-text))]/75 sm:text-left">
              Powered by {BRAND.name} · Digital Menus
            </span>
            {modes.acceptedPayments.length > 0 ? (
              <span className="flex max-w-md flex-wrap items-center justify-center gap-x-1.5 gap-y-1.5 sm:justify-end">
                <span className="mr-1 w-full text-center text-[10px] uppercase tracking-[0.2em] text-[var(--menu-surface-text,var(--menu-text))]/75 sm:w-auto sm:text-right">
                  Accepted payments
                </span>
                {modes.acceptedPayments.map((id) => {
                  const icon = PAYMENT_ICONS[id];
                  const emoji = PAYMENT_EMOJI[id];
                  if (!icon && !emoji) return null;
                  const label = icon?.title ?? emoji!.label;
                  return (
                    <span
                      key={id}
                      role="img"
                      aria-label={label}
                      title={label}
                      /* Sits in the footer, i.e. ON the surface — so it takes an
                         ink wash instead of a border, and SURFACE ink instead of
                         page ink. It was `bg-surface` on a surface ground (an
                         invisible fill held together by its hairline) with page
                         ink over it, which is 1.08:1 on brasserie under a
                         backdrop. */
                      className="flex h-9 min-w-11 items-center justify-center rounded-lg bg-[var(--menu-surface-text,var(--menu-text))]/7 px-2.5 text-[var(--menu-surface-text,var(--menu-text))]"
                    >
                      {icon ? (
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-auto"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d={icon.path} />
                        </svg>
                      ) : (
                        <span aria-hidden="true" className="text-xl leading-none">
                          {emoji!.emoji}
                        </span>
                      )}
                    </span>
                  );
                })}
              </span>
            ) : null}
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
          onlinePayment={Boolean(onlinePayment)}
          paypalPayment={Boolean(paypalPayment)}
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
  /**
   * The first dish on the page — almost always the Largest Contentful
   * Paint element. Lazy-loading it defers the very pixel LCP is measured
   * on: Lighthouse scored `lcp-lazy-loaded` 0 and LCP landed at 3.6s
   * against a 2.7s budget. Eager + high fetch priority for that one image
   * only; everything below the fold stays lazy.
   */
  priority?: boolean;
};

/** Numbered heading + wide photo-left cards (the serif editorial look). */
function EditorialSection({
  cat,
  catIndex,
  locale,
  slug,
  ordering,
  showIcons,
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
          className="ml-2 h-px flex-1 self-end bg-gradient-to-r from-[var(--menu-accent)]/40 to-transparent"
        />
      </div>
      {cat.items.length === 0 ? (
        <p className="text-sm text-[var(--menu-text)]/60">No dishes in this section.</p>
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
}: {
  venue: PublicMenu["venue"];
  categories: PublicMenu["categories"];
  activeDiet: string | null;
}): React.ReactElement {
  const words = venue.name.split(/\s+/);
  const first = words[0] ?? venue.name;
  const rest = words.slice(1).join(" ");
  const heroItem = categories.flatMap((c) => c.items).find((i) => i.photoKey && i.isAvailable);
  const slugOf = categorySlugs(categories.map((c) => ({ id: c.id, name: c.name })));
  const dietQs = activeDiet ? `&diet=${activeDiet}` : "";
  return (
    <section aria-label="Willkommen" className="bg-[#0f0d0a] text-[#f5f1e8]">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 pb-6 pt-12 sm:px-8 md:grid-cols-[minmax(0,1fr)_auto] lg:px-12">
        <div>
          <p className="font-serif text-xl italic text-[var(--menu-accent)]">Willkommen bei</p>
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
            Frisch gekocht, schnell serviert — stöbere durch die Karte und bestelle direkt vom
            Handy.
          </p>
          <div className="mt-6">
            <a
              href="#menu"
              className="inline-block rounded-full bg-[var(--menu-accent)] px-7 py-3 text-sm font-bold uppercase tracking-wider text-[#171207] transition hover:opacity-90"
            >
              Jetzt bestellen ↓
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-xs text-[#f5f1e8]/80">
            {[
              ["Schnell serviert", "Direkt aus der Küche"],
              ["Beste Qualität", "Frische Zutaten"],
              ["Faire Preise", "Jeden Tag"],
            ].map(([t, sub]) => (
              <li key={t} className="flex items-center gap-2.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--menu-accent)]" />
                <span>
                  <span className="block font-bold uppercase tracking-wide">{t}</span>
                  <span className="block text-[#f5f1e8]/60">{sub}</span>
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
          aria-label="Kategorien mit Bild"
          className="bg-[var(--menu-bg)] pb-2 pt-8 text-[var(--menu-text)]"
        >
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-[var(--menu-accent)]">
            Unsere Kategorien
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
                    {c.items.length} Gerichte
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
        <p className="text-center text-sm text-[var(--menu-text)]/60">No dishes in this section.</p>
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
                aria-labelledby={`item-${item.id}`}
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
                  <div className="absolute left-1 top-1 z-10 max-h-[calc(100%-0.5rem)] overflow-hidden">
                    <PhotoDietBadges dietary={item.dietary} />
                  </div>
                </div>
                <h3
                  id={`item-${item.id}`}
                  className={`mt-4 font-serif text-lg italic leading-snug ${
                    item.isAvailable ? "" : "line-through opacity-60"
                  }`}
                >
                  {item.name}
                  {!item.isAvailable ? (
                    <span className="ml-1 align-middle text-[9px] uppercase tracking-widest text-[var(--menu-text-soft)] no-underline">
                      unavailable
                    </span>
                  ) : null}
                </h3>
                {item.description ? (
                  <DishDescription
                    text={item.description}
                    dishName={item.name}
                    locale={locale}
                    className="mt-1 text-xs leading-relaxed text-[var(--menu-text-soft)]"
                  />
                ) : null}
                <BadgeRow
                  allergens={item.allergens}
                  traces={item.traces}
                  spice={item.spice}
                  dishName={item.name}
                />
                <div className="mt-auto flex w-full items-center justify-between gap-2 pt-3">
                  <p
                    aria-label="price"
                    className="text-base font-bold tabular-nums text-[var(--menu-text)]"
                  >
                    {item.offer ? (
                      <s className="mr-1.5 text-[0.85em] font-normal opacity-55">
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
        <p className="text-center text-sm text-[var(--menu-text)]/60">No dishes in this section.</p>
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
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Photo on top, name + price centered underneath — the bistro card. */
function GridDishCard({ item, locale, slug, ordering, priority }: DishProps): React.ReactElement {
  const src = menuImageUrl(item.photoKey, item.id, 480);
  const srcSet = menuImageSrcSet(item.photoKey, item.id, 480);
  return (
    <article
      // The reveal script mutates class/style before hydration; React
      // must not warn about (or fight) those attribute differences.
      suppressHydrationWarning
      aria-labelledby={`item-${item.id}`}
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
        <div className="absolute left-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-hidden">
          <PhotoDietBadges dietary={item.dietary} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-2.5 py-3 sm:px-3 sm:py-4">
        <div className="flex items-start justify-between gap-2">
          <h3
            id={`item-${item.id}`}
            className={
              item.isAvailable
                ? "text-sm font-medium leading-snug"
                : "text-sm font-medium leading-snug text-[var(--menu-surface-text,var(--menu-text))]/60 line-through"
            }
          >
            {item.name}
            {!item.isAvailable ? (
              <span className="ml-1 align-middle text-[9px] uppercase tracking-widest text-[var(--menu-surface-text-soft,var(--menu-text-soft))] no-underline">
                unavailable
              </span>
            ) : null}
          </h3>
          <div className="hidden shrink-0 justify-end sm:flex">
            <BadgeRow
              allergens={item.allergens}
              traces={item.traces}
              spice={item.spice}
              dishName={item.name}
            />
          </div>
        </div>
        {item.description ? (
          <DishDescription
            text={item.description}
            dishName={item.name}
            locale={locale}
            className="text-xs leading-relaxed text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
          />
        ) : null}
        <MobileAllergenLine
          allergens={item.allergens}
          traces={item.traces}
          spice={item.spice}
          dishName={item.name}
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
            aria-label="price"
            className="text-base font-semibold tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))]"
          >
            {item.offer ? (
              <>
                <span className="mr-1.5 rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-[var(--menu-surface)]">
                  Angebot
                </span>
                <s className="mr-1.5 text-[0.85em] font-normal opacity-55">
                  <span className="sr-only">regulärer Preis </span>
                  {formatPrice(item.offer.basePriceCents, item.currency, locale)}
                </s>
                <span className="sr-only">Angebotspreis </span>
              </>
            ) : null}
            {formatPrice(item.priceCents, item.currency, locale)}
          </p>
          {ordering && item.isAvailable ? (
            <AddToOrderButton
              slug={slug}
              itemId={item.id}
              name={item.name}
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
        <p className="text-center text-sm text-[var(--menu-text)]/60">No dishes in this section.</p>
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
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ListDishRow({ item, locale, slug, ordering, priority }: DishProps): React.ReactElement {
  return (
    <article
      // The reveal script mutates class/style before hydration; React
      // must not warn about (or fight) those attribute differences.
      suppressHydrationWarning
      aria-labelledby={`item-${item.id}`}
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
        <div className="absolute left-1.5 top-1.5 z-10 max-h-[calc(100%-0.75rem)] overflow-hidden">
          <PhotoDietBadges dietary={item.dietary} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col py-2.5 pl-1.5 pr-3 sm:py-3 sm:pl-2 sm:pr-4">
        <div className="flex items-start justify-between gap-3">
          <h3
            id={`item-${item.id}`}
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
            />
          </div>
        </div>
        {item.description ? (
          <DishDescription
            text={item.description}
            dishName={item.name}
            locale={locale}
            className="mt-1 text-sm leading-relaxed text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
          />
        ) : null}
        <MobileAllergenLine
          allergens={item.allergens}
          traces={item.traces}
          spice={item.spice}
          dishName={item.name}
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
            aria-label="price"
            className="whitespace-nowrap text-lg font-bold tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))] sm:text-xl"
          >
            {item.offer ? (
              <>
                <span className="mr-1.5 rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-[var(--menu-surface)]">
                  Angebot
                </span>
                <s className="mr-1.5 text-[0.85em] font-normal opacity-55">
                  <span className="sr-only">regulärer Preis </span>
                  {formatPrice(item.offer.basePriceCents, item.currency, locale)}
                </s>
                <span className="sr-only">Angebotspreis </span>
              </>
            ) : null}
            {formatPrice(item.priceCents, item.currency, locale)}
          </p>
          {ordering && item.isAvailable ? (
            <AddToOrderButton
              slug={slug}
              itemId={item.id}
              name={item.name}
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
        <p className="text-center text-sm text-[var(--menu-text)]/60">No dishes in this section.</p>
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
}: DishProps): React.ReactElement {
  const src = menuImageUrl(item.photoKey, item.id, 480);
  const srcSet = menuImageSrcSet(item.photoKey, item.id, 480);
  return (
    <article
      // The reveal script mutates class/style before hydration; React
      // must not warn about (or fight) those attribute differences.
      suppressHydrationWarning
      aria-labelledby={`item-${item.id}`}
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
        <div className="absolute left-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-hidden">
          <PhotoDietBadges dietary={item.dietary} />
        </div>
      </div>
      <div className="flex w-full items-start justify-between gap-3 text-left">
        <h3
          id={`item-${item.id}`}
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
          />
        </div>
      </div>
      {item.description ? (
        <DishDescription
          text={item.description}
          dishName={item.name}
          locale={locale}
          className="mt-1 max-w-xs text-xs leading-relaxed text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
        />
      ) : null}
      <MobileAllergenLine
        allergens={item.allergens}
        traces={item.traces}
        spice={item.spice}
        dishName={item.name}
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
          aria-label="price"
          className="inline-block rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))]/14 px-4 py-1 text-base font-bold tabular-nums text-[var(--menu-surface-text,var(--menu-text))]"
        >
          {item.offer ? (
            <>
              <span className="mr-1.5 rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-[var(--menu-surface)]">
                Angebot
              </span>
              <s className="mr-1.5 text-[0.85em] font-normal opacity-55">
                <span className="sr-only">regulärer Preis </span>
                {formatPrice(item.offer.basePriceCents, item.currency, locale)}
              </s>
              <span className="sr-only">Angebotspreis </span>
            </>
          ) : null}
          {formatPrice(item.priceCents, item.currency, locale)}
        </p>
        {ordering && item.isAvailable ? (
          <AddToOrderButton
            slug={slug}
            itemId={item.id}
            name={item.name}
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

/** Banner hero: the owner's wide image as the page top, identity
 *  overlaid — logo + name bottom-left on a scrim, open/closed pill
 *  top-right. The sticky bar below carries only menu controls. */
function HeroBanner({
  venue,
  openNow,
  reserve,
}: {
  venue: PublicMenu["venue"];
  openNow?: OpenState;
  reserve?: { slug: string; hours: OpeningHours; timezone: string };
}): React.ReactElement {
  return (
    <div className="relative h-40 w-full sm:h-48 lg:h-60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={uploadedImageUrl(venue.branding.bannerKey!, 1920)}
        // Full-bleed at every breakpoint, so width descriptors — a phone
        // takes the 640px render instead of the 1920px desktop one.
        srcSet={bannerSrcSet(venue.branding.bannerKey!)}
        sizes="100vw"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Scrim keeps the identity + pill legible over any photo. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-black/30"
      />
      <div className="absolute right-4 top-4 flex flex-col items-end gap-2 sm:right-6">
        <OpenBadge state={openNow} />
        {reserve ? <ReserveDialog {...reserve} /> : null}
      </div>
      <div className="absolute bottom-4 left-4 flex items-center gap-3 sm:bottom-5 sm:left-6 lg:left-12">
        <VenueMark venue={venue} />
        <span className="font-serif text-2xl italic text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] sm:text-3xl">
          {venue.name}
        </span>
      </div>
    </div>
  );
}

function StickyBar({
  venue,
  categories,
  activeCategoryId,
  activeDiet,
  showIcons,
  offeredDiets,
  openNow,
  reserve,
  sideNav = false,
  hero = false,
}: {
  venue: PublicMenu["venue"];
  categories: { id: string; name: string }[];
  activeCategoryId: string | null;
  activeDiet: string | null;
  showIcons: boolean;
  offeredDiets: string[];
  openNow?: OpenState;
  reserve?: { slug: string; hours: OpeningHours; timezone: string };
  sideNav?: boolean;
  /** Banner hero above carries logo + open pill — this bar then holds
   *  only the menu controls (categories + diets), grouped together. */
  hero?: boolean;
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
              active={activeCategoryId}
              activeDiet={activeDiet}
              showIcons={showIcons}
            />
          </div>
        ) : null
      ) : (
        <div className="mx-auto flex min-h-[3.5rem] max-w-none items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:min-h-0 lg:px-12">
          {/* Logo + restaurant name, left-aligned at every width. */}
          <VenueMark venue={venue} />
          {/* Category tabs: desktop only, fill the middle — unless the
              owner chose the side rail, which replaces them on lg+. */}
          <div className={`min-w-0 flex-1 lg:px-6 ${sideNav ? "hidden" : "hidden lg:block"}`}>
            <CategoryTabs
              categories={categories}
              active={activeCategoryId}
              activeDiet={activeDiet}
              showIcons={showIcons}
            />
          </div>
          {/* Open/closed pill + reserve button: right corner at every width. */}
          <div className="flex shrink-0 items-center gap-2">
            <OpenBadge state={openNow} />
            {reserve ? <ReserveDialog {...reserve} /> : null}
          </div>
        </div>
      )}
      {/* Categories on a second row on tablet/mobile (hidden above on lg) */}
      <div className="border-t border-[var(--menu-text)]/10 lg:hidden">
        <div className="mx-auto max-w-none px-4 py-2.5 sm:px-6 sm:py-3">
          <CategoryTabs
            categories={categories}
            active={activeCategoryId}
            activeDiet={activeDiet}
            showIcons={showIcons}
          />
        </div>
      </div>
      <div className="border-t border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)]">
        <div className="mx-auto max-w-none px-4 py-2.5 sm:px-6 sm:py-3 lg:px-12">
          <DietTabs
            active={activeDiet}
            activeCategorySlug={
              activeCategoryId
                ? (categorySlugs(categories).get(activeCategoryId) ?? activeCategoryId)
                : null
            }
            offeredDiets={offeredDiets}
          />
        </div>
      </div>
    </header>
  );
}

/** Live open/closed pill in the top bar. Silent when hours are unset —
 *  never shows a misleading "Closed" for a venue that hasn't entered
 *  hours. Positive/negative use the theme's own tokens. */
function OpenBadge({ state }: { state?: OpenState }): React.ReactElement | null {
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
      <span className="z-10 flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--menu-positive)]/14 py-1.5 pl-2.5 pr-3 text-xs font-semibold text-[var(--menu-text)]">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--menu-positive)] ring-4 ring-[var(--menu-positive)]/25"
        />
        Open
        <span className="hidden font-medium opacity-80 sm:inline">· until {state.until}</span>
      </span>
    );
  }
  const opensLabel =
    state.opensDay && state.opensAt
      ? `Opens ${WEEKDAY_LABELS[state.opensDay].slice(0, 3)} ${state.opensAt}`
      : "";
  return (
    <span className="z-10 flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--menu-danger)]/12 py-1.5 pl-2.5 pr-3 text-xs font-semibold text-[var(--menu-text)]">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--menu-danger)] ring-4 ring-[var(--menu-danger)]/25"
      />
      Closed
      {opensLabel ? (
        <span className="hidden font-medium opacity-80 sm:inline">· {opensLabel}</span>
      ) : null}
    </span>
  );
}

function VenueMark({ venue }: { venue: PublicMenu["venue"] }): React.ReactElement {
  // Top bar leads with the logo + restaurant name, so the venue's identity
  // stays visible as the guest scrolls. The name truncates on narrow
  // screens so it never crowds the open/closed pill.
  const logoSrc = venue.branding.logoKey
    ? menuImageUrl(venue.branding.logoKey, venue.id, 96)
    : "/brand/icon-192.png";
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
      <span className="min-w-0 truncate font-serif text-lg italic leading-tight text-[var(--menu-text)]">
        {venue.name}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dish card — full-width tile with gradient photo + gold accents      */
/* ------------------------------------------------------------------ */

function DishCard({ item, locale, slug, ordering, priority }: DishProps): React.ReactElement {
  return (
    <article
      // The reveal script mutates class/style before hydration; React
      // must not warn about (or fight) those attribute differences.
      suppressHydrationWarning
      aria-labelledby={`item-${item.id}`}
      className="dish-card text-[var(--menu-surface-text,var(--menu-text))] group relative grid grid-cols-[minmax(0,104px)_1fr] gap-4 overflow-hidden rounded-md border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] p-3 transition-all duration-300 hover:shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)] sm:grid-cols-[minmax(0,180px)_1fr] sm:gap-5"
    >
      <div className="relative self-stretch">
        <DishPhoto item={item} priority={priority} />
        <div className="absolute left-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-hidden">
          <PhotoDietBadges dietary={item.dietary} />
        </div>
      </div>
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <h3
            id={`item-${item.id}`}
            className={
              item.isAvailable
                ? "font-serif text-lg leading-tight text-[var(--menu-surface-text,var(--menu-text))] sm:text-xl"
                : "font-serif text-lg leading-tight text-[var(--menu-surface-text,var(--menu-text))]/60 line-through sm:text-xl"
            }
          >
            {item.name}
            {!item.isAvailable ? (
              <span className="ml-2 align-middle text-[9px] uppercase tracking-widest text-[var(--menu-surface-text-soft,var(--menu-text-soft))] no-underline">
                unavailable
              </span>
            ) : null}
          </h3>
          <div className="hidden shrink-0 justify-end sm:flex">
            <BadgeRow
              allergens={item.allergens}
              traces={item.traces}
              spice={item.spice}
              dishName={item.name}
            />
          </div>
        </div>
        {item.description ? (
          <DishDescription
            text={item.description}
            dishName={item.name}
            locale={locale}
            className="mt-1 text-sm leading-relaxed text-[var(--menu-surface-text,var(--menu-text))]"
          />
        ) : null}
        <MobileAllergenLine
          allergens={item.allergens}
          traces={item.traces}
          spice={item.spice}
          dishName={item.name}
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
            aria-label="price"
            className="whitespace-nowrap text-lg font-bold tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))] sm:text-xl"
          >
            {item.offer ? (
              <>
                <span className="mr-1.5 rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-[var(--menu-surface)]">
                  Angebot
                </span>
                <s className="mr-1.5 text-[0.85em] font-normal opacity-55">
                  <span className="sr-only">regulärer Preis </span>
                  {formatPrice(item.offer.basePriceCents, item.currency, locale)}
                </s>
                <span className="sr-only">Angebotspreis </span>
              </>
            ) : null}
            {formatPrice(item.priceCents, item.currency, locale)}
          </p>
          {ordering && item.isAvailable ? (
            <AddToOrderButton
              slug={slug}
              itemId={item.id}
              name={item.name}
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
  activeDiet,
  showIcons,
}: {
  categories: { id: string; name: string }[];
  active: string | null;
  activeDiet: string | null;
  showIcons: boolean;
}): React.ReactElement {
  const dietQs = activeDiet ? `&diet=${activeDiet}` : "";
  const slugOf = categorySlugs(categories);
  // Modern rail: a soft translucent surface so the labels are readable
  // over ANY artwork/gradient; the active category is the app's red
  // bubble with the sharp bottom-right corner.
  const linkBase = "block rounded-xl px-3.5 py-2 text-[13px] leading-snug transition-colors";
  const railActive =
    "bg-[var(--menu-surface-accent,var(--menu-accent))] font-semibold text-[var(--menu-surface,#fffdf8)] [border-bottom-right-radius:3px]";
  const railIdle =
    "text-[var(--menu-surface-text,var(--menu-text))]/80 hover:bg-[var(--menu-surface-accent,var(--menu-accent))]/10 hover:text-[var(--menu-surface-accent,var(--menu-accent))]";
  return (
    <aside className="hidden lg:block">
      <nav
        aria-label="Categories"
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
              All
            </CategoryLink>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <CategoryLink
                id={c.id}
                slug={slugOf.get(c.id) ?? c.id}
                href={`/?cat=${slugOf.get(c.id) ?? c.id}${dietQs}`}
                initialActive={active}
                activeClass={`${linkBase} ${railActive}`}
                idleClass={`${linkBase} ${railIdle}`}
              >
                {showIcons ? (
                  <span aria-hidden="true" className="mr-1.5 text-sm normal-case tracking-normal">
                    {categoryIcon(c.name)}
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
  activeDiet,
  showIcons,
}: {
  categories: { id: string; name: string }[];
  active: string | null;
  activeDiet: string | null;
  showIcons: boolean;
}): React.ReactElement | null {
  const slugOf = categorySlugs(categories);
  return (
    <CategoryTabsClient
      categories={categories}
      slugs={Object.fromEntries(categories.map((c) => [c.id, slugOf.get(c.id) ?? c.id]))}
      icons={Object.fromEntries(categories.map((c) => [c.id, categoryIcon(c.name)]))}
      active={active}
      activeDiet={activeDiet}
      showIcons={showIcons}
    />
  );
}

function DietTabs({
  active,
  activeCategorySlug,
  offeredDiets,
}: {
  active: string | null;
  activeCategorySlug: string | null;
  offeredDiets: string[];
}): React.ReactElement {
  const catQs = activeCategorySlug ? `cat=${activeCategorySlug}` : "";
  const buildHref = (diet: string | null): string => {
    const parts: string[] = [];
    if (catQs) parts.push(catQs);
    if (diet) parts.push(`diet=${diet}`);
    return parts.length > 0 ? `/?${parts.join("&")}` : `/`;
  };
  return (
    <nav aria-label="Dietary filter" className="-mx-1 w-full overflow-x-auto">
      <ul className="mx-auto flex w-max min-w-max items-center gap-1 px-1 text-[10px] uppercase tracking-[0.28em]">
        <li>
          <TabLink href={buildHref(null)} active={active === null} variant="secondary">
            All diets
          </TabLink>
        </li>
        {offeredDiets.map((d) => (
          <li key={d}>
            <TabLink href={buildHref(d)} active={active === d} variant="secondary">
              <span
                aria-hidden="true"
                className="relative mr-1 inline-block normal-case tracking-normal"
              >
                {DIET_META[d]?.icon}
                {DIET_META[d]?.crossed ? (
                  <span className="absolute left-1/2 top-1/2 h-[1.5px] w-[1.4em] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current opacity-90" />
                ) : null}
              </span>
              {DIET_META[d]?.label ?? d.replace(/_/g, " ")}
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
}: {
  allergens: string[];
  traces: string[];
  spice?: number;
  dishName: string;
}): React.ReactElement | null {
  if (allergens.length === 0 && traces.length === 0 && spice === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm leading-none">
      {/* Diet icons live on the photo at every width — this row keeps
          only spice + the allergen popup, so nothing shows twice. */}
      {spice > 0 ? (
        <span
          title={`Spicy — level ${Math.min(spice, 3)} of 3`}
          className="inline-flex h-6 items-center justify-center rounded-full bg-[var(--menu-danger)]/12 px-1.5 tracking-tighter"
        >
          <span aria-hidden="true">{"🌶".repeat(Math.min(spice, 3))}</span>
          <span className="sr-only">Spicy, level {Math.min(spice, 3)} of 3</span>
        </span>
      ) : null}
      <AllergenDialog allergens={allergens} traces={traces} dishName={dishName} />
    </div>
  );
}

/** Icon chips overlaid on the dish photo — every device. Stacked
 *  VERTICALLY so a long list never spills past the photo's edge; the
 *  wrapper clips at the photo boundary. */
function PhotoDietBadges({ dietary }: { dietary: string[] }): React.ReactElement | null {
  const known = dietary.filter((d) => DIET_META[d]);
  if (known.length === 0) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      {known.map((d) => (
        <span
          key={d}
          title={DIET_META[d]!.label}
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
          <span className="sr-only">{DIET_META[d]!.label}</span>
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
}: {
  allergens: string[];
  traces: string[];
  spice?: number;
  dishName: string;
}): React.ReactElement | null {
  if (allergens.length === 0 && traces.length === 0 && spice === 0) return null;
  return (
    <div className="mt-1 flex items-center gap-1 sm:hidden">
      {spice > 0 ? (
        <span
          title={`Spicy — level ${Math.min(spice, 3)} of 3`}
          className="inline-flex h-6 items-center rounded-full bg-[var(--menu-danger)]/12 px-1.5 text-sm leading-none tracking-tighter"
        >
          <span aria-hidden="true">{"🌶".repeat(Math.min(spice, 3))}</span>
          <span className="sr-only">Spicy, level {Math.min(spice, 3)} of 3</span>
        </span>
      ) : null}
      <AllergenDialog allergens={allergens} traces={traces} dishName={dishName} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Locale switcher                                                     */
/* ------------------------------------------------------------------ */

// Flag + native name per menu language. Flags stand for the language, not
// a country — an imperfect but universally understood convention.
const LOCALE_META: Record<string, { flag: string; label: string }> = {
  en: { flag: "🇬🇧", label: "English" },
  de: { flag: "🇩🇪", label: "Deutsch" },
  fr: { flag: "🇫🇷", label: "Français" },
  it: { flag: "🇮🇹", label: "Italiano" },
  es: { flag: "🇪🇸", label: "Español" },
  nl: { flag: "🇳🇱", label: "Nederlands" },
  pl: { flag: "🇵🇱", label: "Polski" },
  pt: { flag: "🇵🇹", label: "Português" },
  tr: { flag: "🇹🇷", label: "Türkçe" },
  ar: { flag: "🇸🇦", label: "العربية" },
};

function localeMeta(code: string): { flag: string; label: string } {
  return LOCALE_META[code.slice(0, 2).toLowerCase()] ?? { flag: "🌐", label: code.toUpperCase() };
}

/** Flag dropdown built on <details> — opens upward from the footer and
 *  needs no JavaScript. The current language is the summary; the others
 *  are plain links. */
function LocaleSwitcher({
  current,
  enabled,
}: {
  current: string;
  enabled: string[];
}): React.ReactElement | null {
  if (enabled.length < 2) return null;
  const active = localeMeta(current);
  return (
    <nav aria-label="Language" className="relative">
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
        <ul className="absolute bottom-full right-0 z-30 mb-2 w-44 overflow-hidden rounded-xl border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] py-1 shadow-[0_18px_36px_-12px_rgba(0,0,0,0.45)] sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
          {enabled.map((l) => {
            const meta = localeMeta(l);
            return l === current ? (
              <li
                key={l}
                aria-current="true"
                className="flex items-center gap-2.5 bg-[var(--menu-surface-accent,var(--menu-accent))]/14 px-3.5 py-2 text-xs font-semibold text-[var(--menu-surface-text,var(--menu-text))]"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {meta.flag}
                </span>
                {meta.label}
                <span aria-hidden="true" className="ml-auto">
                  ✓
                </span>
              </li>
            ) : (
              <li key={l}>
                <a
                  href={`/${l}`}
                  hrefLang={l}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-xs text-[var(--menu-surface-text,var(--menu-text))] transition-colors hover:bg-[var(--menu-surface-text,var(--menu-text))]/10"
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    {meta.flag}
                  </span>
                  {meta.label}
                </a>
              </li>
            );
          })}
        </ul>
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
