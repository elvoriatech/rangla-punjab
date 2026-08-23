import { z } from "zod";
import { asUser } from "./tenant";

/**
 * Categories service — CRUD + reorder against the tenant's current draft
 * MenuVersion. All writes flow through `asUser` so RLS scopes them to the
 * caller's tenant automatically. Ordering is server-authoritative: reorder
 * rewrites every row's `orderIndex` in a single transaction rather than
 * trusting the client to send correct gaps.
 *
 * A tenant is expected to have exactly one draft version at any time (P1-4
 * provisions it at onboarding, P1-7 will manage draft/publish transitions).
 * If none exists, every method returns `no_draft` — the caller should treat
 * that as "finish onboarding first".
 */

// 100-unit gaps are enough headroom for opportunistic mid-insertion without
// a full renumber; we still renumber on any explicit reorder so drift stays
// bounded.
const ORDER_STEP = 100;

export const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  photoMediaId: z.string().min(1).optional(),
});
export const renameSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});
export const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(200),
});

export interface Category {
  id: string;
  name: string;
  orderIndex: number;
  photoMediaId: string | null;
  /** Storage key of the linked photo, for building /img/ URLs in lists. */
  photoKey: string | null;
}

export type ServiceResult<T = void> =
  { ok: true; value: T } | { ok: false; error: "no_draft" | "not_found" | "invalid" };

const categorySelect = {
  id: true,
  name: true,
  orderIndex: true,
  photoMediaId: true,
  photoMedia: { select: { storageKey: true } },
} as const;

type CategoryRow = {
  id: string;
  name: string;
  orderIndex: number;
  photoMediaId: string | null;
  photoMedia: { storageKey: string } | null;
};

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    orderIndex: row.orderIndex,
    photoMediaId: row.photoMediaId,
    photoKey: row.photoMedia?.storageKey ?? null,
  };
}

export async function listCategories(userId: string): Promise<ServiceResult<Category[]>> {
  return asUser(userId, async (tx) => {
    const draft = await findDraft(tx);
    if (!draft) return { ok: false, error: "no_draft" };
    const rows = await tx.category.findMany({
      where: { menuVersionId: draft.id },
      orderBy: { orderIndex: "asc" },
      select: categorySelect,
    });
    return { ok: true, value: rows.map(toCategory) };
  });
}

export async function createCategory(
  userId: string,
  input: z.infer<typeof createSchema>,
): Promise<ServiceResult<Category>> {
  return asUser(userId, async (tx) => {
    const draft = await findDraft(tx);
    if (!draft) return { ok: false, error: "no_draft" };
    const max = await tx.category.aggregate({
      where: { menuVersionId: draft.id },
      _max: { orderIndex: true },
    });
    const nextOrder = (max._max.orderIndex ?? 0) + ORDER_STEP;
    // tenantId lives on Category too (denormalised for RLS — see P0-3
    // schema comments). Passing it explicitly satisfies the `WITH CHECK`
    // policy without a subquery in Prisma-land.
    const created = await tx.category.create({
      data: {
        tenantId: draft.tenantId,
        menuVersionId: draft.id,
        name: input.name,
        orderIndex: nextOrder,
        photoMediaId: input.photoMediaId ?? null,
      },
      select: categorySelect,
    });
    return { ok: true, value: toCategory(created) };
  });
}

export async function renameCategory(
  userId: string,
  input: z.infer<typeof renameSchema>,
): Promise<ServiceResult<Category>> {
  return asUser(userId, async (tx) => {
    const draft = await findDraft(tx);
    if (!draft) return { ok: false, error: "no_draft" };
    const existing = await tx.category.findFirst({
      where: { id: input.id, menuVersionId: draft.id },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "not_found" };
    const updated = await tx.category.update({
      where: { id: input.id },
      data: { name: input.name },
      select: categorySelect,
    });
    return { ok: true, value: toCategory(updated) };
  });
}

/** Set (or clear, with null) an existing category's photo — creation-time
 *  uploads exist, but owners add photos later too. Draft-only, like every
 *  other category edit. */
export async function setCategoryPhoto(
  userId: string,
  id: string,
  photoMediaId: string | null,
): Promise<ServiceResult<Category>> {
  return asUser(userId, async (tx) => {
    const draft = await findDraft(tx);
    if (!draft) return { ok: false, error: "no_draft" };
    const existing = await tx.category.findFirst({
      where: { id, menuVersionId: draft.id },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "not_found" };
    const updated = await tx.category.update({
      where: { id },
      data: { photoMediaId },
      select: categorySelect,
    });
    return { ok: true, value: toCategory(updated) };
  });
}

export async function deleteCategory(userId: string, id: string): Promise<ServiceResult> {
  return asUser(userId, async (tx) => {
    const draft = await findDraft(tx);
    if (!draft) return { ok: false, error: "no_draft" };
    const existing = await tx.category.findFirst({
      where: { id, menuVersionId: draft.id },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "not_found" };
    await tx.category.delete({ where: { id } });
    // The deleted row can't carry an updatedAt anymore — bump the draft
    // version itself so "unpublished changes" detection sees the edit.
    await tx.menuVersion.update({
      where: { id: draft.id },
      data: { updatedAt: new Date() },
    });
    return { ok: true, value: undefined };
  });
}

export async function reorderCategories(
  userId: string,
  input: z.infer<typeof reorderSchema>,
): Promise<ServiceResult> {
  return asUser(userId, async (tx) => {
    const draft = await findDraft(tx);
    if (!draft) return { ok: false, error: "no_draft" };

    // Every id in the payload must belong to this draft — otherwise a
    // client could shuffle another tenant's category via a stray id (RLS
    // would block the update anyway, but rejecting up front is clearer).
    const rows = await tx.category.findMany({
      where: { id: { in: input.orderedIds }, menuVersionId: draft.id },
      select: { id: true },
    });
    if (rows.length !== input.orderedIds.length) {
      return { ok: false, error: "not_found" };
    }

    // Full renumber so the resulting sequence is drift-free. `updateMany`
    // can't set per-row values, so we issue one update per row — cheap for
    // realistic N (a few dozen per menu at most).
    await Promise.all(
      input.orderedIds.map((id, i) =>
        tx.category.update({
          where: { id },
          data: { orderIndex: (i + 1) * ORDER_STEP },
        }),
      ),
    );
    return { ok: true, value: undefined };
  });
}

// ---- helpers ----

interface DraftRef {
  id: string;
  tenantId: string;
}

async function findDraft(
  tx: Parameters<Parameters<typeof asUser>[1]>[0],
): Promise<DraftRef | null> {
  const draft = await tx.menuVersion.findFirst({
    where: { status: "draft" },
    orderBy: { createdAt: "desc" },
    select: { id: true, tenantId: true },
  });
  return draft;
}
