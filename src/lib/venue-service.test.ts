import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant, asUser } from "./tenant";
import { __fakeRating } from "./google-rating";
import {
  getMenuCounts,
  getVenueForUser,
  getVenueGoogle,
  refreshVenueGoogleRating,
  updateVenueGooglePlaceId,
  updateVenueAppearance,
  updateVenueLocalization,
  updateVenueLogo,
  updateVenueName,
} from "./venue-service";

describe("venue-service (owner dashboard)", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  });

  async function signupWithVenue(): Promise<{ userId: string; venueId: string }> {
    const s = await signupUser({
      email: `venue-svc-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Venue Service Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);
    const venue = await asUser(s.userId, (tx) =>
      tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Testhaus",
          slug: `venue-svc-${randomUUID().slice(0, 8)}`,
          defaultLocale: "de",
          enabledLocales: ["de"],
          currency: "EUR",
          branding: { primaryColor: "#7a2e1d" },
        },
        select: { id: true },
      }),
    );
    return { userId: s.userId, venueId: venue.id };
  }

  it("getVenueForUser returns the venue with normalized branding", async () => {
    const { userId } = await signupWithVenue();
    const r = await getVenueForUser(userId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("Testhaus");
    expect(r.value.branding.primaryColor).toBe("#7a2e1d");
    expect(r.value.branding.theme).toBeUndefined();
  });

  it("updateVenueAppearance stores theme + texture and keeps existing branding keys", async () => {
    const { userId } = await signupWithVenue();
    const r = await updateVenueAppearance(userId, { theme: "ivory-day", texture: "jali" });
    expect(r.ok).toBe(true);

    const after = await getVenueForUser(userId);
    if (!after.ok) throw new Error("venue vanished");
    expect(after.value.branding.theme).toBe("ivory-day");
    expect(after.value.branding.texture).toBe("jali");
    expect(after.value.branding.primaryColor).toBe("#7a2e1d");
  });

  it("updateVenueAppearance rejects unknown theme/texture ids", async () => {
    const { userId } = await signupWithVenue();
    const bad = await updateVenueAppearance(userId, { theme: "comic-sans", texture: "none" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toBe("invalid");
  });

  it("updateVenueName trims and saves; empty name is invalid", async () => {
    const { userId } = await signupWithVenue();
    const ok = await updateVenueName(userId, { name: "  Neues Haus  " });
    expect(ok.ok).toBe(true);
    const after = await getVenueForUser(userId);
    if (!after.ok) throw new Error("venue vanished");
    expect(after.value.name).toBe("Neues Haus");

    const bad = await updateVenueName(userId, { name: "   " });
    expect(bad.ok).toBe(false);
  });

  it("getMenuCounts reports zeros with no draft menu", async () => {
    const { userId } = await signupWithVenue();
    const counts = await getMenuCounts(userId);
    expect(counts).toEqual({ categories: 0, items: 0 });
  });

  it("updateVenueLocalization saves currency + locales, normalizing order", async () => {
    const { userId } = await signupWithVenue();
    const r = await updateVenueLocalization(userId, {
      currency: "CHF",
      defaultLocale: "de",
      enabledLocales: ["fr", "de", "en"],
    });
    expect(r.ok).toBe(true);

    const after = await getVenueForUser(userId);
    if (!after.ok) throw new Error("venue vanished");
    expect(after.value.currency).toBe("CHF");
    expect(after.value.defaultLocale).toBe("de");
    // Supported-list order, not submission order.
    expect(after.value.enabledLocales).toEqual(["en", "de", "fr"]);
  });

  it("updateVenueLocalization rejects a default outside the enabled set and unknown values", async () => {
    const { userId } = await signupWithVenue();
    const badDefault = await updateVenueLocalization(userId, {
      currency: "EUR",
      defaultLocale: "it",
      enabledLocales: ["en", "de"],
    });
    expect(badDefault.ok).toBe(false);

    const badCurrency = await updateVenueLocalization(userId, {
      currency: "JPY",
      defaultLocale: "en",
      enabledLocales: ["en"],
    });
    expect(badCurrency.ok).toBe(false);

    const noLocales = await updateVenueLocalization(userId, {
      currency: "EUR",
      defaultLocale: "en",
      enabledLocales: [],
    });
    expect(noLocales.ok).toBe(false);
  });

  it("updateVenueLogo sets and clears logoKey while keeping other branding", async () => {
    const { userId } = await signupWithVenue();
    const set = await updateVenueLogo(userId, "tenant-x/uploads/logo-1");
    expect(set.ok).toBe(true);
    let venue = await getVenueForUser(userId);
    if (!venue.ok) throw new Error("venue vanished");
    expect(venue.value.branding.logoKey).toBe("tenant-x/uploads/logo-1");
    expect(venue.value.branding.primaryColor).toBe("#7a2e1d");

    const cleared = await updateVenueLogo(userId, null);
    expect(cleared.ok).toBe(true);
    venue = await getVenueForUser(userId);
    if (!venue.ok) throw new Error("venue vanished");
    expect(venue.value.branding.logoKey).toBeNull();
  });

  it("updateVenueGooglePlaceId round-trips, clears, and drops a stale rating (P7-14)", async () => {
    const { userId, venueId } = await signupWithVenue();
    const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";

    const empty = await getVenueGoogle(userId);
    if (!empty.ok) throw new Error("no venue");
    expect(empty.value).toEqual({ placeId: null, rating: null, reviewUrl: null });

    expect((await updateVenueGooglePlaceId(userId, `  ${PLACE}  `)).ok).toBe(true);
    const saved = await getVenueGoogle(userId);
    if (!saved.ok) throw new Error("no venue");
    expect(saved.value.placeId).toBe(PLACE);
    expect(saved.value.reviewUrl).toBe(
      `https://search.google.com/local/writereview?placeid=${PLACE}`,
    );

    // A rating read for THIS place shows up in the card…
    await asUser(userId, (tx) =>
      tx.venue.update({
        where: { id: venueId },
        data: { googleRating: { rating: 4.4, count: 91, fetchedAt: new Date().toISOString() } },
      }),
    );
    const withRating = await getVenueGoogle(userId);
    if (!withRating.ok) throw new Error("no venue");
    expect(withRating.value.rating).toMatchObject({ rating: 4.4, count: 91 });

    // …and is dropped the moment the owner points at a different place,
    // because that number belongs to the old one.
    expect((await updateVenueGooglePlaceId(userId, "ChIJrTLr_LZuEmsRBfy61i59si0")).ok).toBe(true);
    const moved = await getVenueGoogle(userId);
    if (!moved.ok) throw new Error("no venue");
    expect(moved.value.rating).toBeNull();

    // Blank clears the setting entirely — how the owner turns it off.
    expect((await updateVenueGooglePlaceId(userId, "   ")).ok).toBe(true);
    const cleared = await getVenueGoogle(userId);
    if (!cleared.ok) throw new Error("no venue");
    expect(cleared.value).toEqual({ placeId: null, rating: null, reviewUrl: null });

    // Anything that is not Place-ID-shaped is refused rather than stored.
    for (const bad of ["abc", "has spaces", "https://maps.google.com/?cid=1", "x".repeat(256)]) {
      expect((await updateVenueGooglePlaceId(userId, bad)).ok, bad).toBe(false);
    }
  });

  it("refreshVenueGoogleRating bypasses the daily cache and names its failures (P7-14)", async () => {
    const { userId } = await signupWithVenue();
    const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";
    __fakeRating().reset();

    // Nothing to refresh before a Place ID is saved — and no billable
    // request spent finding that out.
    expect(await refreshVenueGoogleRating(userId)).toEqual({ ok: false, error: "no_place_id" });
    expect(__fakeRating().calls).toHaveLength(0);

    expect((await updateVenueGooglePlaceId(userId, PLACE)).ok).toBe(true);

    // No API key in this process, so the owner is told exactly that
    // rather than "nothing happened".
    expect(await refreshVenueGoogleRating(userId)).toEqual({ ok: false, error: "no_api_key" });
    expect(__fakeRating().calls).toEqual([PLACE]);

    __fakeRating().next = { rating: 4.7, count: 440 };
    const refreshed = await refreshVenueGoogleRating(userId);
    expect(refreshed.ok && refreshed.rating).toMatchObject({ rating: 4.7, count: 440 });

    // The number is cached on the venue, so the card shows it at once —
    // no waiting for a guest to open the menu.
    const card = await getVenueGoogle(userId);
    if (!card.ok) throw new Error("no venue");
    expect(card.value.rating).toMatchObject({ rating: 4.7, count: 440 });

    // And a second press goes straight back to Google: the 24 h TTL is
    // the background refresher's rule, not this button's.
    __fakeRating().next = { rating: 4.8, count: 441 };
    const again = await refreshVenueGoogleRating(userId);
    expect(again.ok && again.rating).toMatchObject({ rating: 4.8, count: 441 });
    __fakeRating().reset();
  });
});
