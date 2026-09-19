import { readDb } from "./db";
import { asTenantRead } from "./tenant";
import { resolveCategoryParam } from "./dietary-filter";
import { effectiveItemPrice } from "./offer-pricing";
import { currentOpenState } from "./opening-hours";
import { parseOpeningHours } from "./opening-hours-schema";
import { publicRating, scheduleVenueRatingRefresh, type PublicRating } from "./google-rating";
import { parseContactConfig, publicContact, type PublicContact } from "./contact-config";
import { parseAppLinksConfig, publicAppLinks, type PublicAppLinks } from "./app-links-config";
import type { PreviewContext } from "./preview-context";

/**
 * Data loader for the public menu page. Takes a resolved `PreviewContext`
 * (from `resolvePreviewContext`) and returns the venue + a tree of
 * categories → items → variants for the correct version — published on
 * the public path, or draft when a valid preview token is present.
 *
 * Reads run under the venue's tenant GUC via `asTenant`, so a
 * misconfigured route can't accidentally leak another restaurant's data.
 * Returns null when the venue has never published (no version to show).
 */

export interface PublicItemVariant {
  id: string;
  name: string;
  priceDeltaCents: number;
}

export interface PublicItem {
  id: string;
  name: string;
  description: string | null;
  /** The EFFECTIVE unit price at load time — the offer price while an offer
   *  is active, the regular price otherwise. Placement re-prices server-side
   *  regardless. */
  priceCents: number;
  /** Present only while an offer is ACTIVE at load time. `basePriceCents` is
   *  the regular price for the strikethrough; `endsAt` the date-range end
   *  (ISO) when it has one — weekly windows carry null. */
  offer?: { basePriceCents: number; endsAt: string | null } | null;
  currency: string;
  isAvailable: boolean;
  allergens: string[];
  traces: string[];
  dietary: string[];
  spice: number;
  /** Storage key of the dish photo; absent/null → renderer picks a default. */
  photoKey?: string | null;
  variants: PublicItemVariant[];
}

export interface PublicCategory {
  id: string;
  name: string;
  /** Storage key of the category photo; absent/null → no medallion is shown. */
  photoKey?: string | null;
  items: PublicItem[];
}

export interface PublicMenu {
  venue: {
    id: string;
    name: string;
    slug: string;
    defaultLocale: string;
    enabledLocales: string[];
    currency: string;
    timezone: string;
    hours: import("./opening-hours").OpeningHours;
    /**
     * Is the venue open RIGHT NOW, in its own timezone? Derived from
     * `hours` — a venue that never configured them is `false`, because
     * "we don't know" and "come back later" look the same to a guest and
     * only one of them is safe to promise.
     *
     * The app's header draws a dot from this rather than recomputing the
     * weekly grid on the device. On the web the payload is cached for
     * 300 s, so it may be up to five minutes stale — accepted: the page
     * also renders the full `hours` beside it.
     */
    openNow: boolean;
    /**
     * The restaurant's own phone numbers, ready to render: each slot
     * carries the E.164 number, a grouped display string and the `tel:` /
     * `wa.me` link built from it. Null when the owner has published none —
     * which is every venue until its owner fills the Settings card in.
     *
     * Optional so a hand-built fixture needn't carry it; every surface
     * treats absent and null identically: no contact row at all.
     */
    contact?: PublicContact | null;
    /**
     * Where a guest gets the venue's own app — `{ ios?, android?, apk? }`,
     * each an https URL, with absent keys for the slots the owner left
     * empty. Null when they have published none, which is every venue
     * until its owner fills the Settings card in.
     *
     * Optional so a hand-built fixture needn't carry it; every surface
     * treats absent and null identically: no "Get the app" section at all.
     */
    appLinks?: PublicAppLinks | null;
    branding: {
      primaryColor?: string;
      logoKey?: string | null;
      bannerKey?: string | null;
      theme?: string;
      texture?: string;
      backdrop?: string;
      headingColor?: string;
      categoryIcons?: string;
      navLayout?: string;
      cardBorders?: string;
      halalFilter?: string;
      kiosk?: string;
    };
  };
  locale: string;
  isPreview: boolean;
  categories: PublicCategory[];
  /** How many items carry an ACTIVE offer at load time (P7-12). Drives the
   *  synthetic "Offers" destination on the web rail and the app's offers
   *  card; 0 means offers render nowhere at all. Counted on the UNFILTERED
   *  tree, so a diet filter never changes it — surfaces that also narrow
   *  the menu re-derive from the items they actually render. */
  offerCount: number;
  /**
   * Ordering facts that depend on the venue rather than the basket.
   *
   * `acceptsAsapNow` answers the one question the checkout has to ask
   * before it offers "Now": is the kitchen open at this moment (or has
   * the owner never configured hours, in which case we never lock them
   * out of their own ordering)? While it is false the client must hide
   * "Now" and offer only the later-today slots — and `placeOrder`
   * refuses an ASAP or dine-in order anyway (`venue_closed`), so a stale
   * cached payload can annoy but never book food nobody will cook.
   *
   * Optional so a hand-built fixture needn't carry it; absent reads as
   * "no opinion", which every surface must treat as `true`.
   */
  ordering?: {
    acceptsAsapNow: boolean;
  };
  /** The venue's Google rating + review link (P7-14), or null — which is
   *  what a venue whose owner has neither saved a Place ID nor typed a
   *  rating by hand always gets. `reviewUrl` is null when the number came
   *  from the owner's own typing and there is no Place ID to link to.
   *  Optional so a hand-built fixture needn't carry it; every surface
   *  treats absent and null identically: no rating line. */
  rating?: PublicRating | null;
}

