import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { asUser } from "./tenant";
import { isPlatformAdmin } from "./platform-admin";
import { normalizeImage } from "./image-normalize";
import { copyUpload, writeUpload } from "./image-storage";
import { ALLOWED_IMAGE_TYPES, MAX_BYTES } from "./media-service";
import { normalizeFilename, type MenuIO } from "./menu-io-service";

/**
 * Menu templates — Guesto's starter menus by cuisine. Platform-owned
 * (no tenant, no RLS); the onboarding/dashboard picker clones one into
 * a restaurant's DRAFT menu, then the owner edits and publishes. The
 * clone mirrors confirmImportDraft's tree-copy so templates ride the
 * same draft→publish machinery.
 */

const DIETARY = ["vegetarian", "vegan", "halal", "kosher", "gluten_free", "dairy_free"] as const;
const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

// Platform-owned photo, stored under the templates/ prefix in the same
// bucket as tenant uploads. Dimensions/bytes ride along so the clone can
// create a faithful Media row without a HEAD round trip.
const templateImageSchema = z.object({
  key: z.string().min(1).max(300),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  bytes: z.number().int().min(1),
  // Source filename (normalised) — the join key for bulk photo upload.
  filename: z.string().max(300).optional(),
});

export type TemplateImage = z.infer<typeof templateImageSchema>;

const templateItemSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  priceCents: z.number().int().min(0).max(1_000_000),
  dietary: z.array(z.enum(DIETARY)).default([]),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  spice: z.number().int().min(0).max(3).default(0),
  image: templateImageSchema.optional(),
  // Wanted photo filename from the sheet's Image column. Bulk photo upload
  // fills `image` for every item whose name matches an uploaded file.
  imageFilename: z.string().max(300).optional(),
});

const templateCategorySchema = z.object({
  name: z.string().min(1).max(200),
  image: templateImageSchema.optional(),
  items: z.array(templateItemSchema).max(60),
});

export const templateContentSchema = z.object({
  categories: z.array(templateCategorySchema).max(30),
});

export type TemplateContent = z.infer<typeof templateContentSchema>;

export interface MenuTemplateSummary {
  id: string;
  key: string;
  name: string;
  cuisine: string;
  emoji: string;
  active: boolean;
  categoryCount: number;
  itemCount: number;
}

function summarize(row: {
  id: string;
  key: string;
  name: string;
  cuisine: string;
  emoji: string;
  active: boolean;
  content: unknown;
}): MenuTemplateSummary {
  const parsed = templateContentSchema.safeParse(row.content);
  const cats = parsed.success ? parsed.data.categories : [];
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    cuisine: row.cuisine,
    emoji: row.emoji,
    active: row.active,
    categoryCount: cats.length,
    itemCount: cats.reduce((n, c) => n + c.items.length, 0),
  };
}

/** Active templates for the owner-facing picker (dashboard/onboarding). */
export async function listActiveTemplates(): Promise<MenuTemplateSummary[]> {
  const rows = await prisma.menuTemplate.findMany({
    where: { active: true },
    orderBy: { sortIndex: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      cuisine: true,
      emoji: true,
      active: true,
      content: true,
    },
  });
  return rows.map(summarize);
}

/** Every template for the platform-admin list. */
export async function adminListTemplates(userId: string): Promise<MenuTemplateSummary[] | null> {
  if (!(await isPlatformAdmin(userId))) return null;
  const rows = await prisma.menuTemplate.findMany({
    orderBy: { sortIndex: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      cuisine: true,
      emoji: true,
      active: true,
      content: true,
    },
  });
  return rows.map(summarize);
}

export async function adminSetTemplateActive(
  userId: string,
  id: string,
  active: boolean,
): Promise<"ok" | "forbidden"> {
  if (!(await isPlatformAdmin(userId))) return "forbidden";
  await prisma.menuTemplate.updateMany({ where: { id }, data: { active } });
  return "ok";
}

export type ApplyResult =
  | { ok: true; categoriesCreated: number; itemsCreated: number }
  | { ok: false; error: "no_draft" | "unknown_template" | "invalid_template" };

/**
 * Clone a template into the caller's DRAFT menu version. REPLACES the
 * current draft categories (the picker confirms this first) so applying
 * a template is idempotent and never merges two cuisines by accident.
 * Item currency comes from the venue, not the template.
 */
