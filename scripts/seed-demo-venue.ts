import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Seeds a public demo venue (slug `demo`) for smoke checks and the
 * Playwright axe job (P1-25). Idempotent: re-running is a no-op once
 * the slug exists. Uses the migration-privilege connection because
 * this is CI fixture data, not tenant-authored content — RLS is not
 * the barrier we're testing here.
 */

const DEMO_VENUE_SLUG = "demo";
const DEMO_EMAIL = "demo-owner@elvoria.local";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const existing = await prisma.venue.findUnique({
    where: { slug: DEMO_VENUE_SLUG },
    select: { id: true },
  });
  if (existing) {
    process.stdout.write(
      `✓ seed-demo-venue: venue "${DEMO_VENUE_SLUG}" already exists (${existing.id})\n`,
    );
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: "Elvoria Demo",
        onboardingState: { step: 4 },
        onboardingCompletedAt: new Date(),
      },
    });

    // Owner user for the demo tenant. Password hash is a syntactically
    // valid argon2id string that no one can login with — the demo venue
    // is public-read only.
    const user = await tx.user.create({
      data: {
        email: DEMO_EMAIL,
        passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$demo-seed-not-a-real-hash$xxxxxxxxxxxxxx",
        emailVerifiedAt: new Date(),
      },
    });
    await tx.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "owner" },
    });

    const venue = await tx.venue.create({
      data: {
        tenantId: tenant.id,
        name: "Elvoria Demo Restaurant",
        slug: DEMO_VENUE_SLUG,
        defaultLocale: "en",
        enabledLocales: ["en", "de"],
        currency: "EUR",
        branding: { primaryColor: "#1f3b2e", logoKey: null },
      },
    });

    const menu = await tx.menu.create({
      data: {
        tenantId: tenant.id,
        venueId: venue.id,
        name: "Main menu",
        isDefault: true,
      },
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

    const starters = await tx.category.create({
      data: { tenantId: tenant.id, menuVersionId: version.id, name: "Starters", orderIndex: 0 },
    });
    const mains = await tx.category.create({
      data: { tenantId: tenant.id, menuVersionId: version.id, name: "Mains", orderIndex: 1 },
    });
    const desserts = await tx.category.create({
      data: { tenantId: tenant.id, menuVersionId: version.id, name: "Desserts", orderIndex: 2 },
    });

    await tx.item.createMany({
      data: [
        {
          tenantId: tenant.id,
          categoryId: starters.id,
          name: "Burrata with heirloom tomatoes",
          description: "Puglian burrata, sun-warmed tomatoes, basil oil.",
          priceCents: 1400,
          currency: "EUR",
          orderIndex: 0,
          allergens: ["milk"],
          dietary: ["vegetarian"],
          isAvailable: true,
        },
        {
          tenantId: tenant.id,
          categoryId: starters.id,
          name: "Whipped white bean crostini",
          description: "Tuscan cannellini beans, rosemary, on toasted country bread.",
          priceCents: 900,
          currency: "EUR",
          orderIndex: 1,
          allergens: ["gluten"],
          traces: ["nuts"],
          dietary: ["vegan"],
          isAvailable: true,
        },
        {
          tenantId: tenant.id,
          categoryId: mains.id,
          name: "Risotto al tartufo",
          description: "Carnaroli rice, black truffle, aged Parmigiano.",
          priceCents: 2200,
          currency: "EUR",
          orderIndex: 0,
          allergens: ["milk", "sulphites"],
          dietary: ["vegetarian", "gluten_free"],
          isAvailable: true,
        },
        {
          tenantId: tenant.id,
          categoryId: mains.id,
          name: "Branzino al forno",
          description: "Whole roasted Mediterranean sea bass, lemon, olive oil.",
          priceCents: 2800,
          currency: "EUR",
          orderIndex: 1,
          allergens: ["fish"],
          dietary: ["gluten_free", "dairy_free"],
          isAvailable: true,
        },
        {
          tenantId: tenant.id,
          categoryId: desserts.id,
          name: "Tiramisu",
          description: "Espresso-soaked savoiardi, mascarpone, cocoa.",
          priceCents: 950,
          currency: "EUR",
          orderIndex: 0,
          allergens: ["gluten", "eggs", "milk"],
          dietary: ["vegetarian"],
          isAvailable: true,
        },
      ],
    });

    process.stdout.write(
      `✓ seed-demo-venue: created venue "${DEMO_VENUE_SLUG}" (tenant=${tenant.id}, venue=${venue.id})\n`,
    );
  });

  await prisma.$disconnect();
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(
      `✗ seed-demo-venue failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
