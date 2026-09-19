import type { Prisma } from "@prisma/client";
import { asUser, asTenant } from "./tenant";

/**
 * Draft/publish workflow. The draft `MenuVersion` is the mutable working
 * copy (categories + items + variants keyed to it via FK). Publishing
 * deep-copies the entire draft tree into a *new* MenuVersion row marked
 * `published`, and points `Menu.publishedVersion` at it. Future edits keep
 * going to the same draft row; each publish creates another frozen row.
 *
 * The whole snapshot lands in a single Prisma nested `create` call inside
 * the caller's RLS transaction — so a publish is atomic even under
 * concurrent draft edits. The owner's `Translation` rows are re-emitted
 * against the copy's fresh ids in the same transaction (see
 * `copyTranslations`), which is what keeps dish translations alive across
 * publishes.
 */

export type PublishResult =
  | { ok: true; publishedVersionId: string; publishedAt: Date }
  | { ok: false; error: "no_draft" | "empty_menu" };

/**
 * Snapshot ordering is RENUMBERED with this gap instead of carrying the
 * source `orderIndex` verbatim. Relative order is what guests see, and
 * renumbering guarantees every (parent, orderIndex) pair inside the copy
 * is unique — which is what lets `pairSnapshotIds` below match a source
 * row to its fresh copy by position, and therefore lets translations
 * follow the snapshot.
 */
const SNAPSHOT_ORDER_STEP = 100;

/** Everything a category needs to be deep-copied into another version. */
const snapshotSourceSelect = {
  id: true,
  name: true,
  photoMediaId: true,
  items: {
    // Snapshot only the *live* set the guest would see today.
    where: { deletedAt: null },
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
      flags: true,
      photoMediaId: true,
      variants: {
        select: { id: true, name: true, priceDeltaCents: true },
        orderBy: { orderIndex: "asc" },
      },
    },
    orderBy: { orderIndex: "asc" },
  },
} satisfies Prisma.CategorySelect;

/** The ids of a freshly created snapshot tree, in the same order. */
const snapshotIdSelect = {
  id: true,
  items: {
    select: { id: true, variants: { select: { id: true }, orderBy: { orderIndex: "asc" } } },
    orderBy: { orderIndex: "asc" },
  },
} satisfies Prisma.CategorySelect;

type SnapshotSource = Prisma.CategoryGetPayload<{ select: typeof snapshotSourceSelect }>;
type SnapshotIds = Prisma.CategoryGetPayload<{ select: typeof snapshotIdSelect }>;

/**
 * Nested-create payload that deep-copies `categories` into a new version.
 *
 * `linkSource` writes `sourceItemId` on every copy, pointing at the row it was
 * copied from. Set when PUBLISHING (the copy is the published twin of a draft
 * item, and the restaurant app's live edits walk that link), cleared when
 * forking a draft out of a published version — there the copy is the draft, so
 * the link has to run the other way and is written afterwards by
 * `backlinkSources`.
 */
function snapshotCategories(
  tenantId: string,
  categories: SnapshotSource[],
  { linkSource = false }: { linkSource?: boolean } = {},
) {
  return categories.map((cat, ci) => ({
    tenantId,
    name: cat.name,
    orderIndex: (ci + 1) * SNAPSHOT_ORDER_STEP,
    photoMediaId: cat.photoMediaId,
    items: {
      create: cat.items.map((item, ii) => ({
        tenantId,
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
        orderIndex: (ii + 1) * SNAPSHOT_ORDER_STEP,
        isAvailable: item.isAvailable,
        allergens: item.allergens,
        traces: item.traces,
        dietary: item.dietary,
        spice: item.spice,
        flags: item.flags as object,
        photoMediaId: item.photoMediaId,
        sourceItemId: linkSource ? item.id : null,
        variants: {
          create: item.variants.map((v, vi) => ({
            tenantId,
            name: v.name,
            priceDeltaCents: v.priceDeltaCents,
            orderIndex: (vi + 1) * SNAPSHOT_ORDER_STEP,
          })),
        },
      })),
    },
  }));
}

interface IdPair {
  entityType: "category" | "item" | "item_variant";
  oldId: string;
  newId: string;
}

/**
 * Walk the source tree and the created tree in lock-step to learn which
 * new row is the copy of which old one. Both are read back ordered by
 * `orderIndex`, and `snapshotCategories` renumbered those indexes without
 * ties, so position `i` on one side is position `i` on the other.
 */