export async function applyTemplateToDraft(
  userId: string,
  templateKey: string,
): Promise<ApplyResult> {
  const template = await prisma.menuTemplate.findUnique({
    where: { key: templateKey },
    select: { content: true },
  });
  if (!template) return { ok: false, error: "unknown_template" };
  const parsed = templateContentSchema.safeParse(template.content);
  if (!parsed.success) return { ok: false, error: "invalid_template" };

  return asUser(userId, async (tx) => {
    const draft = await tx.menuVersion.findFirst({
      where: { status: "draft" },
      orderBy: { createdAt: "desc" },
      select: { id: true, tenantId: true },
    });
    if (!draft) return { ok: false, error: "no_draft" as const };

    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { currency: true },
    });
    const currency = venue?.currency ?? "EUR";

    // Template photos are platform objects; each clone gets its OWN copy
    // under the tenant prefix + a tenant Media row, so tenants stay
    // isolated (deleting their photo never touches the template or other
    // restaurants). Best-effort: a failed copy drops the photo, never the
    // dish — the placeholder fallback covers it.
    const cloneImage = async (image: TemplateImage, altText: string): Promise<string | null> => {
      try {
        const storageKey = `${draft.tenantId}/uploads/${randomUUID()}`;
        await copyUpload(image.key, storageKey);
        const media = await tx.media.create({
          data: {
            tenantId: draft.tenantId,
            storageKey,
            width: image.width,
            height: image.height,
            bytes: image.bytes,
            altText: altText.slice(0, 300) || null,
          },
          select: { id: true },
        });
        return media.id;
      } catch {
        return null;
      }
    };

    // Replace: clear existing draft categories (items cascade via FK).
    await tx.category.deleteMany({ where: { menuVersionId: draft.id } });

    let categoriesCreated = 0;
    let itemsCreated = 0;
    let categoryOrder = 100;
    for (const cat of parsed.data.categories) {
      const categoryPhotoId = cat.image ? await cloneImage(cat.image, cat.name) : null;
      const category = await tx.category.create({
        data: {
          tenantId: draft.tenantId,
          menuVersionId: draft.id,
          name: cat.name,
          orderIndex: categoryOrder,
          photoMediaId: categoryPhotoId,
        },
        select: { id: true },
      });
      categoryOrder += 100;
      categoriesCreated += 1;
      let itemOrder = 100;
      for (const item of cat.items) {
        const itemPhotoId = item.image ? await cloneImage(item.image, item.name) : null;
        await tx.item.create({
          data: {
            tenantId: draft.tenantId,
            categoryId: category.id,
            name: item.name,
            description: item.description ?? null,
            priceCents: item.priceCents,
            currency,
            orderIndex: itemOrder,
            spice: item.spice,
            dietary: item.dietary,
            allergens: item.allergens,
            photoMediaId: itemPhotoId,
          },
        });
        itemOrder += 100;
        itemsCreated += 1;
      }
    }
    return { ok: true as const, categoriesCreated, itemsCreated };
  });
}

/* ------------------------------------------------------------------ */
/* Admin content editor (P9b)                                          */
/* ------------------------------------------------------------------ */

export interface TemplateDetail {
  id: string;
  key: string;
  name: string;
  cuisine: string;
  emoji: string;
  active: boolean;
  content: TemplateContent;
}

/**
 * Permanently delete a template. Safe: applying a template COPIES its
 * content into a restaurant's menu, so no restaurant references the row —
 * deleting it never affects a menu that was already built from it.
 */
export async function adminDeleteTemplate(
  userId: string,
  id: string,
): Promise<"ok" | "forbidden" | "not_found"> {
  if (!(await isPlatformAdmin(userId))) return "forbidden";
  const row = await prisma.menuTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!row) return "not_found";
  await prisma.menuTemplate.delete({ where: { id } });
  return "ok";
}

/**
 * Bulk-populate a template from a parsed menu (Excel/JSON upload). Replaces
 * the whole category/item tree. Photos are NOT carried: template images are
 * platform objects added in the editor, not the tenant filename system, so
 * the sheet's Image column is ignored here. Spice is clamped to the
 * template's 0–3 range. Admin-gated via mutateContent.
 */
