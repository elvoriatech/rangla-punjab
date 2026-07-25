import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { asTenant } from "./tenant";
import { normalizeImage } from "./image-normalize";
import { writeUpload, deleteUpload } from "./image-storage";

/**
 * Bulk menu I/O (P: single-restaurant ops). Round-trips the draft menu
 * through Excel (owner-editable) or JSON (exact backup), and takes bulk
 * image uploads keyed by filename. Import always REPLACES the draft from
 * the file, so the sheet is the single source of truth and there is no
 * fragile row-matching; the owner reviews the draft and publishes.
 *
 * The image filename is the join key: an Excel row's `Image` cell names a
 * photo, bulk upload stores photos under their filename, and re-uploading
 * the same name replaces the image everywhere it is used.
 */

// Mirror of the item enums (items-service keeps the authoritative copy;
// duplicated here so import can validate a cell without importing the
// server-action module).
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
const DIETARY = ["vegetarian", "vegan", "halal", "kosher", "gluten_free", "dairy_free"] as const;

export interface MenuItemIO {
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  isAvailable: boolean;
  spice: number;
  dietary: string[];
  allergens: string[];
  imageFilename: string | null;
}
export interface MenuCategoryIO {
  name: string;
  items: MenuItemIO[];
}
export interface MenuIO {
  categories: MenuCategoryIO[];
}

const SHEET = "Menu";
const COLUMNS = [
  { header: "Category", key: "category", width: 22 },
  { header: "Item", key: "item", width: 28 },
  { header: "Description", key: "description", width: 46 },
  { header: "Price (€)", key: "price", width: 10 },
  { header: "Available", key: "available", width: 11 },
  { header: "Spice (0-5)", key: "spice", width: 11 },
  { header: "Dietary", key: "dietary", width: 26 },
  { header: "Allergens", key: "allergens", width: 30 },
  { header: "Image", key: "image", width: 22 },
] as const;

/** Normalise a filename to the join key: basename, lowercased, trimmed. */
export function normalizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.trim().toLowerCase();
}

// ---------- read the draft ----------

export async function exportMenu(tenantId: string): Promise<MenuIO | null> {
  return asTenant(tenantId, async (tx) => {
    const draft = await tx.menuVersion.findFirst({
      where: { status: "draft" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!draft) return null;
    const categories = await tx.category.findMany({
      where: { menuVersionId: draft.id },
      orderBy: { orderIndex: "asc" },
      select: {
        name: true,
        items: {
          where: { deletedAt: null },
          orderBy: { orderIndex: "asc" },
          select: {
            name: true,
            description: true,
            priceCents: true,
            currency: true,
            isAvailable: true,
            spice: true,
            dietary: true,
            allergens: true,
            photoMedia: { select: { filename: true } },
          },
        },
      },
    });
    return {
      categories: categories.map((c) => ({
        name: c.name,
        items: c.items.map((i) => ({
          name: i.name,
          description: i.description,
          priceCents: i.priceCents,
          currency: i.currency,
          isAvailable: i.isAvailable,
          spice: i.spice,
          dietary: i.dietary as string[],
          allergens: i.allergens as string[],
          imageFilename: i.photoMedia?.filename ?? null,
        })),
      })),
    };
  });
}

// ---------- Excel build / parse ----------

export async function buildWorkbook(menu: MenuIO): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET);
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const cat of menu.categories) {
    if (cat.items.length === 0) {
      // Keep an empty category visible so it round-trips.
      ws.addRow({ category: cat.name });
      continue;
    }
    for (const item of cat.items) {
      ws.addRow({
        category: cat.name,
        item: item.name,
        description: item.description ?? "",
        price: (item.priceCents / 100).toFixed(2),
        available: item.isAvailable ? "yes" : "no",
        spice: item.spice,
        dietary: item.dietary.join(", "),
        allergens: item.allergens.join(", "),
        image: item.imageFilename ?? "",
      });
    }
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export interface ParseResult {
  menu: MenuIO;
  errors: string[];
  warnings: string[];
}

function parseTokens(
  raw: string,
  allowed: readonly string[],
  rowNo: number,
  label: string,
  warnings: string[],
): string[] {
  if (!raw.trim()) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const tok = part.trim().toLowerCase().replace(/\s+/g, "_");
    if (!tok) continue;
    if (allowed.includes(tok)) out.push(tok);
    else warnings.push(`Row ${rowNo}: unknown ${label} "${part.trim()}" — ignored.`);
  }
  return Array.from(new Set(out));
}

/** Read a cell to a plain string (ExcelJS cells may be rich/number/formula). */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return String(v.result ?? "");
    return "";
  }
  return String(v);
}

