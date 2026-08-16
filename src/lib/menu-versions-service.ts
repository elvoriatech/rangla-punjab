import type { Prisma } from "@prisma/client";
import { asUser, asTenant } from "./tenant";

/**
 * Draft/publish workflow. The draft `MenuVersion` is the mutable working
 * copy (categories + items + variants keyed to it via FK). Publishing
 * deep-copies the entire draft tree into a *new* MenuVersion row marked
 * `published`, and points `Menu.publishedVersion` at it. Future edits keep
 * going to the same draft row; each publish creates another frozen row.
 *
 * The whole snapshot lands in a single Prisma nested `create` call, which
 * Prisma wraps in one transaction — so a publish is atomic even under
 * concurrent draft edits.
 */

export type PublishResult =
  | { ok: true; publishedVersionId: string; publishedAt: Date }
  | { ok: false; error: "no_draft" | "empty_menu" };

/**
 * Guarantee the tenant's menu has a draft to edit. The draft is the
 * permanent working copy, but a restaurant provisioned straight to a
 * published version (operator provisioning + the seed script both do this)
 * starts with no draft — so the menu editor had nothing to open and would
 * bounce the owner back to the dashboard.
 *
 * When no draft exists we fork one from the current published version so
 * the editor shows the live menu; if there is no published version either
 * (a blank menu), we create an empty draft so the template picker appears.
 * A no-op when a draft already exists.
 */
async function ensureDraftInTx(tx: Prisma.TransactionClient): Promise<{ ok: boolean }> {
  {
    const existing = await tx.menuVersion.findFirst({
      where: { status: "draft" },
      select: { id: true },
    });
    if (existing) return { ok: true };

    const menu = await tx.menu.findFirst({
      select: { id: true, tenantId: true, publishedVersion: true },
    });
    if (!menu) return { ok: false };

    const source = menu.publishedVersion
      ? await tx.menuVersion.findFirst({
          where: { id: menu.publishedVersion },
          select: {
            categories: {
              select: {
                name: true,
                orderIndex: true,
                photoMediaId: true,
                items: {
                  where: { deletedAt: null },
                  select: {
                    name: true,
                    description: true,
                    priceCents: true,
                    offerPriceCents: true,
                    offerStartsAt: true,
                    offerEndsAt: true,
                    offerWeekly: true,
                    currency: true,
                    orderIndex: true,
                    isAvailable: true,
                    allergens: true,
                    traces: true,
                    dietary: true,
                    spice: true,
                    flags: true,
                    photoMediaId: true,
                    variants: {
                      select: { name: true, priceDeltaCents: true, orderIndex: true },
                      orderBy: { orderIndex: "asc" },
                    },
                  },
                  orderBy: { orderIndex: "asc" },
                },
              },
              orderBy: { orderIndex: "asc" },
            },
          },
        })
      : null;

    await tx.menuVersion.create({
      data: {
        tenantId: menu.tenantId,
        menuId: menu.id,
        status: "draft",
        categories: source
          ? {
              create: source.categories.map((cat) => ({
                tenantId: menu.tenantId,
                name: cat.name,
                orderIndex: cat.orderIndex,
                photoMediaId: cat.photoMediaId,
                items: {
                  create: cat.items.map((item) => ({
                    tenantId: menu.tenantId,
                    name: item.name,
                    description: item.description,
                    priceCents: item.priceCents,
                    // The offer rides the copy — forgetting this is the one
                    // silent-drop bug this design has (see docs).
                    offerPriceCents: item.offerPriceCents,
                    offerStartsAt: item.offerStartsAt,
                    offerEndsAt: item.offerEndsAt,
                    offerWeekly: item.offerWeekly ?? undefined,
                    currency: item.currency,
                    orderIndex: item.orderIndex,
                    isAvailable: item.isAvailable,
                    allergens: item.allergens,
                    traces: item.traces,
                    dietary: item.dietary,
                    spice: item.spice,
                    flags: item.flags as object,
                    photoMediaId: item.photoMediaId,
                    variants: {
                      create: item.variants.map((v) => ({
                        tenantId: menu.tenantId,
                        name: v.name,
                        priceDeltaCents: v.priceDeltaCents,
                        orderIndex: v.orderIndex,
                      })),
                    },
                  })),
                },
              })),
            }
          : undefined,
      },
    });
    return { ok: true };
  }
}

export async function ensureDraft(userId: string): Promise<{ ok: boolean }> {
  return asUser(userId, ensureDraftInTx);
}

/** Operator variant: ensure the given tenant's menu has a draft. */
export async function ensureDraftForTenant(tenantId: string): Promise<{ ok: boolean }> {
  return asTenant(tenantId, ensureDraftInTx);
}