/** The synthetic category the "Offers" destination renders as. Never a real
 *  category id (those are uuids), so it cannot collide. */
export const OFFERS_CATEGORY_ID = "__offers";
/** What `?cat=` carries for that destination. */
export const OFFERS_CATEGORY_SLUG = "offers";

/**
 * Resolve `?cat=` for the public page, including the synthetic Offers
 * destination. A REAL category always wins the slug — `?cat=offers` only
 * selects the offers section when no category answers to it, and only
 * while the menu actually has a live offer, so a stale link degrades to
 * the whole menu instead of an empty page.
 */
export function resolvePublicCategoryParam(
  menu: PublicMenu,
  raw: string | string[] | undefined,
): string | null {
  const real = resolveCategoryParam(menu, raw);
  if (real) return real;
  const first = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  return first === OFFERS_CATEGORY_SLUG && menu.offerCount > 0 ? OFFERS_CATEGORY_ID : null;
}

/** Every item with an active offer, in menu order. Derived from whatever
 *  tree it is handed — pass the diet-filtered menu on the public page so
 *  the section lists exactly the dishes that page shows. */
export function offerItems(menu: PublicMenu): PublicItem[] {
  return menu.categories.flatMap((c) => c.items).filter((i) => i.offer != null);
}

export async function loadPublicMenu(
  context: PreviewContext,
  locale?: string,
): Promise<PublicMenu | null> {
  const versionId =
    context.mode === "preview" ? context.draftVersionId : context.publishedVersionId;
  if (!versionId) return null;

  return asTenantRead(context.tenantId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { id: context.venueId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        defaultLocale: true,
        enabledLocales: true,
        currency: true,
        timezone: true,
        hours: true,
        contact: true,
        appLinks: true,
        branding: true,
        googlePlaceId: true,
        googleRating: true,
        googleRatingManual: true,
        googleRatingEnabled: true,
      },
    });
    if (!venue) return null;

    // P7-14 — the Google rating rides along on the venue row we already
    // read, so the line costs no extra query. When the cache is over a day
    // old (or empty) a refresh is queued to run AFTER this transaction
    // commits; this render still serves what is cached, including nothing.
    const rating = publicRating(venue);
    scheduleVenueRatingRefresh(context.tenantId, venue.id, venue);

    const categories = await tx.category.findMany({
      where: { menuVersionId: versionId },
      orderBy: { orderIndex: "asc" },
      select: {
        id: true,
        name: true,
        photoMedia: { select: { storageKey: true } },
        items: {
          where: { deletedAt: null },
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            name: true,
            description: true,
            priceCents: true,
            offerPriceCents: true,
            offerStartsAt: true,
            offerEndsAt: true,
            offerWeekly: true,
            currency: true,
            isAvailable: true,
            allergens: true,
            traces: true,
            dietary: true,
            spice: true,
            photoMedia: { select: { storageKey: true } },
            variants: {
              orderBy: { orderIndex: "asc" },
              select: { id: true, name: true, priceDeltaCents: true },
            },
          },
        },
      },
    });

    // Locale layer: pull every `translations` row for the entities we're
    // about to render, index by (type, id, field), and overlay onto the
    // base rows below. Missing translations fall back to the default text
    // so a partially-translated menu still ships something readable.
    const effectiveLocale = locale ?? venue.defaultLocale;
    const translations = await loadTranslations(tx, categories, effectiveLocale);

    /* One instant for the whole menu, so two items in one response can never
       disagree about whether an offer window is on. */
    const now = new Date();

    const localisedCategories: PublicCategory[] = categories.map((cat) => ({
      id: cat.id,
      name: translated(translations, "category", cat.id, "name") ?? cat.name,
      photoKey: cat.photoMedia?.storageKey ?? null,
      items: cat.items.map((item) => {
        const priced = effectiveItemPrice(item, venue.timezone, now);
        return {
          id: item.id,
          name: translated(translations, "item", item.id, "name") ?? item.name,
          description: translated(translations, "item", item.id, "description") ?? item.description,
          priceCents: priced.unitPriceCents,
          offer:
            priced.basePriceCents === null
              ? null
              : {
                  basePriceCents: priced.basePriceCents,
                  endsAt: item.offerEndsAt ? item.offerEndsAt.toISOString() : null,
                },
          currency: item.currency,
          isAvailable: item.isAvailable,
          allergens: item.allergens,
          traces: item.traces,
          dietary: item.dietary,
          spice: item.spice,
          photoKey: item.photoMedia?.storageKey ?? null,
          variants: item.variants.map((v) => ({
            id: v.id,
            name: translated(translations, "item_variant", v.id, "name") ?? v.name,
            priceDeltaCents: v.priceDeltaCents,
          })),
        };
      }),
    }));

    const branding = normaliseBranding(venue.branding);

    // One parse feeds both the rendered hours table and the open/closed
    // dot, so the two can never disagree on the same payload.
    const hours = parseOpeningHours(venue.hours);
    const state = currentOpenState(hours, venue.timezone);

    return {
      venue: {
        id: venue.id,
        name: venue.name,
        slug: venue.slug,
        defaultLocale: venue.defaultLocale,
        enabledLocales: venue.enabledLocales,
        currency: venue.currency,
        timezone: venue.timezone,
        hours,
        // Unconfigured hours mean "we don't know", which the dot must
        // show as closed rather than promise as open.
        openNow: state.configured && state.open,
        // Derived once, here: the `tel:` / `wa.me` links and the grouped
        // display string are the same on the web footer, the account page
        // and in the app, so no surface builds them for itself.
        contact: publicContact(parseContactConfig(venue.contact)),
        // Same posture as `contact`: validated once here, so the footer
        // badges and the app's own screen link to the same three URLs and
        // neither has to decide what counts as a store link.
        appLinks: publicAppLinks(parseAppLinksConfig(venue.appLinks)),
        branding,
      },
      locale: effectiveLocale,
      isPreview: context.mode === "preview",
      categories: localisedCategories,
      offerCount: localisedCategories.reduce(
        (n, c) => n + c.items.filter((i) => i.offer != null).length,
        0,
      ),
      // Same `state` the dot is drawn from, asked the other way round:
      // "closed" hides the "Now" option, "no hours configured" leaves it
      // exactly where it was.
      ordering: { acceptsAsapNow: !state.configured || state.open },
      rating,
    };
  });
}

