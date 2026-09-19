import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import {
  FakeRatingProvider,
  RATING_TTL_MS,
  __fakeRating,
  fetchPlaceRating,
  getRatingProvider,
  getVenueRating,
  isRatingStale,
  parseCachedRating,
  publicRating,
  refreshVenueRating,
  reviewUrl,
  scheduleVenueRatingRefresh,
} from "./google-rating";
import { asTenant } from "./tenant";

/**
 * The Google rating cache, on the fake provider (P7-14).
 *
 * The assertions that matter are about what does NOT happen: an un-keyed
 * deployment never calls Google, a fresh cache never calls Google, and a
 * failed lookup never empties a rating that was already on screen.
 */

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

function cached(ageMs: number, rating = 4.6, count = 312): Prisma.InputJsonObject {
  return { rating, count, fetchedAt: new Date(Date.now() - ageMs).toISOString() };
}

describe("reviewUrl", () => {
  it("points at Google's own review form and escapes the id", () => {
    expect(reviewUrl(PLACE_ID)).toBe(
      `https://search.google.com/local/writereview?placeid=${PLACE_ID}`,
    );
    expect(reviewUrl("a b&c")).toBe(
      "https://search.google.com/local/writereview?placeid=a%20b%26c",
    );
  });
});

describe("rating provider selection", () => {
  it("rides the fake while GOOGLE_PLACES_API_KEY is unset, and hands out one recorder", () => {
    expect(process.env.GOOGLE_PLACES_API_KEY).toBeUndefined();
    const provider = getRatingProvider();
    expect(provider.mode).toBe("fake");
    expect(provider).toBe(__fakeRating());
  });

  it("records every lookup and answers whatever the test staged", async () => {
    const fake = new FakeRatingProvider();
    expect(await fake.fetch(PLACE_ID)).toBeNull();
    fake.next = { rating: 4.2, count: 88 };
    expect(await fake.fetch(PLACE_ID)).toEqual({ rating: 4.2, count: 88 });
    expect(fake.calls).toEqual([PLACE_ID, PLACE_ID]);
    fake.reset();
    expect(fake.calls).toHaveLength(0);
    expect(fake.next).toBeNull();
  });

  it("an empty place id never reaches the provider", async () => {
    __fakeRating().reset();
    expect(await fetchPlaceRating("")).toBeNull();
    expect(__fakeRating().calls).toHaveLength(0);
  });
});

