import { z } from "zod";
import { asUser } from "./tenant";
import { LOCALE_CODES } from "./locales";

/**
 * Dish/category translations for the owner dashboard — the write side of
 * the overlay `public-menu.ts` reads. One `Translation` row per
 * (entity, locale, field); a missing row means "show the default-locale
 * text", so clearing an input deletes the row rather than storing "".
 *
 * Scope is always ONE category: the editor page owns a category, and both
 * calls resolve the venue's locales from that category's own menu — so a
 * foreign id can never widen what gets written. Everything runs inside
 * `asUser`, so RLS scopes reads and writes to the owner's tenant.
 */

/** The fields the dashboard can translate today. Variants are carried
 *  across publishes but have no editor yet — add them here when they do. */
const CATEGORY_FIELD = "name";
const ITEM_FIELDS = ["name", "description"] as const;

export type ServiceResult<T = void> =
  { ok: true; value: T } | { ok: false; error: "not_found" | "invalid" };

/** Default-locale text plus whatever translations exist, keyed by locale. */
export interface TranslatedField {
  /** What the owner wrote in the venue's default language. */
  base: string;
  /** locale → translation. Locales with no row are absent. */
  byLocale: Record<string, string>;
}

export interface CategoryTranslations {
  locales: {
    default: string;
    /** Every locale the venue has enabled, default included. */
    enabled: string[];
    /** The ones an owner actually types into: enabled minus default. */
    translatable: string[];
  };
  category: { id: string; name: TranslatedField };
  items: { id: string; name: TranslatedField; description: TranslatedField }[];
}

/** locale → text, every key optional. `partialRecord` (not `record`) —
 *  a plain enum-keyed record demands EVERY locale be present. */
const localeMap = (max: number) =>
  z.partialRecord(z.enum(LOCALE_CODES as readonly [string, ...string[]]), z.string().max(max));

export const saveCategoryTranslationsSchema = z.object({
  /** locale → category name. */
  category: localeMap(120).default({}),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        name: localeMap(120).default({}),
        description: localeMap(2000).default({}),
      }),
    )
    .max(500)
    .default([]),
});

/**
 * Deliberately looser than the schema: the caller is a `FormData` walk, so
 * its locale keys are plain strings. The schema — and the enabled-locale
 * check below — are what decide whether they are acceptable.
 */
export interface SaveCategoryTranslationsInput {
  /** locale → category name. */
  category?: Record<string, string>;
  items?: { id: string; name?: Record<string, string>; description?: Record<string, string> }[];
}

/** One `Translation` row the save wants to exist ("" = wants it gone). */
interface DesiredRow {
  entityType: string;
  entityId: string;
  locale: string;
  field: string;
  value: string;
}

/** Key for the unique index: one row per entity/locale/field. */
function rowKey(entityType: string, entityId: string, locale: string, field: string): string {
  return `${entityType}|${entityId}|${locale}|${field}`;
}

export async function getTranslationsForCategory(
  userId: string,
  categoryId: string,
): Promise<ServiceResult<CategoryTranslations>> {
  return asUser(userId, async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: categoryId },
      select: {
        id: true,
        name: true,
        // The locales that matter are the ones of the venue that owns
        // this category's menu — not "the active venue", which a stale
        // cookie could point somewhere else.
        menuVersion: {
          select: {
            menu: { select: { venue: { select: { defaultLocale: true, enabledLocales: true } } } },
          },
        },
        items: {
          where: { deletedAt: null },
          orderBy: { orderIndex: "asc" },
          select: { id: true, name: true, description: true },
        },
      },
    });
    if (!category) return { ok: false, error: "not_found" };

    const venue = category.menuVersion.menu.venue;
    const rows = await tx.translation.findMany({
      where: {
        locale: { in: venue.enabledLocales },
        OR: [
          { entityType: "category", entityId: category.id },
          { entityType: "item", entityId: { in: category.items.map((i) => i.id) } },
        ],
      },
      select: { entityType: true, entityId: true, locale: true, field: true, value: true },
    });
    const byKey = new Map(
      rows.map((r) => [rowKey(r.entityType, r.entityId, r.locale, r.field), r.value]),
    );
    const field = (entityType: string, entityId: string, name: string, base: string | null) => {
      const byLocale: Record<string, string> = {};
      for (const locale of venue.enabledLocales) {
        const value = byKey.get(rowKey(entityType, entityId, locale, name));
        if (value !== undefined) byLocale[locale] = value;
      }
      return { base: base ?? "", byLocale };
    };

    return {
      ok: true as const,
      value: {
        locales: {
          default: venue.defaultLocale,
          enabled: venue.enabledLocales,
          translatable: venue.enabledLocales.filter((l) => l !== venue.defaultLocale),
        },
        category: { id: category.id, name: field("category", category.id, "name", category.name) },
        items: category.items.map((item) => ({
          id: item.id,
          name: field("item", item.id, "name", item.name),
          description: field("item", item.id, "description", item.description),
        })),
      },
    };
  });
}

