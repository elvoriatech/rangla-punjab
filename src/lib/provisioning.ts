import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { hashPassword } from "./password";
import { templateContentSchema } from "./menu-template-service";
import { requestPasswordReset } from "./verification-service";
import { isPlatformAdmin } from "./platform-admin";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * Operator provisioning (P3-2). Creates one restaurant end-to-end and
 * invites its owner — the runtime counterpart to scripts/seed-restaurant.ts:
 *
 *   tenant → owner User (no usable password) + Membership(owner) → venue
 *          → default menu → published MenuVersion from a MenuTemplate
 *          → set-password invite email to the owner
 *
 * The owner is created with a random, unusable password hash; the invite
 * email (reuses the password-reset token flow) is how they set their real
 * one. Creating a fresh tenant's rows is inherently cross-tenant, so it
 * runs on the DB OWNER role — in prod that's the app's own connection
 * (RLS disabled, single restaurant per deploy). `db` defaults to the app
 * client; tests inject an owner-role client since their app connection is
 * the RLS-enforced least-privilege role. Gated on isPlatformAdmin.
 */

export const provisionInputSchema = z.object({
  restaurantName: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().toLowerCase().email(),
  templateKey: z.string().trim().min(1).max(48),
  venueName: z.string().trim().min(1).max(120).optional(),
  currency: z.string().trim().length(3).toUpperCase().default("EUR"),
  locale: z.string().trim().min(2).max(5).default("en"),
});

export type ProvisionInput = z.input<typeof provisionInputSchema>;

export type ProvisionResult =
  | { ok: true; tenantId: string; venueId: string; slug: string }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "duplicate_email" | "unknown_template" | "invalid_template";
    };

function slugify(name: string, tenantId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "venue"}-${tenantId.slice(0, 8)}`;
}

export async function provisionRestaurant(
  userId: string,
  rawInput: unknown,
  db: PrismaClient = prisma,
): Promise<ProvisionResult> {
  if (!(await isPlatformAdmin(userId))) return { ok: false, error: "forbidden" };

  const parsed = provisionInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { restaurantName, ownerEmail, templateKey, currency, locale } = parsed.data;
  const venueName = parsed.data.venueName ?? restaurantName;

  // Validate the template up front so a bad key fails before any writes.
  const template = await db.menuTemplate.findUnique({
    where: { key: templateKey },
    select: { content: true },
  });
  if (!template) return { ok: false, error: "unknown_template" };
  const content = templateContentSchema.safeParse(template.content);
  if (!content.success) return { ok: false, error: "invalid_template" };

  // One owner account per email — a duplicate would silently attach the
  // new restaurant's invite to an existing person.
  const existingUser = await db.user.findFirst({
    where: { email: ownerEmail, deletedAt: null },
    select: { id: true },
  });
  if (existingUser) return { ok: false, error: "duplicate_email" };

  // Unusable password — the owner sets a real one via the invite email.
  const passwordHash = await hashPassword(randomBytes(24).toString("base64url"));

  const result = await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: restaurantName,
        onboardingState: { step: 4 },
        onboardingCompletedAt: new Date(),
      },
      select: { id: true },
    });
    const user = await tx.user.create({
      data: { email: ownerEmail, passwordHash },
      select: { id: true },
    });
    await tx.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "owner" },
    });
    const slug = slugify(venueName, tenant.id);
    const venue = await tx.venue.create({
      data: {
        tenantId: tenant.id,
        name: venueName,
        slug,
        defaultLocale: locale,
        enabledLocales: [locale],
        currency,
        branding: { primaryColor: "#8a1f1f", logoKey: null },
      },
      select: { id: true },
    });
    const menu = await tx.menu.create({
      data: { tenantId: tenant.id, venueId: venue.id, name: "Main menu", isDefault: true },
      select: { id: true },
    });
    const version = await tx.menuVersion.create({
      data: { tenantId: tenant.id, menuId: menu.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });

    let categoryOrder = 100;
    for (const cat of content.data.categories) {
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
      let itemOrder = 100;
      for (const item of cat.items) {
        await tx.item.create({
          data: {
            tenantId: tenant.id,
            categoryId: category.id,
            name: item.name,
            description: item.description ?? null,
            priceCents: item.priceCents,
            currency,
            orderIndex: itemOrder,
            spice: item.spice,
            dietary: item.dietary,
            allergens: item.allergens,
          },
        });
        itemOrder += 100;
      }
    }
    return { tenantId: tenant.id, venueId: venue.id, slug };
  });

  // Invite the owner to set their password (reuses the reset-token flow).
  // Best-effort: a mail failure must not orphan the created restaurant —
  // the operator can re-send from the reset page.
  try {
    await requestPasswordReset(ownerEmail);
  } catch (err) {
    log.warn("provisioning.invite_email_failed", {
      tenantId: result.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log.info("provisioning.restaurant_created", {
    userId,
    tenantId: result.tenantId,
    venueId: result.venueId,
  });
  return { ok: true, ...result };
}