describe("parseCachedRating", () => {
  it("accepts a well-formed cache and rejects everything implausible", () => {
    expect(parseCachedRating(cached(0))).toMatchObject({ rating: 4.6, count: 312 });
    for (const bad of [
      null,
      undefined,
      "4.6",
      {},
      { rating: 4.6, count: 312 },
      { rating: 4.6, count: 312, fetchedAt: "never" },
      { rating: 0, count: 10, fetchedAt: new Date().toISOString() },
      { rating: 5.5, count: 10, fetchedAt: new Date().toISOString() },
      { rating: 4.6, count: -1, fetchedAt: new Date().toISOString() },
      { rating: "4.6", count: 10, fetchedAt: new Date().toISOString() },
    ]) {
      expect(parseCachedRating(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("publicRating", () => {
  it("needs BOTH a place id and a parsable cache", () => {
    expect(publicRating({ googlePlaceId: PLACE_ID, googleRating: cached(0) })).toEqual({
      value: 4.6,
      count: 312,
      reviewUrl: reviewUrl(PLACE_ID),
    });
    expect(publicRating({ googlePlaceId: null, googleRating: cached(0) })).toBeNull();
    expect(publicRating({ googlePlaceId: PLACE_ID, googleRating: null })).toBeNull();
  });

  it("keeps serving a cached rating that is stale — staleness is the refresher's problem", () => {
    const old = publicRating({ googlePlaceId: PLACE_ID, googleRating: cached(RATING_TTL_MS * 9) });
    expect(old).toMatchObject({ value: 4.6 });
  });
});

describe("isRatingStale", () => {
  it("counts a missing cache as stale and a day-old one as due", () => {
    expect(isRatingStale(null)).toBe(true);
    expect(isRatingStale(parseCachedRating(cached(60_000)))).toBe(false);
    expect(isRatingStale(parseCachedRating(cached(RATING_TTL_MS - 1000)))).toBe(false);
    expect(isRatingStale(parseCachedRating(cached(RATING_TTL_MS + 1000)))).toBe(true);
  });
});

describe("scheduleVenueRatingRefresh", () => {
  // No API key in this process, so the scheduler must refuse every case —
  // which is exactly the un-keyed deployment's behaviour: zero requests.
  it("never schedules anything without an API key", () => {
    expect(
      scheduleVenueRatingRefresh("t1", "v1", { googlePlaceId: PLACE_ID, googleRating: null }),
    ).toBe(false);
    expect(
      scheduleVenueRatingRefresh("t1", "v1", { googlePlaceId: null, googleRating: null }),
    ).toBe(false);
  });
});

describe("the cache against a real venue row", () => {
  const userIds: string[] = [];
  const tenantIds: string[] = [];
  let tenantId: string;
  let venueId: string;

  beforeEach(async () => {
    __fakeRating().reset();
    const s = await signupUser({
      email: `rating-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Rating Test",
    });
    if (!s.ok) throw new Error("signup failed");
    userIds.push(s.userId);
    tenantIds.push(s.tenantId);
    tenantId = s.tenantId;
    venueId = await asTenant(s.tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Rating Venue",
          slug: `rating-${randomUUID().slice(0, 8)}`,
        },
        select: { id: true },
      });
      return venue.id;
    });
  });

  afterAll(async () => {
    for (const tid of tenantIds) {
      await asTenant(tid, (tx) => tx.venue.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("a venue with no Place ID has no rating and costs no lookup", async () => {
    expect(await getVenueRating(tenantId, venueId)).toBeNull();
    expect(__fakeRating().calls).toHaveLength(0);
  });

  it("serves the cached rating with a review link, without calling out (fresh)", async () => {
    await asTenant(tenantId, (tx) =>
      tx.venue.update({
        where: { id: venueId },
        data: { googlePlaceId: PLACE_ID, googleRating: cached(60_000) },
      }),
    );
    expect(await getVenueRating(tenantId, venueId)).toEqual({
      value: 4.6,
      count: 312,
      reviewUrl: reviewUrl(PLACE_ID),
    });
    // Fresh cache ⇒ nothing scheduled, and nothing scheduled ⇒ no lookup,
    // whether or not a key exists.
    expect(__fakeRating().calls).toHaveLength(0);
  });

  it("still serves a stale rating — the refresh happens behind the answer", async () => {
    await asTenant(tenantId, (tx) =>
      tx.venue.update({
        where: { id: venueId },
        data: { googlePlaceId: PLACE_ID, googleRating: cached(RATING_TTL_MS + 60_000, 4.1, 7) },
      }),
    );
    expect(await getVenueRating(tenantId, venueId)).toMatchObject({ value: 4.1, count: 7 });
  });

  it("writes what Google answered, and leaves the old number alone when it answers nothing", async () => {
    await asTenant(tenantId, (tx) =>
      tx.venue.update({
        where: { id: venueId },
        data: { googlePlaceId: PLACE_ID, googleRating: cached(RATING_TTL_MS * 2, 3.9, 12) },
      }),
    );

    // A failed lookup (the fake's default) must not empty the cache: a bad
    // day at Google is not a reason to blank a restaurant's rating.
    expect(await refreshVenueRating(tenantId, venueId, PLACE_ID)).toBeNull();
    expect(await getVenueRating(tenantId, venueId)).toMatchObject({ value: 3.9, count: 12 });

    __fakeRating().next = { rating: 4.8, count: 401 };
    const written = await refreshVenueRating(tenantId, venueId, PLACE_ID);
    expect(written).toMatchObject({ rating: 4.8, count: 401 });
    expect(Date.parse(written!.fetchedAt)).toBeLessThanOrEqual(Date.now());
    expect(await getVenueRating(tenantId, venueId)).toMatchObject({ value: 4.8, count: 401 });
  });

  it("an answer about a place the owner has since changed is dropped", async () => {
    await asTenant(tenantId, (tx) =>
      tx.venue.update({ where: { id: venueId }, data: { googlePlaceId: "SomeOtherPlaceId" } }),
    );
    __fakeRating().next = { rating: 5, count: 3 };
    // The lookup was for PLACE_ID; the venue now points somewhere else, so
    // the write is guarded away and the venue keeps no rating at all.
    expect(await refreshVenueRating(tenantId, venueId, PLACE_ID)).toMatchObject({ rating: 5 });
    expect(await getVenueRating(tenantId, venueId)).toBeNull();
  });

  it("never throws for a venue that does not exist", async () => {
    expect(await getVenueRating(tenantId, "no-such-venue")).toBeNull();
    expect(await refreshVenueRating(tenantId, "no-such-venue", PLACE_ID)).toBeNull();
  });
});
