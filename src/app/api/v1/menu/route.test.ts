import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { signupUser } from "@/lib/auth-service";
import { asTenant } from "@/lib/tenant";
import { GET } from "./route";

/**
 * `?locale` handling on the app's menu read (plan decision 6). The rule
 * that matters operationally: a stale or disabled preference must never
 * cost the guest the menu — it degrades to the venue's language and the
 * response says which language came back.
 */

interface Fixture {
  tenantId: string;
  slug: string;
  userId: string;
}

const userIds: string[] = [];
const tenantIds: string[] = [];

/** A published one-item menu on a venue with en/de/es enabled and `de`
 *  as the default — enough for the locale rules, nothing more. */
async function fixture(): Promise<Fixture> {
  const s = await signupUser({
    email: `menu-api-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: "Menu API",
  });
  if (!s.ok) throw new Error("signup failed");
  userIds.push(s.userId);
  tenantIds.push(s.tenantId);
  const slug = `menu-api-${randomUUID().slice(0, 8)}`;
  await asTenant(s.tenantId, async (tx) => {
    const venue = await tx.venue.create({
      data: {
        tenantId: s.tenantId,
        name: "Locale Venue",
        slug,
        currency: "EUR",
        defaultLocale: "de",
        enabledLocales: ["en", "de", "es"],
      },
      select: { id: true },
    });
    const menu = await tx.menu.create({
      data: { tenantId: s.tenantId, venueId: venue.id, name: "Main", isDefault: true },
      select: { id: true },
    });
    const version = await tx.menuVersion.create({
      data: { tenantId: s.tenantId, menuId: menu.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });
    const cat = await tx.category.create({
      data: { tenantId: s.tenantId, menuVersionId: version.id, name: "Mains", orderIndex: 0 },
      select: { id: true },
    });
    const item = await tx.item.create({
      data: {
        tenantId: s.tenantId,
        categoryId: cat.id,
        name: "Dal",
        priceCents: 990,
        orderIndex: 0,
      },
      select: { id: true },
    });
    await tx.translation.createMany({
      data: [
        {
          tenantId: s.tenantId,
          entityType: "item",
          entityId: item.id,
          locale: "es",
          field: "name",
          value: "Dal especiado",
        },
      ],
    });
  });
  return { tenantId: s.tenantId, slug, userId: s.userId };
}

interface MenuPayload {
  ok: boolean;
  venue: { locale: string; defaultLocale: string; enabledLocales: string[] };
  offerCount: number;
  rating: { value: number; count: number; reviewUrl: string } | null;
  categories: { items: { name: string }[] }[];
}

async function read(slug: string, query = ""): Promise<MenuPayload> {
  process.env.RESTAURANT_SLUG = slug;
  const res = await GET(new NextRequest(`http://localhost:3000/api/v1/menu${query}`));
  expect(res.status).toBe(200);
  return (await res.json()) as MenuPayload;
}

afterAll(async () => {
  delete process.env.RESTAURANT_SLUG;
  for (const tid of tenantIds) {
    await asTenant(tid, (tx) => tx.translation.deleteMany({}));
    await asTenant(tid, (tx) => tx.item.deleteMany({}));
    await asTenant(tid, (tx) => tx.category.deleteMany({}));
    await asTenant(tid, (tx) => tx.menu.updateMany({ data: { publishedVersion: null } }));
    await asTenant(tid, (tx) => tx.menuVersion.deleteMany({}));
    await asTenant(tid, (tx) => tx.menu.deleteMany({}));
    await asTenant(tid, (tx) => tx.venue.deleteMany({}));
    await asTenant(tid, (tx) => tx.membership.deleteMany({}));
    await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("GET /api/v1/menu — ?locale", () => {
  it("serves the venue default when no locale is asked for", async () => {
    const fx = await fixture();
    const body = await read(fx.slug);
    expect(body.ok).toBe(true);
    expect(body.venue.locale).toBe("de");
    expect(body.venue.enabledLocales).toEqual(["en", "de", "es"]);
  });

  it("serves an enabled locale and echoes it back", async () => {
    const fx = await fixture();
    const body = await read(fx.slug, "?locale=es");
    expect(body.venue.locale).toBe("es");
    expect(body.categories[0]!.items[0]!.name).toBe("Dal especiado");
  });

  it("falls back to the venue default for a disabled locale — never a 404", async () => {
    const fx = await fixture();
    // `fr` is a real locale the owner has not enabled: an app that kept a
    // stale preference still gets a menu, in the venue's language.
    const body = await read(fx.slug, "?locale=fr");
    expect(body.venue.locale).toBe("de");
    expect(body.categories[0]!.items[0]!.name).toBe("Dal");
  });

  it("reports the live offer count so the app can hide its offers surface (P7-12)", async () => {
    const fx = await fixture();
    expect((await read(fx.slug)).offerCount).toBe(0);

    await asTenant(fx.tenantId, async (tx) => {
      const cat = await tx.category.findFirstOrThrow({ select: { id: true } });
      await tx.item.create({
        data: {
          tenantId: fx.tenantId,
          categoryId: cat.id,
          name: "Mango Lassi",
          priceCents: 500,
          // No window: live from the moment it is published.
          offerPriceCents: 300,
          orderIndex: 1,
        },
      });
    });
    expect((await read(fx.slug)).offerCount).toBe(1);
  });

  it("sends the Google rating, and an explicit null when there is none (P7-14)", async () => {
    const fx = await fixture();
    // The field is always present: the app tests `rating` and nothing
    // else, so "absent" must never be a third state it has to handle.
    const before = await read(fx.slug);
    expect(before).toHaveProperty("rating");
    expect(before.rating).toBeNull();

    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({
        data: {
          googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
          googleRating: { rating: 4.6, count: 312, fetchedAt: new Date().toISOString() },
        },
      }),
    );
    expect((await read(fx.slug)).rating).toEqual({
      value: 4.6,
      count: 312,
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
    });
  });

  it("sends a Maps search as the link for an owner-typed rating (P7-14)", async () => {
    const fx = await fixture();
    // No Place ID, so there is no review form to link to. The app's
    // `asRating()` throws away a rating whose `reviewUrl` is not an http
    // URL, so the server sends a Maps search for the venue name rather
    // than a null that would hide the number entirely.
    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({
        data: {
          googlePlaceId: null,
          googleRating: Prisma.DbNull,
          googleRatingManual: { rating: 4.7, count: 440, updatedAt: new Date().toISOString() },
        },
      }),
    );
    expect((await read(fx.slug)).rating).toEqual({
      value: 4.7,
      count: 440,
      reviewUrl: "https://www.google.com/maps/search/?api=1&query=Locale%20Venue",
    });
  });

  it("ignores junk in the parameter", async () => {
    const fx = await fixture();
    for (const q of ["?locale=xx", "?locale=", "?locale=es-ES%20OR%201=1"]) {
      const body = await read(fx.slug, q);
      expect(body.venue.locale).toBe("de");
    }
  });
});
