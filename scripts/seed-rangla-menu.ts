import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { templateContentSchema } from "../src/lib/menu-template-service";

/**
 * Publish the full Rangla Punjab menu from the checked-in JSON export
 * (scripts/menu-data/rangla-punjab-menu.json — 19 categories / 187 items,
 * exported from the pre-rebrand Guesto/elvoria-food database).
 *
 * The JSON is the source of truth so the menu never has to be re-copied
 * from an old database again — the same file seeds dev, CI, and the
 * production deploy. Idempotent: no-op when the currently published
 * version already matches the JSON's category/item counts (set
 * FORCE_MENU_PUBLISH=1 to publish a fresh version anyway).
 *
 * Also upserts the content as MenuTemplate key "rangla-punjab-full" so
 * the admin templates UI can re-apply it.
 *
 *   pnpm exec tsx --env-file=.env scripts/seed-rangla-menu.ts
 */

const RESTAURANT_SLUG = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
const MENU_JSON = resolve(import.meta.dirname, "menu-data/rangla-punjab-menu.json");

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const parsed = templateContentSchema.safeParse(JSON.parse(readFileSync(MENU_JSON, "utf8")));
  if (!parsed.success) {
    throw new Error(`menu JSON invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  const wantedCategories = parsed.data.categories.length;
  const wantedItems = parsed.data.categories.reduce((n, c) => n + c.items.length, 0);

  try {
    await prisma.menuTemplate.upsert({
      where: { key: "rangla-punjab-full" },
      create: {
        key: "rangla-punjab-full",
        name: "Rangla Punjab — vollständige Speisekarte",
        cuisine: "Indisch-Pakistanisch",
        emoji: "🍛",
        locale: "de",
        sortIndex: 0,
        content: parsed.data,
      },
      update: { content: parsed.data },
    });

    const venue = await prisma.venue.findUnique({
      where: { slug: RESTAURANT_SLUG },
      select: { id: true, tenantId: true, currency: true },
    });
    if (!venue)
      throw new Error(`venue "${RESTAURANT_SLUG}" not found — run seed-restaurant.ts first`);

    const menu = await prisma.menu.findFirst({
      where: { venueId: venue.id, isDefault: true, deletedAt: null },
      select: { id: true, publishedVersion: true },
    });
    if (!menu) throw new Error(`default menu for "${RESTAURANT_SLUG}" not found`);

    if (menu.publishedVersion && process.env.FORCE_MENU_PUBLISH !== "1") {
      const [cats, items] = await Promise.all([
        prisma.category.count({ where: { menuVersionId: menu.publishedVersion } }),
        prisma.item.count({
          where: { category: { menuVersionId: menu.publishedVersion }, deletedAt: null },
        }),
      ]);
      if (cats === wantedCategories && items === wantedItems) {
        process.stdout.write(
          `✓ seed-rangla-menu: published version already has ${cats} categories / ${items} items — no-op\n`,
        );
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      const version = await tx.menuVersion.create({
        data: {
          tenantId: venue.tenantId,
          menuId: menu.id,
          status: "published",
          publishedAt: new Date(),
        },
      });

      let categoryOrder = 100;
      for (const cat of parsed.data.categories) {
        const category = await tx.category.create({
          data: {
            tenantId: venue.tenantId,
            menuVersionId: version.id,
            name: cat.name,
            orderIndex: categoryOrder,
          },
          select: { id: true },
        });
        categoryOrder += 100;
        let itemOrder = 100;
        for (const item of cat.items) {
          await tx.item.create({
            data: {
              tenantId: venue.tenantId,
              categoryId: category.id,
              name: item.name,
              description: item.description ?? null,
              priceCents: item.priceCents,
              currency: venue.currency,
              orderIndex: itemOrder,
              spice: item.spice,
              dietary: item.dietary,
              allergens: item.allergens,
            },
          });
          itemOrder += 100;
        }
      }

      await tx.menu.update({
        where: { id: menu.id },
        data: { publishedVersion: version.id },
      });

      process.stdout.write(
        `✓ seed-rangla-menu: published ${wantedCategories} categories / ${wantedItems} items to /${RESTAURANT_SLUG} (version=${version.id})\n`,
      );
    });
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(
      `✗ seed-rangla-menu failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
