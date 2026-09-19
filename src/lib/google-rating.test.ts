import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import {
  FakeRatingProvider,
  GooglePlacesProvider,
  RATING_TTL_MS,
  __fakeRating,
  fetchPlaceRating,
  getRatingProvider,
  getVenueRating,
  isRatingStale,
  mapPlacesError,
  mapsSearchUrl,
  parseCachedRating,
  parseManualRating,
  parseManualRatingInput,
  publicRating,
  refreshVenueRating,
  refreshVenueRatingNow,
  reviewCallToAction,
  reviewUrl,
  scheduleVenueRatingRefresh,
  searchPlaces,
  type RatingError,
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

/** What `venues.google_rating_manual` holds after the owner types it. */
function manual(rating: number, count: number): Prisma.InputJsonObject {
  return { rating, count, updatedAt: new Date().toISOString() };
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

describe("Places error mapping", () => {
  // Google says the same failure two ways; the prose is the specific one.
  const cases: Array<[string, number, unknown, RatingError]> = [
    [
      "a project without Places API (New) switched on",
      403,
      {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "Places API (New) has not been used in project 1234 before or it is disabled.",
        },
      },
      "api_not_enabled",
    ],
    [
      "a key Google will not accept",
      400,
      { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid." } },
      "key_invalid",
    ],
    [
      "a key restricted away from this server",
      403,
      {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "Requests from referer <empty> are blocked.",
        },
      },
      "key_invalid",
    ],
    [
      "quota burned through",
      429,
      { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded." } },
      "quota",
    ],
    [
      "a place id that names nothing",
      404,
      { error: { code: 404, status: "NOT_FOUND", message: "Requested entity was not found." } },
      "not_found",
    ],
    ["an HTML 502 from something in between", 502, null, "network"],
    ["a shape we have never seen", 418, { teapot: true }, "unknown"],
  ];

  it.each(cases)("%s → %s", (_label, status, body, expected) => {
    expect(mapPlacesError(status, body)).toBe(expected);
  });
});

describe("GooglePlacesProvider against a mocked fetch", () => {
  const provider = new GooglePlacesProvider("test-key");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stub(status: number, body: unknown): void {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }

  it("reads a rating and keeps the reason when Google refuses", async () => {
    stub(200, { rating: 4.7, userRatingCount: 440 });
    expect(await provider.lookup(PLACE_ID)).toEqual({
      ok: true,
      rating: { rating: 4.7, count: 440 },
    });

    stub(403, {
      error: { status: "PERMISSION_DENIED", message: "Places API (New) has not been used" },
    });
    expect(await provider.lookup(PLACE_ID)).toEqual({ ok: false, error: "api_not_enabled" });
    // The legacy null-returning face of the same call is unchanged.
    expect(await provider.fetch(PLACE_ID)).toBeNull();
  });

  it("a place with no reviews yet is not_found, not a crash", async () => {
    stub(200, {});
    expect(await provider.lookup(PLACE_ID)).toEqual({ ok: false, error: "not_found" });
  });

  it("searches Text Search with the field mask and the api key", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [
            {
              id: PLACE_ID,
              displayName: { text: "Rangla Punjab", languageCode: "en" },
              formattedAddress: "Hauptstr. 1, 10827 Berlin",
            },
            { id: "ChIJsecond", displayName: { text: "Rangla Punjab 2" } },
            { notAPlace: true },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    expect(await provider.searchPlaces("Rangla Punjab Berlin")).toEqual({
      ok: true,
      places: [
        { id: PLACE_ID, name: "Rangla Punjab", address: "Hauptstr. 1, 10827 Berlin" },
        { id: "ChIJsecond", name: "Rangla Punjab 2", address: "" },
      ],
    });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(headers["X-Goog-FieldMask"]).toBe(
      "places.id,places.displayName,places.formattedAddress",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      textQuery: "Rangla Punjab Berlin",
      maxResultCount: 5,
    });
  });

  it("an empty result set is not_found, and a refusal keeps its code", async () => {
    stub(200, { places: [] });
    expect(await provider.searchPlaces("nowhere")).toEqual({ ok: false, error: "not_found" });

    stub(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } });
    expect(await provider.searchPlaces("anything")).toEqual({ ok: false, error: "quota" });
  });

  it("never throws when the transport does", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    expect(await provider.lookup(PLACE_ID)).toEqual({ ok: false, error: "network" });
    expect(await provider.searchPlaces("x")).toEqual({ ok: false, error: "network" });
    expect(await provider.fetch(PLACE_ID)).toBeNull();
  });
});