interface CategoryForTranslation {
  id: string;
  items: { id: string; variants: { id: string }[] }[];
}

type TranslationIndex = Map<string, string>;

async function loadTranslations(
  tx: Parameters<Parameters<typeof asTenantRead>[1]>[0],
  categories: CategoryForTranslation[],
  locale: string,
): Promise<TranslationIndex> {
  const categoryIds = categories.map((c) => c.id);
  const itemIds = categories.flatMap((c) => c.items.map((i) => i.id));
  const variantIds = categories.flatMap((c) => c.items.flatMap((i) => i.variants.map((v) => v.id)));

  const rows = await tx.translation.findMany({
    where: {
      locale,
      OR: [
        { entityType: "category", entityId: { in: categoryIds } },
        { entityType: "item", entityId: { in: itemIds } },
        { entityType: "item_variant", entityId: { in: variantIds } },
      ],
    },
    select: { entityType: true, entityId: true, field: true, value: true },
  });

  const index: TranslationIndex = new Map();
  for (const r of rows) {
    index.set(`${r.entityType}:${r.entityId}:${r.field}`, r.value);
  }
  return index;
}

function translated(
  index: TranslationIndex,
  type: string,
  id: string,
  field: string,
): string | null {
  return index.get(`${type}:${id}:${field}`) ?? null;
}