export async function adminReplaceTemplateContentFromMenu(
  userId: string,
  id: string,
  menu: MenuIO,
): Promise<"ok" | "forbidden" | "not_found" | "invalid"> {
  return mutateContent(userId, id, () => {
    const content = {
      categories: menu.categories.slice(0, 30).map((c) => ({
        name: c.name.slice(0, 200),
        items: c.items.slice(0, 60).map((i) => ({
          name: i.name.slice(0, 200),
          description: i.description ? i.description.slice(0, 500) : undefined,
          priceCents: i.priceCents,
          dietary: i.dietary,
          allergens: i.allergens,
          spice: Math.min(3, Math.max(0, i.spice)),
          imageFilename: i.imageFilename ?? undefined,
        })),
      })),
    };
    return content as unknown as TemplateContent;
  });
}

export interface TemplateImageUploadResult {
  ok: boolean;
  attached: number;
  unmatched: string[];
  failed: number;
}

/**
 * Bulk-upload photos for a template. Each file is resized
 * (savePlatformTemplateImage → sharp, capped to the max edge) and matched
 * to items by filename: every item whose `imageFilename` (from the sheet's
 * Image column) equals an uploaded file's name gets that photo. Re-uploading
 * the same filename replaces it. Files that match no item are reported as
 * unmatched.
 */
export async function adminAttachTemplateImages(
  userId: string,
  id: string,
  files: File[],
): Promise<TemplateImageUploadResult | "forbidden" | "not_found" | "invalid"> {
  if (!(await isPlatformAdmin(userId))) return "forbidden";

  // Resize + store every file first, keyed by normalised filename.
  const byName = new Map<string, TemplateImage>();
  let failed = 0;
  for (const file of files) {
    const saved = await savePlatformTemplateImage(userId, file);
    if (!saved.ok) {
      failed += 1;
      continue;
    }
    const filename = normalizeFilename(file.name || "image");
    byName.set(filename, { ...saved.image, filename });
  }

  const matched = new Set<string>();
  let attached = 0;
  const result = await mutateContent(userId, id, (c) => ({
    categories: c.categories.map((cat) => ({
      ...cat,
      items: cat.items.map((it) => {
        const fn = it.imageFilename;
        if (fn && byName.has(fn)) {
          matched.add(fn);
          attached += 1;
          return { ...it, image: byName.get(fn) };
        }
        return it;
      }),
    })),
  }));
  if (result !== "ok") return result;

  const unmatched = [...byName.keys()].filter((k) => !matched.has(k));
  return { ok: true, attached, unmatched, failed };
}

export async function adminGetTemplate(userId: string, id: string): Promise<TemplateDetail | null> {
  if (!(await isPlatformAdmin(userId))) return null;
  const row = await prisma.menuTemplate.findUnique({ where: { id } });
  if (!row) return null;
  const parsed = templateContentSchema.safeParse(row.content);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    cuisine: row.cuisine,
    emoji: row.emoji,
    active: row.active,
    content: parsed.success ? parsed.data : { categories: [] },
  };
}

const createTemplateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, and dashes only"),
  name: z.string().trim().min(1).max(80),
  cuisine: z.string().trim().min(1).max(80),
  emoji: z.string().trim().min(1).max(8),
});

export type AdminTemplateResult =
  { ok: true; id: string } | { ok: false; error: "forbidden" | "invalid" | "duplicate_key" };