function pairSnapshotIds(source: SnapshotSource[], created: SnapshotIds[]): IdPair[] {
  const pairs: IdPair[] = [];
  source.forEach((cat, ci) => {
    const newCat = created[ci];
    if (!newCat) return;
    pairs.push({ entityType: "category", oldId: cat.id, newId: newCat.id });
    cat.items.forEach((item, ii) => {
      const newItem = newCat.items[ii];
      if (!newItem) return;
      pairs.push({ entityType: "item", oldId: item.id, newId: newItem.id });
      item.variants.forEach((variant, vi) => {
        const newVariant = newItem.variants[vi];
        if (!newVariant) return;
        pairs.push({ entityType: "item_variant", oldId: variant.id, newId: newVariant.id });
      });
    });
  });
  return pairs;
}

/**
 * Point the SOURCE items at their fresh copies — the fork direction of
 * `sourceItemId`.
 *
 * Used when a draft is forked out of a published version: the copies are the
 * draft, so each published row has to learn which brand-new draft row is its
 * twin. Without this a forked venue would have a published menu whose rows
 * point at draft ids that no longer exist, and every live edit from the
 * restaurant's app would report `mirrored: false`.
 */
async function backlinkSources(tx: Prisma.TransactionClient, pairs: IdPair[]): Promise<void> {
  for (const pair of pairs) {
    if (pair.entityType !== "item") continue;
    await tx.item.updateMany({ where: { id: pair.oldId }, data: { sourceItemId: pair.newId } });
  }
}

/**
 * Re-emit the owner's dish/category translations against the snapshot's
 * ids. A snapshot creates brand-new rows, and `Translation` points at an
 * entity id — so without this every publish (and every draft fork) would
 * orphan the translations and guests would silently drop back to the
 * default language.
 */
async function copyTranslations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  pairs: IdPair[],
): Promise<void> {
  if (pairs.length === 0) return;
  const idsOf = (type: IdPair["entityType"]): string[] =>
    pairs.filter((p) => p.entityType === type).map((p) => p.oldId);

  const rows = await tx.translation.findMany({
    where: {
      OR: [
        { entityType: "category", entityId: { in: idsOf("category") } },
        { entityType: "item", entityId: { in: idsOf("item") } },
        { entityType: "item_variant", entityId: { in: idsOf("item_variant") } },
      ],
    },
    select: { entityType: true, entityId: true, locale: true, field: true, value: true },
  });
  if (rows.length === 0) return;

  const newIdFor = new Map(pairs.map((p) => [`${p.entityType}:${p.oldId}`, p.newId]));
  await tx.translation.createMany({
    data: rows.flatMap((r) => {
      const entityId = newIdFor.get(`${r.entityType}:${r.entityId}`);
      return entityId
        ? [
            {
              tenantId,
              entityType: r.entityType,
              entityId,
              locale: r.locale,
              field: r.field,
              value: r.value,
            },
          ]
        : [];
    }),
  });
}

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
            categories: { select: snapshotSourceSelect, orderBy: { orderIndex: "asc" } },
          },
        })
      : null;

    const forked = await tx.menuVersion.create({
      data: {
        tenantId: menu.tenantId,
        menuId: menu.id,
        status: "draft",
        categories: source
          ? { create: snapshotCategories(menu.tenantId, source.categories) }
          : undefined,
      },
      select: { categories: { select: snapshotIdSelect, orderBy: { orderIndex: "asc" } } },
    });
    if (source) {
      const pairs = pairSnapshotIds(source.categories, forked.categories);
      await copyTranslations(tx, menu.tenantId, pairs);
      await backlinkSources(tx, pairs);
    }
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
        categories: { select: snapshotSourceSelect, orderBy: { orderIndex: "asc" } },
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
        // Every published copy carries a link back to the draft row it came
        // from, so the restaurant app can edit the pair and go live at once.
        categories: {
          create: snapshotCategories(draft.tenantId, draft.categories, { linkSource: true }),
        },
      },
      select: {
        id: true,
        categories: { select: snapshotIdSelect, orderBy: { orderIndex: "asc" } },
      },
    });

    await copyTranslations(
      tx,
      draft.tenantId,
      pairSnapshotIds(draft.categories, published.categories),
    );

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