export async function publishDraft(userId: string): Promise<PublishResult> {
  return asUser(userId, async (tx) => {
    const draft = await tx.menuVersion.findFirst({
      where: { status: "draft" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        menuId: true,
        categories: {
          select: {
            name: true,
            orderIndex: true,
            photoMediaId: true,
            items: {
              // Include soft-deleted-out items — snapshot only the *live*
              // set the guest would see today.
              where: { deletedAt: null },
              select: {
                name: true,
                description: true,
                priceCents: true,
                offerPriceCents: true,
                offerStartsAt: true,
                offerEndsAt: true,
                offerWeekly: true,
                currency: true,
                orderIndex: true,
                isAvailable: true,
                allergens: true,
                traces: true,
                dietary: true,
                spice: true,
                flags: true,
                photoMediaId: true,
                variants: {
                  select: { name: true, priceDeltaCents: true, orderIndex: true },
                  orderBy: { orderIndex: "asc" },
                },
              },
              orderBy: { orderIndex: "asc" },
            },
          },
          orderBy: { orderIndex: "asc" },
        },
      },
    });
    if (!draft) return { ok: false, error: "no_draft" };
    if (draft.categories.length === 0) return { ok: false, error: "empty_menu" };

    const publishedAt = new Date();
    const published = await tx.menuVersion.create({
      data: {
        tenantId: draft.tenantId,
        menuId: draft.menuId,
        status: "published",
        publishedAt,
        categories: {
          create: draft.categories.map((cat) => ({
            tenantId: draft.tenantId,
            name: cat.name,
            orderIndex: cat.orderIndex,
            photoMediaId: cat.photoMediaId,
            items: {
              create: cat.items.map((item) => ({
                tenantId: draft.tenantId,
                name: item.name,
                description: item.description,
                priceCents: item.priceCents,
                offerPriceCents: item.offerPriceCents,
                offerStartsAt: item.offerStartsAt,
                offerEndsAt: item.offerEndsAt,
                offerWeekly: item.offerWeekly ?? undefined,
                currency: item.currency,
                orderIndex: item.orderIndex,
                isAvailable: item.isAvailable,
                allergens: item.allergens,
                traces: item.traces,
                dietary: item.dietary,
                spice: item.spice,
                flags: item.flags as object,
                photoMediaId: item.photoMediaId,
                variants: {
                  create: item.variants.map((v) => ({
                    tenantId: draft.tenantId,
                    name: v.name,
                    priceDeltaCents: v.priceDeltaCents,
                    orderIndex: v.orderIndex,
                  })),
                },
              })),
            },
          })),
        },
      },
      select: { id: true },
    });

    // Point the menu at the fresh published version. Old published versions
    // stay on the row for history/rollback until an explicit cleanup task.
    await tx.menu.update({
      where: { id: draft.menuId },
      data: { publishedVersion: published.id },
    });

    return { ok: true, publishedVersionId: published.id, publishedAt };
  });
}

export interface MenuStatus {
  hasDraft: boolean;
  draftCategoryCount: number;
  publishedVersionId: string | null;
  publishedAt: Date | null;
  /** True when the draft holds edits guests can't see yet — drives the
   *  Publish button's enabled state. */
  hasUnpublishedChanges: boolean;
}

export async function getMenuStatus(userId: string): Promise<MenuStatus> {
  return asUser(userId, async (tx) => {
    const menu = await tx.menu.findFirst({
      select: { id: true, publishedVersion: true },
    });
    const draft = await tx.menuVersion.findFirst({
      where: { status: "draft" },
      orderBy: { createdAt: "desc" },
      select: { id: true, updatedAt: true, _count: { select: { categories: true } } },
    });
    const publishedVersion = menu?.publishedVersion
      ? await tx.menuVersion.findFirst({
          where: { id: menu.publishedVersion },
          select: { id: true, publishedAt: true },
        })
      : null;

    // "Unpublished changes" = any draft edit newer than the last publish.
    // Publishing snapshots the draft without touching its rows, so every
    // timestamp stays behind publishedAt until the owner edits again.
    // Category deletion has no row left to carry a timestamp — the
    // delete path bumps the draft version's own updatedAt instead.
    let hasUnpublishedChanges = false;
    if (draft && draft._count.categories > 0) {
      if (!publishedVersion?.publishedAt) {
        hasUnpublishedChanges = true;
      } else {
        const [catMax, itemMax, variantMax] = await Promise.all([
          tx.category.aggregate({
            where: { menuVersionId: draft.id },
            _max: { updatedAt: true },
          }),
          tx.item.aggregate({
            where: { category: { menuVersionId: draft.id } },
            _max: { updatedAt: true },
          }),
          tx.itemVariant.aggregate({
            where: { item: { category: { menuVersionId: draft.id } } },
            _max: { updatedAt: true },
          }),
        ]);
        const latestEdit = Math.max(
          draft.updatedAt.getTime(),
          catMax._max.updatedAt?.getTime() ?? 0,
          itemMax._max.updatedAt?.getTime() ?? 0,
          variantMax._max.updatedAt?.getTime() ?? 0,
        );
        hasUnpublishedChanges = latestEdit > publishedVersion.publishedAt.getTime();
      }
    }

    return {
      hasDraft: !!draft,
      draftCategoryCount: draft?._count.categories ?? 0,
      publishedVersionId: publishedVersion?.id ?? null,
      publishedAt: publishedVersion?.publishedAt ?? null,
      hasUnpublishedChanges,
    };
  });
}