/**
 * Replace this category's translations with `raw`. Only locales the venue
 * has enabled (minus its default — that text lives on the row itself) and
 * only items that belong to THIS category are accepted; anything else is
 * a rejected call, not a silently-skipped field. Blank values delete the
 * row so the public overlay falls back to the default language.
 */
export async function saveCategoryTranslations(
  userId: string,
  categoryId: string,
  raw: SaveCategoryTranslationsInput,
): Promise<ServiceResult<{ saved: number; removed: number }>> {
  const parsed = saveCategoryTranslationsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;

  return asUser(userId, async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: categoryId },
      select: {
        id: true,
        tenantId: true,
        menuVersion: {
          select: {
            menu: { select: { venue: { select: { defaultLocale: true, enabledLocales: true } } } },
          },
        },
        items: { where: { deletedAt: null }, select: { id: true } },
      },
    });
    if (!category) return { ok: false, error: "not_found" };

    const venue = category.menuVersion.menu.venue;
    const translatable = new Set(venue.enabledLocales.filter((l) => l !== venue.defaultLocale));
    const ownItems = new Set(category.items.map((i) => i.id));

    // Desired state, keyed by the unique index. "" means "no translation".
    const desired = new Map<string, DesiredRow>();
    const want = (entityType: string, entityId: string, field: string, locale: string, v: string) =>
      desired.set(rowKey(entityType, entityId, locale, field), {
        entityType,
        entityId,
        locale,
        field,
        value: v.trim(),
      });

    for (const [locale, value] of Object.entries(input.category)) {
      if (!translatable.has(locale)) return { ok: false, error: "invalid" };
      want("category", category.id, CATEGORY_FIELD, locale, value ?? "");
    }
    for (const item of input.items) {
      // Never trust an id from the form: a neighbouring category's item —
      // or another tenant's, which RLS already hides — is a rejected call.
      if (!ownItems.has(item.id)) return { ok: false, error: "not_found" };
      for (const field of ITEM_FIELDS) {
        for (const [locale, value] of Object.entries(item[field] ?? {})) {
          if (!translatable.has(locale)) return { ok: false, error: "invalid" };
          want("item", item.id, field, locale, value ?? "");
        }
      }
    }

    const existing = await tx.translation.findMany({
      where: {
        OR: [
          { entityType: "category", entityId: category.id },
          { entityType: "item", entityId: { in: [...ownItems] } },
        ],
      },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        locale: true,
        field: true,
        value: true,
      },
    });
    const existingByKey = new Map(
      existing.map((r) => [rowKey(r.entityType, r.entityId, r.locale, r.field), r]),
    );

    // Diff rather than blind-upsert: an owner saving one locale must not
    // bump `updated_at` on every other row (and it keeps a 5-locale menu
    // to a handful of statements).
    const toCreate: DesiredRow[] = [];
    const toUpdate: { id: string; value: string }[] = [];
    const toDeleteIds: string[] = [];
    for (const row of desired.values()) {
      const key = rowKey(row.entityType, row.entityId, row.locale, row.field);
      const current = existingByKey.get(key);
      if (row.value === "") {
        if (current) toDeleteIds.push(current.id);
      } else if (!current) {
        toCreate.push(row);
      } else if (current.value !== row.value) {
        toUpdate.push({ id: current.id, value: row.value });
      }
    }

    if (toCreate.length > 0) {
      await tx.translation.createMany({
        data: toCreate.map((r) => ({
          tenantId: category.tenantId,
          entityType: r.entityType,
          entityId: r.entityId,
          locale: r.locale,
          field: r.field,
          value: r.value,
        })),
      });
    }
    for (const row of toUpdate) {
      await tx.translation.update({ where: { id: row.id }, data: { value: row.value } });
    }
    if (toDeleteIds.length > 0) {
      await tx.translation.deleteMany({ where: { id: { in: toDeleteIds } } });
    }

    return {
      ok: true as const,
      value: { saved: toCreate.length + toUpdate.length, removed: toDeleteIds.length },
    };
  });
}
