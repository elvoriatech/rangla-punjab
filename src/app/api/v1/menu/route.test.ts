import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { signupUser } from "@/lib/auth-service";
import { asTenant } from "@/lib/tenant";
import { GET, OPTIONS } from "./route";

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

interface Entry {
  number: string;
  display: string;
  href: string;
}

interface MenuPayload {
  ok: boolean;
  venue: {
    locale: string;
    defaultLocale: string;
    enabledLocales: string[];
    openNow: boolean;
    timezone: string;
    hours: { configured: boolean };
    contact: {
      landline: Entry | null;
      mobile: Entry | null;
      whatsapp: Entry | null;
      email: Entry | null;
    } | null;
    appLinks: { ios?: string; android?: string; apk?: string } | null;
  };
  ordering: { acceptsAsapNow: boolean; requestSlots: string[] };
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

  it("sends the restaurant's numbers with their links, or an explicit null", async () => {
    const fx = await fixture();
    // Always present, like `rating`: the app tests `venue.contact` and
    // nothing else, so "absent" must never be a third state.
    const before = await read(fx.slug);
    expect(before.venue).toHaveProperty("contact");
    expect(before.venue.contact).toBeNull();

    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({
        data: {
          contact: {
            mobile: "+491701234567",
            whatsapp: "+491701234567",
            email: "info@restaurant.de",
          },
        },
      }),
    );
    // Mobile + WhatsApp stay in the payload for older app builds but are
    // never published, even with numbers stored.
    expect((await read(fx.slug)).venue.contact).toEqual({
      landline: null,
      mobile: null,
      whatsapp: null,
      // An address is its own display string, behind a `mailto:`.
      email: {
        number: "info@restaurant.de",
        display: "info@restaurant.de",
        href: "mailto:info@restaurant.de",
      },
    });
  });

  it("sends the app links, or an explicit null", async () => {
    const fx = await fixture();
    // Always present, like `contact`: the app reads `venue.appLinks` and
    // nothing else, so "absent" must never be a third state.
    const before = await read(fx.slug);
    expect(before.venue).toHaveProperty("appLinks");
    expect(before.venue.appLinks).toBeNull();

    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({
        data: {
          appLinks: {
            ios: "https://apps.apple.com/de/app/elvoria/id1",
            android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
          },
        },
      }),
    );
    expect((await read(fx.slug)).venue.appLinks).toEqual({
      ios: "https://apps.apple.com/de/app/elvoria/id1",
      android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
    });
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

  it("tells the app whether the venue is open right now", async () => {
    const fx = await fixture();

    // Hours never configured — "we don't know" must read as closed, not
    // as an open dot the kitchen cannot honour.
    const unset = await read(fx.slug);
    expect(unset.venue.hours.configured).toBe(false);
    expect(unset.venue.openNow).toBe(false);
    // …but the dot and the cart read the same state differently: with no
    // hours saved the venue is not "closed for business", so the app must
    // keep offering "Now".
    expect(unset.ordering.acceptsAsapNow).toBe(true);

    // Open round the clock: `close === open` is the schema's overnight
    // window, so this holds whenever the suite happens to run.
    const allDay = {
      configured: true,
      days: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
          d,
          { closed: false, slots: [{ open: "00:00", close: "00:00" }] },
        ]),
      ),
    };
    await asTenant(fx.tenantId, (tx) => tx.venue.updateMany({ data: { hours: allDay } }));
    const round = await read(fx.slug);
    expect(round.venue.openNow).toBe(true);
    expect(round.ordering.acceptsAsapNow).toBe(true);

    // Configured and shut every day — the other half of the dot.
    const shut = {
      configured: true,
      days: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
          d,
          { closed: true, slots: [] },
        ]),
      ),
    };
    await asTenant(fx.tenantId, (tx) => tx.venue.updateMany({ data: { hours: shut } }));
    const closed = await read(fx.slug);
    expect(closed.venue.openNow).toBe(false);
    // Shut means the cart must hide "Now": an ASAP order placed here is
    // refused server-side with `venue_closed`.
    expect(closed.ordering.acceptsAsapNow).toBe(false);
    expect(closed.ordering.requestSlots).toEqual([]);
    // The hours themselves still ride along — the app draws the table
    // next to the dot and must not have to ask twice.
    expect(closed.venue.hours.configured).toBe(true);
  });

  it("sends the zone those hours are written in, so the app can recompute the dot", async () => {
    const fx = await fixture();

    // `openNow` is a 60-second-old snapshot; the app recomputes the state
    // from `hours` + `timezone` between refreshes, so the zone must ride
    // along or "18:00" is a string with no moment behind it.
    const body = await read(fx.slug);
    expect(body.venue.timezone).toBe("Europe/Berlin");
    // A real IANA zone, not a fixed offset or a label: `Intl` throws on
    // anything it cannot resolve.
    expect(() =>
      new Intl.DateTimeFormat("en", { timeZone: body.venue.timezone }).format(new Date()),
    ).not.toThrow();

    // And it follows the venue rather than the deploy's default.
    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({ data: { timezone: "Asia/Kolkata" } }),
    );
    expect((await read(fx.slug)).venue.timezone).toBe("Asia/Kolkata");
  });

  it("ignores junk in the parameter", async () => {
    const fx = await fixture();
    for (const q of ["?locale=xx", "?locale=", "?locale=es-ES%20OR%201=1"]) {
      const body = await read(fx.slug, q);
      expect(body.venue.locale).toBe("de");
    }
  });
});

