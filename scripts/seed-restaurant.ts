import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";
import { templateContentSchema } from "../src/lib/menu-template-service";

/**
 * White-label provisioning primitive (P1-1). Creates one restaurant
 * end-to-end from a starter template:
 *
 *   tenant → owner User + Membership(owner) → venue → default menu
 *          → published MenuVersion populated from a MenuTemplate
 *
 * Run seed-menu-templates.ts first so the template exists. Idempotent:
 * a no-op once the venue slug is present. Uses the migration-privilege
 * connection (DATABASE_URL) — this is operator-provisioned setup data,
 * not tenant-authored content, so RLS is not the barrier here.
 *
 * Config via env (all optional; defaults provision a demo restaurant):
 *   RESTAURANT_NAME   default "Demo Restaurant"
 *   RESTAURANT_SLUG   default "demo-restaurant"
 *   OWNER_EMAIL       default "owner@example.com"
 *   OWNER_PASSWORD    default "Resto-Owner-2026!" (dev only; set in prod.env on deploy)
 *   TEMPLATE_KEY      default "indian-pakistani"
 *   CURRENCY          default "EUR"
 *   DEFAULT_LOCALE    default "en"
 *
 *   pnpm exec tsx --env-file=.env scripts/seed-restaurant.ts
 */

const RESTAURANT_NAME = process.env.RESTAURANT_NAME ?? "Demo Restaurant";
const RESTAURANT_SLUG = process.env.RESTAURANT_SLUG ?? "demo-restaurant";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "Resto-Owner-2026!";
const TEMPLATE_KEY = process.env.TEMPLATE_KEY ?? "indian-pakistani";
const CURRENCY = process.env.CURRENCY ?? "EUR";
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE ?? "en";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const existing = await prisma.venue.findUnique({
      where: { slug: RESTAURANT_SLUG },
      select: { id: true },
    });
    if (existing) {
      process.stdout.write(
        `✓ seed-restaurant: /r/${RESTAURANT_SLUG} already exists (${existing.id}) — no-op\n`,
      );
      return;
    }

    // Resolve the starter template up front so a bad key fails before we
    // create anything.
    const template = await prisma.menuTemplate.findUnique({
      where: { key: TEMPLATE_KEY },
      select: { content: true, name: true },
    });
    if (!template) {
      throw new Error(`template "${TEMPLATE_KEY}" not found — run seed-menu-templates.ts first`);
    }
    const parsed = templateContentSchema.safeParse(template.content);
    if (!parsed.success) throw new Error(`template "${TEMPLATE_KEY}" content is invalid`);

    const passwordHash = await hashPassword(OWNER_PASSWORD);

    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: RESTAURANT_NAME,
          onboardingState: { step: 4 },
          onboardingCompletedAt: new Date(),
        },
      });

      const user = await tx.user.create({
        data: { email: OWNER_EMAIL, passwordHash, emailVerifiedAt: new Date() },
      });
      await tx.membership.create({
        data: { tenantId: tenant.id, userId: user.id, role: "owner" },
      });

      const venue = await tx.venue.create({
        data: {
          tenantId: tenant.id,
          name: RESTAURANT_NAME,
          slug: RESTAURANT_SLUG,
          defaultLocale: DEFAULT_LOCALE,
          enabledLocales: [DEFAULT_LOCALE],
          currency: CURRENCY,
          branding: { primaryColor: "#8a1f1f", logoKey: null },
        },
      });

      const menu = await tx.menu.create({
        data: { tenantId: tenant.id, venueId: venue.id, name: "Main menu", isDefault: true },
      });
      const version = await tx.menuVersion.create({
        data: {
          tenantId: tenant.id,
          menuId: menu.id,
          status: "published",
          publishedAt: new Date(),
        },
      });
      await tx.menu.update({
        where: { id: menu.id },
        data: { publishedVersion: version.id },
      });

      // Materialize the template tree (photos omitted — the owner adds
      // their own; dishes fall back to the placeholder image).
      let categoryOrder = 100;
      let categories = 0;
      let items = 0;
      for (const cat of parsed.data.categories) {
        const category = await tx.category.create({
          data: {
            tenantId: tenant.id,
            menuVersionId: version.id,
            name: cat.name,
            orderIndex: categoryOrder,
          },
          select: { id: true },
        });
        categoryOrder += 100;
        categories += 1;
        let itemOrder = 100;
        for (const item of cat.items) {
          await tx.item.create({
            data: {
              tenantId: tenant.id,
              categoryId: category.id,
              name: item.name,
              description: item.description ?? null,
              priceCents: item.priceCents,
              currency: CURRENCY,
              orderIndex: itemOrder,
              spice: item.spice,
              dietary: item.dietary,
              allergens: item.allergens,
            },
          });
          itemOrder += 100;
          items += 1;
        }
      }

      process.stdout.write(
        `✓ seed-restaurant: created "${RESTAURANT_NAME}" at /r/${RESTAURANT_SLUG}\n` +
          `  tenant=${tenant.id} venue=${venue.id}\n` +
          `  template=${TEMPLATE_KEY} → ${categories} categories, ${items} items\n` +
          `  owner login: ${OWNER_EMAIL} / ${OWNER_PASSWORD}\n`,
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
      `✗ seed-restaurant failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