export async function parseWorkbook(buffer: Buffer): Promise<ParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs's bundled Buffer type predates @types/node's generic Buffer;
    // the value is a real Node Buffer, so the cast is safe.
    await wb.xlsx.load(buffer as never);
  } catch {
    return {
      menu: { categories: [] },
      errors: ["Could not read the file as an Excel workbook."],
      warnings,
    };
  }
  const ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
  if (!ws) return { menu: { categories: [] }, errors: ["The workbook has no sheets."], warnings };

  // Preserve category order by first appearance.
  const order: string[] = [];
  const byCategory = new Map<string, MenuCategoryIO>();
  const ensureCat = (name: string): MenuCategoryIO => {
    let c = byCategory.get(name);
    if (!c) {
      c = { name, items: [] };
      byCategory.set(name, c);
      order.push(name);
    }
    return c;
  };

  ws.eachRow((row, rowNo) => {
    if (rowNo === 1) return; // header
    const get = (key: string): string =>
      cellText(row.getCell(COLUMNS.findIndex((c) => c.key === key) + 1).value).trim();

    const category = get("category");
    const item = get("item");
    if (!category && !item) return; // blank row
    if (!category) {
      warnings.push(`Row ${rowNo}: no category — row skipped.`);
      return;
    }
    const cat = ensureCat(category);
    if (!item) return; // category-only row (keeps an empty section)

    const priceRaw = get("price").replace(/[€\s]/g, "").replace(",", ".");
    const priceNum = Number.parseFloat(priceRaw);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      warnings.push(
        `Row ${rowNo}: "${item}" has an invalid price ("${get("price")}") — row skipped.`,
      );
      return;
    }
    const priceCents = Math.round(priceNum * 100);

    const spiceRaw = get("spice");
    let spice = spiceRaw ? Number.parseInt(spiceRaw, 10) : 0;
    if (!Number.isFinite(spice) || spice < 0 || spice > 5) {
      warnings.push(`Row ${rowNo}: spice "${spiceRaw}" out of 0-5 — set to 0.`);
      spice = 0;
    }

    const availRaw = get("available").toLowerCase();
    const isAvailable = !["no", "n", "false", "0", "off"].includes(availRaw);

    cat.items.push({
      name: item.slice(0, 120),
      description: get("description").slice(0, 2000) || null,
      priceCents,
      currency: "EUR",
      isAvailable,
      spice,
      dietary: parseTokens(get("dietary"), DIETARY, rowNo, "dietary tag", warnings),
      allergens: parseTokens(get("allergens"), ALLERGENS, rowNo, "allergen", warnings),
      imageFilename: get("image") ? normalizeFilename(get("image")) : null,
    });
  });

  const categories = order.map((n) => byCategory.get(n)!);
  if (categories.length === 0 && errors.length === 0) {
    errors.push("No rows found. Fill in the Menu sheet and try again.");
  }
  return { menu: { categories }, errors, warnings };
}

// ---------- JSON ----------

export function parseJson(text: string): ParseResult {
  const warnings: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { menu: { categories: [] }, errors: ["File is not valid JSON."], warnings };
  }
  const cats = (raw as { categories?: unknown })?.categories;
  if (!Array.isArray(cats)) {
    return { menu: { categories: [] }, errors: ['JSON must have a "categories" array.'], warnings };
  }
  const categories: MenuCategoryIO[] = [];
  for (const c of cats as Record<string, unknown>[]) {
    if (typeof c?.name !== "string") continue;
    const items: MenuItemIO[] = [];
    for (const i of (Array.isArray(c.items) ? c.items : []) as Record<string, unknown>[]) {
      if (typeof i?.name !== "string") continue;
      const priceCents =
        typeof i.priceCents === "number" ? Math.round(i.priceCents) : Number(i.priceCents);
      if (!Number.isFinite(priceCents) || priceCents < 0) continue;
      items.push({
        name: i.name.slice(0, 120),
        description: typeof i.description === "string" ? i.description.slice(0, 2000) : null,
        priceCents,
        currency: typeof i.currency === "string" ? i.currency : "EUR",
        isAvailable: i.isAvailable !== false,
        spice: typeof i.spice === "number" ? Math.min(5, Math.max(0, i.spice)) : 0,
        dietary: (Array.isArray(i.dietary) ? i.dietary : []).filter(
          (d): d is string => typeof d === "string" && (DIETARY as readonly string[]).includes(d),
        ),
        allergens: (Array.isArray(i.allergens) ? i.allergens : []).filter(
          (a): a is string => typeof a === "string" && (ALLERGENS as readonly string[]).includes(a),
        ),
        imageFilename:
          typeof i.imageFilename === "string" ? normalizeFilename(i.imageFilename) : null,
      });
    }
    categories.push({ name: c.name.slice(0, 80), items });
  }
  return {
    menu: { categories },
    errors: categories.length === 0 ? ["No categories found in the JSON."] : [],
    warnings,
  };
}