describe("searchPlaces on the fake", () => {
  beforeEach(() => __fakeRating().reset());

  it("hands back what the fake staged, trimmed and capped", async () => {
    __fakeRating().nextSearch = [
      { id: PLACE_ID, name: "Rangla Punjab", address: "Hauptstr. 1, Berlin" },
    ];
    expect(await searchPlaces("  Rangla Punjab Berlin  ")).toEqual({
      ok: true,
      places: [{ id: PLACE_ID, name: "Rangla Punjab", address: "Hauptstr. 1, Berlin" }],
    });
    // Trimmed before it reaches the provider — the query is billed as typed.
    expect(__fakeRating().searches).toEqual(["Rangla Punjab Berlin"]);
  });

  it("an un-keyed deployment says so instead of pretending nothing matched", async () => {
    expect(await searchPlaces("Rangla Punjab")).toEqual({ ok: false, error: "no_api_key" });
  });

  it("a blank query never costs a request", async () => {
    expect(await searchPlaces("   ")).toEqual({ ok: false, error: "not_found" });
    expect(__fakeRating().searches).toHaveLength(0);
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

  it("lets a FETCHED rating outrank the owner's own number", () => {
    expect(
      publicRating({
        googlePlaceId: PLACE_ID,
        googleRating: cached(0),
        googleRatingManual: manual(3.1, 7),
      }),
    ).toEqual({ value: 4.6, count: 312, reviewUrl: reviewUrl(PLACE_ID) });
  });

  it("falls back to the owner's number when nothing has been fetched", () => {
    expect(
      publicRating({
        googlePlaceId: PLACE_ID,
        googleRating: null,
        googleRatingManual: manual(4.7, 440),
      }),
    ).toEqual({ value: 4.7, count: 440, reviewUrl: reviewUrl(PLACE_ID) });

    // …and also when the fetched cache is there but unparsable.
    expect(
      publicRating({
        googlePlaceId: PLACE_ID,
        googleRating: { rating: "nope" },
        googleRatingManual: manual(4.7, 440),
      }),
    ).toMatchObject({ value: 4.7 });
  });

  it("shows a hand-entered rating with NO review link when there is no Place ID", () => {
    expect(
      publicRating({
        googlePlaceId: null,
        googleRating: cached(0),
        googleRatingManual: manual(4.7, 440),
      }),
    ).toEqual({ value: 4.7, count: 440, reviewUrl: null });
  });

  it("shows nothing at all while the owner has the line switched off", () => {
    // Off outranks BOTH sources, and the stored numbers survive it — the
    // switch hides the line, it does not forget anything.
    expect(
      publicRating({
        googlePlaceId: PLACE_ID,
        googleRating: cached(0),
        googleRatingManual: manual(4.7, 440),
        googleRatingEnabled: false,
      }),
    ).toBeNull();
    // Absent means ON: every venue that predates the switch was showing
    // its rating and must keep doing so.
    expect(publicRating({ googlePlaceId: PLACE_ID, googleRating: cached(0) })).toMatchObject({
      value: 4.6,
    });
    expect(
      publicRating({
        googlePlaceId: PLACE_ID,
        googleRating: cached(0),
        googleRatingEnabled: true,
      }),
    ).toMatchObject({ value: 4.6 });
  });

  it("is still null when neither source has anything readable", () => {
    expect(
      publicRating({ googlePlaceId: null, googleRating: null, googleRatingManual: null }),
    ).toBeNull();
    expect(
      publicRating({
        googlePlaceId: PLACE_ID,
        googleRating: null,
        googleRatingManual: { rating: 4.7, count: 440 },
      }),
    ).toBeNull();
  });
});

describe("parseManualRating", () => {
  const ok = (rating: number, count: number): Record<string, unknown> => ({
    rating,
    count,
    updatedAt: new Date().toISOString(),
  });

  it("accepts one-decimal ratings in range and rejects anything else", () => {
    expect(parseManualRating(ok(4.7, 440))).toMatchObject({ rating: 4.7, count: 440 });
    expect(parseManualRating(ok(1, 0))).toMatchObject({ rating: 1, count: 0 });
    expect(parseManualRating(ok(5, 10_000_000))).toMatchObject({ rating: 5, count: 10_000_000 });
    for (const bad of [
      null,
      "4.7",
      {},
      { rating: 4.7, count: 440 },
      { rating: 4.7, count: 440, updatedAt: "whenever" },
      // Two decimals is not a number Google publishes — a typo, refused
      // rather than silently rounded onto somebody's menu.
      ok(4.65, 440),
      ok(0.9, 10),
      ok(5.1, 10),
      ok(4.7, -1),
      ok(4.7, 1.5),
      ok(4.7, 10_000_001),
    ]) {
      expect(parseManualRating(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("parseManualRatingInput", () => {
  it("takes what an owner actually types, comma decimal included", () => {
    expect(parseManualRatingInput("4.7", "440")).toEqual({ rating: 4.7, count: 440 });
    // A German keyboard's own Google profile reads "4,7"; refusing it
    // would be refusing the correct answer.
    expect(parseManualRatingInput(" 4,7 ", " 440 ")).toEqual({ rating: 4.7, count: 440 });
    expect(parseManualRatingInput("5", "0")).toEqual({ rating: 5, count: 0 });
  });

  it("refuses half-answers and anything that isn't a number", () => {
    for (const [r, c] of [
      ["", "440"],
      ["4.7", ""],
      ["four", "440"],
      ["4.7", "4.4"],
      ["4.7", "1,204"],
      ["-4.7", "440"],
      ["4.65", "440"],
      ["6", "440"],
    ]) {
      expect(parseManualRatingInput(r!, c!), `${r}/${c}`).toBeNull();
    }
  });
});

describe("reviewCallToAction", () => {
  it("hands back the WRITE-REVIEW url, with the number when we have one", () => {
    expect(reviewCallToAction({ googlePlaceId: PLACE_ID, googleRating: cached(0) })).toEqual({
      reviewUrl: reviewUrl(PLACE_ID),
      ratingValue: 4.6,
    });
    // A Place ID and no number yet is the venue that most needs the ask.
    expect(reviewCallToAction({ googlePlaceId: PLACE_ID, googleRating: null })).toEqual({
      reviewUrl: reviewUrl(PLACE_ID),
    });
    // Same precedence as the rating line: fetched outranks hand-typed.
    expect(
      reviewCallToAction({
        googlePlaceId: PLACE_ID,
        googleRating: cached(0),
        googleRatingManual: manual(3.1, 7),
      }),
    ).toMatchObject({ ratingValue: 4.6 });
  });

  it("refuses without a Place ID — a rate-us button must not open a search page", () => {
    // `publicRating` would still render the owner's own number here, and
    // `mapsSearchUrl` would still give the app somewhere to go. Neither
    // is an acceptable destination for "rate us": only the real form is.
    expect(
      reviewCallToAction({
        googlePlaceId: null,
        googleRating: null,
        googleRatingManual: manual(4.8, 120),
      }),
    ).toBeNull();
    expect(reviewCallToAction({ googlePlaceId: null, googleRating: cached(0) })).toBeNull();
  });

  it("obeys the owner's switch", () => {
    expect(
      reviewCallToAction({
        googlePlaceId: PLACE_ID,
        googleRating: cached(0),
        googleRatingEnabled: false,
      }),
    ).toBeNull();
    // Absent means on, same as everywhere else.
    expect(
      reviewCallToAction({
        googlePlaceId: PLACE_ID,
        googleRating: cached(0),
        googleRatingEnabled: true,
      }),
    ).toMatchObject({ reviewUrl: reviewUrl(PLACE_ID) });
  });
});

describe("mapsSearchUrl", () => {
  it("escapes the venue name into an openable Maps search", () => {
    expect(mapsSearchUrl(" Rangla Punjab & Co ")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Rangla%20Punjab%20%26%20Co",
    );
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
  it("refuses to spend a Google call on a line nobody can see", () => {
    expect(
      scheduleVenueRatingRefresh("t1", "v1", {
        googlePlaceId: PLACE_ID,
        googleRating: null,
        googleRatingEnabled: false,
      }),
    ).toBe(false);
  });

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

  it("refreshVenueRatingNow keeps the reason the owner's button needs", async () => {
    await asTenant(tenantId, (tx) =>
      tx.venue.update({ where: { id: venueId }, data: { googlePlaceId: PLACE_ID } }),
    );

    // No key in this process ⇒ the fake ⇒ the honest reason, not "null".
    expect(await refreshVenueRatingNow(tenantId, venueId, PLACE_ID)).toEqual({
      ok: false,
      error: "no_api_key",
    });

    __fakeRating().nextError = "quota";
    expect(await refreshVenueRatingNow(tenantId, venueId, PLACE_ID)).toEqual({
      ok: false,
      error: "quota",
    });

    __fakeRating().next = { rating: 4.7, count: 440 };
    const ok = await refreshVenueRatingNow(tenantId, venueId, PLACE_ID);
    expect(ok.ok && ok.cached).toMatchObject({ rating: 4.7, count: 440 });
  });

  it("never throws for a venue that does not exist", async () => {
    expect(await getVenueRating(tenantId, "no-such-venue")).toBeNull();
    expect(await refreshVenueRating(tenantId, "no-such-venue", PLACE_ID)).toBeNull();
  });
});
