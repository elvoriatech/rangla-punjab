import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Dietary, type Allergen } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { templateContentSchema } from "../src/lib/menu-template-service";

/**
 * Apply the full Rangla Punjab starter menu (imported from the platform's
 * image-rich `indian-pakistani` template: 19 categories, ~187 dishes,
 * 91 photos) to the live venue — draft AND published.
 *
 * The photos ship in-repo under public/uploads/templates/indian/ and are
 * served by the existing /img/{key} resizer, so no object storage is
 * involved. The template row in menu_templates is upgraded to the rich
 * content too, so future onboarding clones get the same menu.
 *
 * Operator import (migration-privilege DATABASE_URL, like the other
 * seeds). Idempotent: media upserts by storage key; the venue's draft is
 * REPLACED by the template and republished on every run.
 *
 *   pnpm exec tsx --env-file=.env scripts/apply-menu-template.ts
 */

const VENUE_SLUG = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
const DATA_FILE = path.join(import.meta.dirname, "data", "rangla-menu-template.json");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(DATA_FILE, "utf8")) as {
    key: string;
    name: string;
    cuisine: string;
    emoji: string;
    locale: string;
    active: boolean;
    sortIndex: number;
    content: unknown;
  };
  const content = templateContentSchema.parse(raw.content);

  // 1) Upgrade the template library row (used by onboarding clones).
  await prisma.menuTemplate.upsert({
    where: { key: raw.key },
    create: {
      key: raw.key,
      name: raw.name,
      cuisine: raw.cuisine,
      emoji: raw.emoji,
      locale: raw.locale,
      active: raw.active,
      sortIndex: raw.sortIndex,
      content: raw.content as object,
    },
    update: { content: raw.content as object, name: raw.name, cuisine: raw.cuisine },
  });
  console.log(`template '${raw.key}' upserted (${content.categories.length} categories)`);

  // 2) Resolve the venue and its default menu.
  const venue = await prisma.venue.findFirst({
    where: { slug: VENUE_SLUG, deletedAt: null },
    select: { id: true, tenantId: true },
  });
  if (!venue) throw new Error(`venue '${VENUE_SLUG}' not found`);
  const menu = await prisma.menu.findFirst({
    where: { venueId: venue.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!menu) throw new Error("venue has no menu row");

  // 3) Media rows for every referenced photo (upsert by storage key).
  const keys = new Map<string, { width: number; height: number; bytes: number }>();
  for (const cat of content.categories) {
    if (cat.image) keys.set(cat.image.key, cat.image);
    for (const item of cat.items) if (item.image) keys.set(item.image.key, item.image);
  }
  const mediaByKey = new Map<string, string>();
  for (const [key, meta] of keys) {
    const existing = await prisma.media.findFirst({
      where: { tenantId: venue.tenantId, storageKey: key, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      mediaByKey.set(key, existing.id);
    } else {
      const created = await prisma.media.create({
        data: {
          tenantId: venue.tenantId,
          storageKey: key,
          width: meta.width,
          height: meta.height,
          bytes: meta.bytes,
          filename: path.basename(key).toLowerCase(),
        },
        select: { id: true },
      });
      mediaByKey.set(key, created.id);
    }
  }
  console.log(`media ready: ${mediaByKey.size} photos`);

  // 4) Replace the draft with the template tree.
  await prisma.$transaction(
    async (tx) => {
      let draft = await tx.menuVersion.findFirst({
        where: { menuId: menu.id, status: "draft" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!draft) {
        draft = await tx.menuVersion.create({
          data: { tenantId: venue.tenantId, menuId: menu.id, status: "draft" },
          select: { id: true },
        });
      }
      await tx.category.deleteMany({ where: { menuVersionId: draft.id } });
      let catIndex = 0;
      for (const cat of content.categories) {
        await tx.category.create({
          data: {
            tenantId: venue.tenantId,
            menuVersionId: draft.id,
            name: cat.name,
            orderIndex: catIndex,
            photoMediaId: cat.image ? mediaByKey.get(cat.image.key) : undefined,
            items: {
              create: cat.items.map((item, i) => ({
                tenantId: venue.tenantId,
                name: item.name,
                description: item.description ?? null,
                priceCents: item.priceCents,
                currency: "EUR",
                orderIndex: i,
                isAvailable: true,
                allergens: (item.allergens ?? []) as Allergen[],
                dietary: (item.dietary ?? []) as Dietary[],
                spice: item.spice ?? 0,
                photoMediaId: item.image ? mediaByKey.get(item.image.key) : undefined,
              })),
            },
          },
        });
        catIndex += 1;
      }

      // 5) Publish: deep-copy the draft into a fresh published version
      // (same shape as publishDraft in menu-versions-service).
      const tree = await tx.menuVersion.findFirstOrThrow({
        where: { id: draft.id },
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
                  currency: true,
                  orderIndex: true,
                  isAvailable: true,
                  allergens: true,
                  traces: true,
                  dietary: true,
                  spice: true,
                  flags: true,
                  photoMediaId: true,
                },
                orderBy: { orderIndex: "asc" },
              },
            },
            orderBy: { orderIndex: "asc" },
          },
        },
      });
      const published = await tx.menuVersion.create({
        data: {
          tenantId: venue.tenantId,
          menuId: menu.id,
          status: "published",
          publishedAt: new Date(),
          categories: {
            create: tree.categories.map((cat) => ({
              tenantId: venue.tenantId,
              name: cat.name,
              orderIndex: cat.orderIndex,
              photoMediaId: cat.photoMediaId,
              items: {
                create: cat.items.map((item) => ({
                  tenantId: venue.tenantId,
                  name: item.name,
                  description: item.description,
                  priceCents: item.priceCents,
                  currency: item.currency,
                  orderIndex: item.orderIndex,
                  isAvailable: item.isAvailable,
                  allergens: item.allergens,
                  traces: item.traces,
                  dietary: item.dietary,
                  spice: item.spice,
                  flags: item.flags as object,
                  photoMediaId: item.photoMediaId,
                })),
              },
            })),
          },
        },
        select: { id: true },
      });
      await tx.menu.update({
        where: { id: menu.id },
        data: { publishedVersion: published.id },
      });
      console.log(`published version ${published.id}`);
    },
    { timeout: 120_000 },
  );

  const counts = await prisma.item.count({
    where: { tenantId: venue.tenantId, category: { menuVersion: { status: "published" } } },
  });
  console.log(`done — venue '${VENUE_SLUG}' now serves the full template (${counts} items live)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