export async function adminCreateTemplate(
  userId: string,
  input: unknown,
): Promise<AdminTemplateResult> {
  if (!(await isPlatformAdmin(userId))) return { ok: false, error: "forbidden" };
  const parsed = createTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const existing = await prisma.menuTemplate.findUnique({ where: { key: parsed.data.key } });
  if (existing) return { ok: false, error: "duplicate_key" };
  const max = await prisma.menuTemplate.aggregate({ _max: { sortIndex: true } });
  const created = await prisma.menuTemplate.create({
    data: {
      key: parsed.data.key,
      name: parsed.data.name,
      cuisine: parsed.data.cuisine,
      emoji: parsed.data.emoji,
      active: false, // authored → activate when ready
      sortIndex: (max._max.sortIndex ?? 0) + 10,
      content: { categories: [] },
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/** Mutate a template's content JSON under an admin gate. Each helper
 *  reads current content, applies one change, writes it back — the
 *  UI-authoring counterpart to the seed script. */
async function mutateContent(
  userId: string,
  id: string,
  fn: (c: TemplateContent) => TemplateContent | null,
): Promise<"ok" | "forbidden" | "not_found" | "invalid"> {
  if (!(await isPlatformAdmin(userId))) return "forbidden";
  const row = await prisma.menuTemplate.findUnique({ where: { id }, select: { content: true } });
  if (!row) return "not_found";
  const current = templateContentSchema.safeParse(row.content);
  const next = fn(current.success ? current.data : { categories: [] });
  if (!next) return "invalid";
  const valid = templateContentSchema.safeParse(next);
  if (!valid.success) return "invalid";
  await prisma.menuTemplate.update({ where: { id }, data: { content: valid.data } });
  return "ok";
}

/**
 * Ingest a template photo. Same gate as tenant uploads (type sniffed,
 * ≤10 MB, EXIF stripped, ≤2048px) but stored under the platform-owned
 * templates/ prefix with NO tenant Media row — the descriptor lives in
 * the template JSON and clones materialize per-tenant copies.
 */
export async function savePlatformTemplateImage(
  userId: string,
  file: File,
): Promise<
  { ok: true; image: TemplateImage } | { ok: false; error: "forbidden" | "invalid_image" }
> {
  if (!(await isPlatformAdmin(userId))) return { ok: false, error: "forbidden" };
  if (
    !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type) ||
    file.size === 0 ||
    file.size > MAX_BYTES
  ) {
    return { ok: false, error: "invalid_image" };
  }
  const normalized = await normalizeImage(Buffer.from(await file.arrayBuffer()));
  if (!normalized.ok) return { ok: false, error: "invalid_image" };

  const key = `templates/${randomUUID()}`;
  await writeUpload(key, normalized.bytes);
  return {
    ok: true,
    image: {
      key,
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.bytes.length,
    },
  };
}

export function adminAddCategory(userId: string, id: string, name: string, image?: TemplateImage) {
  const trimmed = name.trim();
  return mutateContent(userId, id, (c) =>
    trimmed ? { categories: [...c.categories, { name: trimmed, image, items: [] }] } : null,
  );
}

export function adminSetCategoryImage(
  userId: string,
  id: string,
  categoryIndex: number,
  image: TemplateImage,
) {
  return mutateContent(userId, id, (c) => {
    if (!c.categories[categoryIndex]) return null;
    return {
      categories: c.categories.map((x, i) => (i === categoryIndex ? { ...x, image } : x)),
    };
  });
}

export function adminSetItemImage(
  userId: string,
  id: string,
  categoryIndex: number,
  itemIndex: number,
  image: TemplateImage,
) {
  return mutateContent(userId, id, (c) => {
    if (!c.categories[categoryIndex]?.items[itemIndex]) return null;
    return {
      categories: c.categories.map((x, i) =>
        i === categoryIndex
          ? { ...x, items: x.items.map((it, j) => (j === itemIndex ? { ...it, image } : it)) }
          : x,
      ),
    };
  });
}

export function adminDeleteCategory(userId: string, id: string, index: number) {
  return mutateContent(userId, id, (c) => ({
    categories: c.categories.filter((_, i) => i !== index),
  }));
}

export function adminAddItem(
  userId: string,
  id: string,
  categoryIndex: number,
  item: {
    name: string;
    description?: string;
    priceCents: number;
    dietary: string[];
    allergens: string[];
    spice: number;
    image?: TemplateImage;
  },
) {
  return mutateContent(userId, id, (c) => {
    const cat = c.categories[categoryIndex];
    if (!cat) return null;
    const parsed = templateItemSchema.safeParse(item);
    if (!parsed.success) return null;
    const categories = c.categories.map((x, i) =>
      i === categoryIndex ? { ...x, items: [...x.items, parsed.data] } : x,
    );
    return { categories };
  });
}

export function adminDeleteItem(
  userId: string,
  id: string,
  categoryIndex: number,
  itemIndex: number,
) {
  return mutateContent(userId, id, (c) => ({
    categories: c.categories.map((x, i) =>
      i === categoryIndex ? { ...x, items: x.items.filter((_, j) => j !== itemIndex) } : x,
    ),
  }));
}
