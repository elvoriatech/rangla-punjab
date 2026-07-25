import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { asUser } from "./tenant";

/**
 * Items service — CRUD against a category in the tenant's draft menu.
 * All work flows through `asUser` so RLS scopes writes automatically.
 * Ordering shares the 100-unit-gap convention with categories (P1-5).
 * Soft-delete: `deletedAt` is set; list/reads filter it out; hard delete
 * would cascade to variants and lose history the audit log will want.
 */

const ORDER_STEP = 100;

// 14 EU allergens per Regulation 1169/2011. Mirrored to the Prisma enum;
// keeping the source-of-truth here in one place makes zod validation cheap.
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

export const variantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  priceDeltaCents: z.number().int().min(-1_000_000).max(1_000_000),
});

export const createItemSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  priceCents: z.number().int().min(0).max(1_000_000),
  currency: z.string().length(3).optional(),
  allergens: z.array(z.enum(ALLERGENS)).max(14).default([]),
  traces: z.array(z.enum(ALLERGENS)).max(14).default([]),
  dietary: z.array(z.enum(DIETARY)).max(6).default([]),
  spice: z.number().int().min(0).max(5).default(0),
  isAvailable: z.boolean().default(true),
  photoMediaId: z.string().min(1).optional(),
  variants: z.array(variantSchema).max(20).default([]),
});

export const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  priceCents: z.number().int().min(0).max(1_000_000).optional(),
  allergens: z.array(z.enum(ALLERGENS)).max(14).optional(),
  traces: z.array(z.enum(ALLERGENS)).max(14).optional(),
  dietary: z.array(z.enum(DIETARY)).max(6).optional(),
  spice: z.number().int().min(0).max(5).optional(),
  isAvailable: z.boolean().optional(),
  photoMediaId: z.string().min(1).nullable().optional(),
});

export interface ItemRow {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  orderIndex: number;
  isAvailable: boolean;
  allergens: string[];
  traces: string[];
  dietary: string[];
  spice: number;
  photoMediaId: string | null;
  /** Storage key of the linked photo, for building /img/ URLs in lists. */
  photoKey: string | null;
  variants: { id: string; name: string; priceDeltaCents: number; orderIndex: number }[];
}

export type ServiceResult<T = void> =
  { ok: true; value: T } | { ok: false; error: "not_found" | "invalid" };

const itemSelect = {
  id: true,
  categoryId: true,
  name: true,
  description: true,
  priceCents: true,
  currency: true,
  orderIndex: true,
  isAvailable: true,
  allergens: true,
  traces: true,
  dietary: true,
  spice: true,
  photoMediaId: true,
  photoMedia: { select: { storageKey: true } },
  variants: {
    select: { id: true, name: true, priceDeltaCents: true, orderIndex: true },
    orderBy: { orderIndex: "asc" },
  },
} satisfies Prisma.ItemSelect;

type ItemRowSource = Omit<ItemRow, "photoKey"> & {
  photoMedia: { storageKey: string } | null;
};

function toItemRow(row: ItemRowSource): ItemRow {
  const { photoMedia, ...rest } = row;
  return { ...rest, photoKey: photoMedia?.storageKey ?? null };
}

export async function listItems(
  userId: string,
  categoryId: string,
): Promise<ServiceResult<ItemRow[]>> {
  return asUser(userId, async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) return { ok: false, error: "not_found" };
    const rows = await tx.item.findMany({
      where: { categoryId, deletedAt: null },
      orderBy: { orderIndex: "asc" },
      select: itemSelect,
    });
    return { ok: true, value: rows.map(toItemRow) };
  });
}

/**
 * Uses `z.input` (not `z.infer`) so callers may omit fields with
 * `.default()` in the schema. The service applies the schema's defaults
 * itself via `parse`, which keeps route handlers and tests symmetric.
 */
export async function createItem(
  userId: string,
  raw: z.input<typeof createItemSchema>,
): Promise<ServiceResult<ItemRow>> {
  const input = createItemSchema.parse(raw);
  return asUser(userId, async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: input.categoryId },
      select: { id: true, tenantId: true },
    });
    if (!category) return { ok: false, error: "not_found" };

    const max = await tx.item.aggregate({
      where: { categoryId: category.id, deletedAt: null },
      _max: { orderIndex: true },
    });
    const nextOrder = (max._max.orderIndex ?? 0) + ORDER_STEP;

    // New items inherit the venue's currency unless the caller pins one —
    // a CHF venue must not accumulate EUR dishes because of a code default.
    const venue = input.currency
      ? null
      : await tx.venue.findFirst({ where: { deletedAt: null }, select: { currency: true } });

    // Variants get their own 100-unit-gap ordering, and the same tenantId
    // as the item so RLS on `item_variants` matches on write.
    const created = await tx.item.create({
      data: {
        tenantId: category.tenantId,
        categoryId: category.id,
        name: input.name,
        description: input.description,
        priceCents: input.priceCents,
        currency: input.currency ?? venue?.currency ?? "EUR",
        allergens: input.allergens,
        traces: input.traces,
        dietary: input.dietary,
        spice: input.spice,
        isAvailable: input.isAvailable,
        orderIndex: nextOrder,
        photoMediaId: input.photoMediaId,
        variants: {
          create: input.variants.map((v, i) => ({
            tenantId: category.tenantId,
            name: v.name,
            priceDeltaCents: v.priceDeltaCents,
            orderIndex: (i + 1) * ORDER_STEP,
          })),
        },
      },
      select: itemSelect,
    });
    return { ok: true, value: toItemRow(created) };
  });
}

export async function updateItem(
  userId: string,
  id: string,
  patch: z.infer<typeof updateItemSchema>,
): Promise<ServiceResult<ItemRow>> {
  return asUser(userId, async (tx) => {
    const existing = await tx.item.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "not_found" };
    const updated = await tx.item.update({
      where: { id },
      data: patch,
      select: itemSelect,
    });
    return { ok: true, value: toItemRow(updated) };
  });
}

export async function softDeleteItem(userId: string, id: string): Promise<ServiceResult> {
  return asUser(userId, async (tx) => {
    const existing = await tx.item.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "not_found" };
    await tx.item.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true, value: undefined };
  });
}
