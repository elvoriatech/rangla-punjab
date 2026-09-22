import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant, asUser } from "./tenant";
import { __fakeRating } from "./google-rating";
import {
  getMenuCounts,
  getVenueAppLinks,
  getVenueContact,
  getVenueForUser,
  getVenueGoogle,
  refreshVenueGoogleRating,
  updateVenueGoogleManualRating,
  updateVenueGoogleRatingEnabled,
  updateVenueGooglePlaceId,
  updateVenueAppearance,
  updateVenueAppLinks,
  updateVenueContact,
  updateVenueHeroSlides,
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
    // Supported-list order (`LOCALES` in locales.ts), not submission order.
    expect(after.value.enabledLocales).toEqual(["de", "en", "fr"]);
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

  it("a fresh venue's slider holds the six built-ins, and any can be swapped out", async () => {
    const { userId } = await signupWithVenue();
    const r = await getVenueForUser(userId);
    expect(r.ok && r.value.branding.heroSlides).toEqual([
      "builtin:points-de",
      "builtin:hero-biryani",
      "builtin:hero-kebab",
      "builtin:hero-karahi",
      "builtin:hero-biryani-2",
      "builtin:points-en",
    ]);
    // Full at six: a seventh is refused until one goes.
    expect(await updateVenueHeroSlides(userId, { op: "add", key: "t/new" })).toEqual({
      ok: false,
      error: "full",
    });
    await updateVenueHeroSlides(userId, { op: "remove", key: "builtin:hero-kebab" });
    await updateVenueHeroSlides(userId, { op: "add", key: "t/new" });
    const after = await getVenueForUser(userId);
    expect(after.ok && after.value.branding.heroSlides).toEqual([
      "builtin:points-de",
      "builtin:hero-biryani",
      "builtin:hero-karahi",
      "builtin:hero-biryani-2",
      "builtin:points-en",
      "t/new",
    ]);
  });

  it("updateVenueHeroSlides adds, reorders and removes slides in order", async () => {
    const { userId } = await signupWithVenue();
    // Start from an empty slider so the order under test is ours alone.
    for (const d of [
      "points-de",
      "hero-biryani",
      "hero-kebab",
      "hero-karahi",
      "hero-biryani-2",
      "points-en",
    ]) {
      await updateVenueHeroSlides(userId, { op: "remove", key: `builtin:${d}` });
    }
    for (const key of ["t/a", "t/b", "t/c"]) {
      expect((await updateVenueHeroSlides(userId, { op: "add", key })).ok).toBe(true);
    }
    const slides = async (): Promise<string[] | undefined> => {
      const r = await getVenueForUser(userId);
      return r.ok ? r.value.branding.heroSlides : undefined;
    };
    expect(await slides()).toEqual(["t/a", "t/b", "t/c"]);

    await updateVenueHeroSlides(userId, { op: "move", key: "t/c", by: -1 });
    expect(await slides()).toEqual(["t/a", "t/c", "t/b"]);
    // Moving past either end is a harmless no-op.
    await updateVenueHeroSlides(userId, { op: "move", key: "t/a", by: -1 });
    await updateVenueHeroSlides(userId, { op: "move", key: "t/b", by: 1 });
    expect(await slides()).toEqual(["t/a", "t/c", "t/b"]);

    await updateVenueHeroSlides(userId, { op: "remove", key: "t/c" });
    expect(await slides()).toEqual(["t/a", "t/b"]);
    expect((await updateVenueHeroSlides(userId, { op: "remove", key: "t/zz" })).ok).toBe(true);
    expect(await slides()).toEqual(["t/a", "t/b"]);
  });

  it("updateVenueHeroSlides refuses a seventh slide and an empty key", async () => {
    const { userId } = await signupWithVenue();
    // Six built-ins fill it; drop two, and two uploads fill it again.
    await updateVenueHeroSlides(userId, { op: "remove", key: "builtin:points-de" });
    await updateVenueHeroSlides(userId, { op: "remove", key: "builtin:points-en" });
    for (let i = 0; i < 2; i += 1) {
      expect((await updateVenueHeroSlides(userId, { op: "add", key: `t/${i}` })).ok).toBe(true);
    }
    expect(await updateVenueHeroSlides(userId, { op: "add", key: "t/7" })).toEqual({
      ok: false,
      error: "full",
    });
    expect(await updateVenueHeroSlides(userId, { op: "add", key: "" })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("slides survive saving other branding (logo, appearance)", async () => {
    const { userId } = await signupWithVenue();
    await updateVenueHeroSlides(userId, { op: "remove", key: "builtin:hero-kebab" });
    await updateVenueHeroSlides(userId, { op: "add", key: "t/keep" });
    await updateVenueLogo(userId, "t/logo");
    await updateVenueAppearance(userId, { theme: "ivory-day", texture: "jali" });
    const r = await getVenueForUser(userId);
    expect(r.ok && r.value.branding.heroSlides).toEqual([
      "builtin:points-de",
      "builtin:hero-biryani",
      "builtin:hero-karahi",
      "builtin:hero-biryani-2",
      "builtin:points-en",
      "t/keep",
    ]);
  });

  it("updateVenueGooglePlaceId round-trips, clears, and drops a stale rating (P7-14)", async () => {
    const { userId, venueId } = await signupWithVenue();
    const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";

    const empty = await getVenueGoogle(userId);
    if (!empty.ok) throw new Error("no venue");
    expect(empty.value).toEqual({
      placeId: null,
      enabled: true,
      rating: null,
      manual: null,
      reviewUrl: null,
    });

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
    expect(cleared.value).toEqual({
      placeId: null,
      enabled: true,
      rating: null,
      manual: null,
      reviewUrl: null,
    });

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

  it("updateVenueGoogleManualRating saves, clears, and refuses half-answers (P7-14)", async () => {
    const { userId } = await signupWithVenue();

    // The comma decimal is what a German keyboard's own Google profile
    // shows, so it has to be accepted, not corrected.
    expect((await updateVenueGoogleManualRating(userId, { rating: "4,7", count: "440" })).ok).toBe(
      true,
    );
    const saved = await getVenueGoogle(userId);
    if (!saved.ok) throw new Error("no venue");
    expect(saved.value.manual).toMatchObject({ rating: 4.7, count: 440 });
    expect(Number.isNaN(Date.parse(saved.value.manual!.updatedAt))).toBe(false);
    // It is a SEPARATE column from the fetched cache — saving one never
    // touches the other.
    expect(saved.value.rating).toBeNull();

    // Both boxes empty is the Clear button's write.
    expect((await updateVenueGoogleManualRating(userId, { rating: "", count: "" })).ok).toBe(true);
    const cleared = await getVenueGoogle(userId);
    if (!cleared.ok) throw new Error("no venue");
    expect(cleared.value.manual).toBeNull();

    // Half an answer, a two-decimal rating, an out-of-range star, a
    // fractional review count: refused rather than stored or guessed at.
    for (const bad of [
      { rating: "4.7", count: "" },
      { rating: "", count: "440" },
      { rating: "4.65", count: "440" },
      { rating: "0.9", count: "440" },
      { rating: "5.1", count: "440" },
      { rating: "four", count: "440" },
      { rating: "4.7", count: "44.5" },
      { rating: "4.7", count: "-3" },
      { rating: "4.7", count: "10000001" },
    ]) {
      expect((await updateVenueGoogleManualRating(userId, bad)).ok, JSON.stringify(bad)).toBe(
        false,
      );
    }
    // …and a refused save left the column exactly as it was.
    const after = await getVenueGoogle(userId);
    if (!after.ok) throw new Error("no venue");
    expect(after.value.manual).toBeNull();
  });

  it("updateVenueGoogleRatingEnabled hides the line without losing the numbers (P7-14)", async () => {
    const { userId } = await signupWithVenue();
    const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";

    // A venue nobody has touched shows its rating — the switch defaults on.
    const fresh = await getVenueGoogle(userId);
    if (!fresh.ok) throw new Error("no venue");
    expect(fresh.value.enabled).toBe(true);

    expect((await updateVenueGooglePlaceId(userId, PLACE)).ok).toBe(true);
    expect((await updateVenueGoogleManualRating(userId, { rating: "4.7", count: "440" })).ok).toBe(
      true,
    );
    expect((await updateVenueGoogleRatingEnabled(userId, false)).ok).toBe(true);

    // Off — and both stored values are exactly where the owner left them,
    // which is the point of a switch rather than a delete.
    const off = await getVenueGoogle(userId);
    if (!off.ok) throw new Error("no venue");
    expect(off.value.enabled).toBe(false);
    expect(off.value.placeId).toBe(PLACE);
    expect(off.value.manual).toMatchObject({ rating: 4.7, count: 440 });

    expect((await updateVenueGoogleRatingEnabled(userId, true)).ok).toBe(true);
    const on = await getVenueGoogle(userId);
    if (!on.ok) throw new Error("no venue");
    expect(on.value.enabled).toBe(true);
    expect(on.value.manual).toMatchObject({ rating: 4.7, count: 440 });
  });

  it("a fetched rating outranks the owner's typed one on the Google card (P7-14)", async () => {
    const { userId } = await signupWithVenue();
    const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";
    __fakeRating().reset();

    expect((await updateVenueGoogleManualRating(userId, { rating: "3.1", count: "7" })).ok).toBe(
      true,
    );
    expect((await updateVenueGooglePlaceId(userId, PLACE)).ok).toBe(true);
    __fakeRating().next = { rating: 4.7, count: 440 };
    expect((await refreshVenueGoogleRating(userId)).ok).toBe(true);

    // Both values are on the card — the page says which one is live.
    const card = await getVenueGoogle(userId);
    if (!card.ok) throw new Error("no venue");
    expect(card.value.rating).toMatchObject({ rating: 4.7, count: 440 });
    expect(card.value.manual).toMatchObject({ rating: 3.1, count: 7 });
    __fakeRating().reset();
  });
  /* ---------------- contact numbers ---------------- */

  it("a fresh venue publishes no numbers at all", async () => {
    const { userId } = await signupWithVenue();
    const r = await getVenueContact(userId);
    if (!r.ok) throw new Error("no venue");
    expect(r.value).toEqual({
      landline: null,
      mobile: null,
      whatsapp: null,
      email: null,
      address: null,
    });
  });

  it("updateVenueContact stores E.164, whatever the owner typed", async () => {
    const { userId } = await signupWithVenue();
    expect(
      (
        await updateVenueContact(userId, {
          landline: "07531 123456",
          mobile: "+49 170 / 1234567",
          whatsapp: "0049 170 1234567",
          email: " Info@Restaurant.DE ",
        })
      ).ok,
    ).toBe(true);

    const saved = await getVenueContact(userId);
    if (!saved.ok) throw new Error("no venue");
    expect(saved.value).toEqual({
      landline: "+497531123456",
      mobile: "+491701234567",
      whatsapp: "+491701234567",
      email: "info@restaurant.de",
      address: null,
    });
  });

  it("a patch touches only the fields it carries, and an empty box clears one", async () => {
    const { userId } = await signupWithVenue();
    await updateVenueContact(userId, {
      landline: "07531 123456",
      mobile: "0170 1234567",
      whatsapp: "0170 1234567",
    });

    // Absent keys survive; an empty string is the clear.
    expect((await updateVenueContact(userId, { mobile: "0170 7654321" })).ok).toBe(true);
    expect((await updateVenueContact(userId, { whatsapp: "  " })).ok).toBe(true);

    const after = await getVenueContact(userId);
    if (!after.ok) throw new Error("no venue");
    expect(after.value).toEqual({
      landline: "+497531123456",
      mobile: "+491707654321",
      whatsapp: null,
      email: null,
      address: null,
    });

    // Explicit null is the same clear, from a JSON client rather than a form.
    expect((await updateVenueContact(userId, { landline: null })).ok).toBe(true);
    const cleared = await getVenueContact(userId);
    if (!cleared.ok) throw new Error("no venue");
    expect(cleared.value.landline).toBeNull();
  });

  it("names the bad number and writes none of the patch", async () => {
    const { userId } = await signupWithVenue();
    await updateVenueContact(userId, { landline: "07531 123456" });

    const bad = await updateVenueContact(userId, {
      landline: "07531 999999",
      mobile: "ring the bell",
    });
    expect(bad).toEqual({ ok: false, error: "invalid", field: "mobile" });

    // The good half of a refused patch never lands.
    const after = await getVenueContact(userId);
    if (!after.ok) throw new Error("no venue");
    expect(after.value.landline).toBe("+497531123456");
    expect(after.value.mobile).toBeNull();
  });

  /* ---------------- app links ("Get the app") ---------------- */

  it("a fresh venue publishes no app at all", async () => {
    const { userId } = await signupWithVenue();
    const r = await getVenueAppLinks(userId);
    if (!r.ok) throw new Error("no venue");
    expect(r.value).toEqual({ ios: null, android: null, apk: null });
  });

  it("updateVenueAppLinks stores the three links and reads them back", async () => {
    const { userId } = await signupWithVenue();
    expect(
      (
        await updateVenueAppLinks(userId, {
          ios: "  https://apps.apple.com/de/app/elvoria/id123456789  ",
          android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
          apk: "https://elvoria.example/downloads/app.apk",
        })
      ).ok,
    ).toBe(true);

    const saved = await getVenueAppLinks(userId);
    if (!saved.ok) throw new Error("no venue");
    // Stored canonical — the owner's clipboard whitespace is not part of
    // the link.
    expect(saved.value).toEqual({
      ios: "https://apps.apple.com/de/app/elvoria/id123456789",
      android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
      apk: "https://elvoria.example/downloads/app.apk",
    });
  });

  it("a patch touches only the fields it carries, and an empty box clears one", async () => {
    const { userId } = await signupWithVenue();
    await updateVenueAppLinks(userId, {
      ios: "https://apps.apple.com/de/app/elvoria/id1",
      android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
      apk: "https://elvoria.example/app.apk",
    });

    // Absent keys survive; an empty string is the clear.
    expect((await updateVenueAppLinks(userId, { apk: "  " })).ok).toBe(true);
    expect(
      (await updateVenueAppLinks(userId, { ios: "https://apps.apple.com/de/app/elvoria/id2" })).ok,
    ).toBe(true);

    const after = await getVenueAppLinks(userId);
    if (!after.ok) throw new Error("no venue");
    expect(after.value).toEqual({
      ios: "https://apps.apple.com/de/app/elvoria/id2",
      android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
      apk: null,
    });

    // Explicit null is the same clear, from a JSON client rather than a form.
    expect((await updateVenueAppLinks(userId, { android: null })).ok).toBe(true);
    const cleared = await getVenueAppLinks(userId);
    if (!cleared.ok) throw new Error("no venue");
    expect(cleared.value.android).toBeNull();
  });

  it("names the bad link and writes none of the patch", async () => {
    const { userId } = await signupWithVenue();
    await updateVenueAppLinks(userId, { ios: "https://apps.apple.com/de/app/elvoria/id1" });

    // The Play listing in the Apple box — the mistake the card exists for.
    const bad = await updateVenueAppLinks(userId, {
      android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
      ios: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
    });
    expect(bad).toEqual({ ok: false, error: "invalid", field: "ios" });

    // The good half of a refused patch never lands.
    const after = await getVenueAppLinks(userId);
    if (!after.ok) throw new Error("no venue");
    expect(after.value.ios).toBe("https://apps.apple.com/de/app/elvoria/id1");
    expect(after.value.android).toBeNull();
  });
});
