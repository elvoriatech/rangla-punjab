import { readDb } from "./db";
import { asTenantRead } from "./tenant";
import { parseOpeningHours } from "./opening-hours";
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
  priceCents: number;
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
      halalFilter?: string;
      kiosk?: string;
    };
  };
  locale: string;
  isPreview: boolean;
  categories: PublicCategory[];
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
        branding: true,
      },
    });
    if (!venue) return null;

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

    const localisedCategories: PublicCategory[] = categories.map((cat) => ({
      id: cat.id,
      name: translated(translations, "category", cat.id, "name") ?? cat.name,
      photoKey: cat.photoMedia?.storageKey ?? null,
      items: cat.items.map((item) => ({
        id: item.id,
        name: translated(translations, "item", item.id, "name") ?? item.name,
        description: translated(translations, "item", item.id, "description") ?? item.description,
        priceCents: item.priceCents,
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
      })),
    }));

    const branding = normaliseBranding(venue.branding);

    return {
      venue: {
        id: venue.id,
        name: venue.name,
        slug: venue.slug,
        defaultLocale: venue.defaultLocale,
        enabledLocales: venue.enabledLocales,
        currency: venue.currency,
        timezone: venue.timezone,
        hours: parseOpeningHours(venue.hours),
        branding,
      },
      locale: effectiveLocale,
      isPreview: context.mode === "preview",
      categories: localisedCategories,
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