// ---------- replace the draft ----------

export interface ReplaceSummary {
  categories: number;
  items: number;
  imagesLinked: number;
  imagesMissing: string[];
}

export async function replaceDraft(
  tenantId: string,
  menu: MenuIO,
): Promise<{ ok: false; error: "no_draft" } | ({ ok: true } & ReplaceSummary)> {
  return asTenant(tenantId, async (tx) => {
    const draft = await tx.menuVersion.findFirst({
      where: { status: "draft" },
      orderBy: { createdAt: "desc" },
      select: { id: true, tenantId: true },
    });
    if (!draft) return { ok: false as const, error: "no_draft" as const };

    // Resolve image filenames → media ids once.
    const wanted = new Set<string>();
    for (const c of menu.categories)
      for (const i of c.items) if (i.imageFilename) wanted.add(i.imageFilename);
    const media = wanted.size
      ? await tx.media.findMany({
          where: { filename: { in: [...wanted] }, deletedAt: null },
          select: { id: true, filename: true },
        })
      : [];
    const mediaByName = new Map(media.map((m) => [m.filename!, m.id]));

    await tx.category.deleteMany({ where: { menuVersionId: draft.id } });

    let itemCount = 0;
    let imagesLinked = 0;
    const missing = new Set<string>();
    let catOrder = 100;
    for (const cat of menu.categories) {
      const category = await tx.category.create({
        data: {
          tenantId: draft.tenantId,
          menuVersionId: draft.id,
          name: cat.name.slice(0, 80),
          orderIndex: catOrder,
        },
        select: { id: true },
      });
      catOrder += 100;
      let itemOrder = 100;
      for (const item of cat.items) {
        let photoMediaId: string | null = null;
        if (item.imageFilename) {
          const id = mediaByName.get(item.imageFilename);
          if (id) {
            photoMediaId = id;
            imagesLinked += 1;
          } else missing.add(item.imageFilename);
        }
        await tx.item.create({
          data: {
            tenantId: draft.tenantId,
            categoryId: category.id,
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            currency: item.currency,
            orderIndex: itemOrder,
            isAvailable: item.isAvailable,
            allergens: item.allergens as never,
            dietary: item.dietary as never,
            spice: item.spice,
            photoMediaId,
          },
        });
        itemOrder += 100;
        itemCount += 1;
      }
    }
    return {
      ok: true as const,
      categories: menu.categories.length,
      items: itemCount,
      imagesLinked,
      imagesMissing: [...missing],
    };
  });
}

// ---------- bulk image upload ----------

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export interface ImageUploadSummary {
  saved: number;
  replaced: number;
  failed: { name: string; reason: string }[];
}

export async function saveMenuImages(tenantId: string, files: File[]): Promise<ImageUploadSummary> {
  const summary: ImageUploadSummary = { saved: 0, replaced: 0, failed: [] };
  for (const file of files) {
    const name = file.name || "image";
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      summary.failed.push({ name, reason: "not a JPEG/PNG/WebP" });
      continue;
    }
    if (file.size === 0 || file.size > MAX_BYTES) {
      summary.failed.push({ name, reason: file.size === 0 ? "empty" : "over 10 MB" });
      continue;
    }
    const normalized = await normalizeImage(Buffer.from(await file.arrayBuffer()));
    if (!normalized.ok) {
      summary.failed.push({ name, reason: "could not read the image" });
      continue;
    }
    const filename = normalizeFilename(name);
    await asTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirstOrThrow({ select: { id: true } });
      const existing = await tx.media.findFirst({
        where: { filename, deletedAt: null },
        select: { id: true, storageKey: true },
      });
      const storageKey = `${tenant.id}/uploads/${randomUUID()}`;
      await writeUpload(storageKey, normalized.bytes);
      if (existing) {
        // Replace in place: new storageKey (cache-safe URL), same media id
        // so every item pointing at it updates. Drop the old bytes.
        await tx.media.update({
          where: { id: existing.id },
          data: {
            storageKey,
            width: normalized.width,
            height: normalized.height,
            bytes: normalized.bytes.length,
          },
        });
        await deleteUpload(existing.storageKey).catch(() => {});
        summary.replaced += 1;
      } else {
        await tx.media.create({
          data: {
            tenantId: tenant.id,
            storageKey,
            filename,
            width: normalized.width,
            height: normalized.height,
            bytes: normalized.bytes.length,
            altText: null,
          },
        });
        summary.saved += 1;
      }
    });
  }
  return summary;
}