function normaliseBranding(raw: unknown): PublicMenu["venue"]["branding"] {
  if (raw && typeof raw === "object") {
    const b = raw as Record<string, unknown>;
    return {
      primaryColor: typeof b.primaryColor === "string" ? b.primaryColor : undefined,
      logoKey: typeof b.logoKey === "string" ? b.logoKey : null,
      bannerKey: typeof b.bannerKey === "string" ? b.bannerKey : null,
      theme: typeof b.theme === "string" ? b.theme : undefined,
      texture: typeof b.texture === "string" ? b.texture : undefined,
      backdrop: typeof b.backdrop === "string" ? b.backdrop : undefined,
      headingColor: typeof b.headingColor === "string" ? b.headingColor : undefined,
      categoryIcons: typeof b.categoryIcons === "string" ? b.categoryIcons : undefined,
      navLayout: typeof b.navLayout === "string" ? b.navLayout : undefined,
      cardBorders: typeof b.cardBorders === "string" ? b.cardBorders : undefined,
      halalFilter: typeof b.halalFilter === "string" ? b.halalFilter : undefined,
      kiosk: typeof b.kiosk === "string" ? b.kiosk : undefined,
    };
  }
  return {};
}

export { siteUrl } from "./site-url";

export interface PublicVenueRow {
  slug: string;
  defaultLocale: string;
  enabledLocales: string[];
  updatedAt: Date;
}

/** Enumerate every publicly-visible venue via `list_public_venues()` —
 * used only by the sitemap. RLS bypass is confined to that one function's
 * narrow projection (P1-12 migration). Routes through `readDb` (P2-12) so
 * sitemap traffic can lean on the replica in prod. */
export async function listPublicVenues(): Promise<PublicVenueRow[]> {
  const rows = await readDb.$queryRaw<
    {
      slug: string;
      default_locale: string;
      enabled_locales: string[];
      updated_at: Date;
    }[]
  >`SELECT * FROM list_public_venues()`;
  return rows.map((r) => ({
    slug: r.slug,
    defaultLocale: r.default_locale,
    enabledLocales: r.enabled_locales,
    updatedAt: r.updated_at,
  }));
}

/** Localised money format from integer cents. Keeps the fallback narrow
 * (defaults to `en` + `EUR`) so the render never throws on a bad locale. */
export function formatPrice(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale || "en", {
      style: "currency",
      currency: currency || "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || "EUR"}`;
  }
}