/**
 * Edge caching.
 *
 * The payload carries `openNow` / `acceptsAsapNow`, which are answers
 * about the clock — so the TTL is a correctness budget, not a tuning
 * knob, and the app's explicit refresh has to be able to step around the
 * cache entirely or "pull to refresh" would return the same stale dot.
 */
describe("GET /api/v1/menu — cache headers", () => {
  async function headersFor(
    slug: string,
    query = "",
    init?: { headers?: Record<string, string> },
  ): Promise<{ status: number; cacheControl: string | null; allowHeaders: string | null }> {
    process.env.RESTAURANT_SLUG = slug;
    const res = await GET(new NextRequest(`http://localhost:3000/api/v1/menu${query}`, init));
    return {
      status: res.status,
      cacheControl: res.headers.get("cache-control"),
      allowHeaders: res.headers.get("access-control-allow-headers"),
    };
  }

  it("lets the edge hold the menu for only a minute — openNow is a clock answer", async () => {
    const fx = await fixture();
    const { status, cacheControl } = await headersFor(fx.slug);
    expect(status).toBe(200);
    // A day-long stale-while-revalidate here could serve last night's
    // open/closed state after an edge miss.
    expect(cacheControl).toBe("public, s-maxage=60, stale-while-revalidate=300");
  });

  it("bypasses the CDN for an explicit refresh — `Cache-Control: no-cache` or `?fresh=1`", async () => {
    const fx = await fixture();

    for (const value of ["no-cache", "no-store", "No-Cache"]) {
      const { cacheControl } = await headersFor(fx.slug, "", {
        headers: { "cache-control": value },
      });
      expect(cacheControl, value).toBe("private, no-store");
    }

    // The query-string form, for a client whose request headers are
    // rewritten in transit.
    expect((await headersFor(fx.slug, "?fresh=1")).cacheControl).toBe("private, no-store");
    expect((await headersFor(fx.slug, "?locale=en&fresh=1")).cacheControl).toBe(
      "private, no-store",
    );

    // Anything else is an ordinary cacheable read — `fresh=0` is not a
    // licence to hammer the origin.
    expect((await headersFor(fx.slug, "?fresh=0")).cacheControl).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("allows the Cache-Control request header through CORS, or the bypass never arrives", async () => {
    const fx = await fixture();
    // Not a CORS-safelisted request header: without this the Expo web
    // surface's preflight would block the no-cache refresh.
    expect((await headersFor(fx.slug)).allowHeaders).toContain("Cache-Control");
    expect(OPTIONS().headers.get("access-control-allow-headers")).toContain("Cache-Control");
  });
});
