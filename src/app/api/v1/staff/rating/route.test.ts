import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { __fakeRating, mapsSearchUrl, reviewUrl } from "@/lib/google-rating";
import { signSession } from "@/lib/session";
import type { StaffRatingPayload } from "@/lib/staff-rating-service";
import { asTenant } from "@/lib/tenant";
import { POST as REFRESH } from "./refresh/route";
import { POST as SEARCH } from "./search/route";
import { GET, OPTIONS, PATCH } from "./route";

/**
 * The owner's Google-rating card, at the wire level (P7-14, app half).
 *
 * The app codes against these exact keys and re-derives none of them, so
 * the assertions worth having are about the VERDICT: which of the two
 * stored numbers `effective` names, that the switch hides it without
 * forgetting it, and that a refusal says which input to put the message
 * under. The fake provider stands in for Google throughout — an un-keyed
 * deployment is the default everywhere, including here.
 */

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const VENUE_NAME = "Rating Venue";

interface Body {
  ok: boolean;
  error?: string;
  field?: string;
  rating?: StaffRatingPayload;
  places?: { id: string; name: string; address: string }[];
}

describe("/api/v1/staff/rating", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  let guestToken: string;
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.14.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `rating-staff-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Rating Staff Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `rating-staff-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: VENUE_NAME, slug, currency: "EUR" },
        select: { id: true },
      }),
    );

    const guest = await registerCustomerWithPassword(
      tenantId,
      `guest-${randomUUID()}@ex.com`,
      "S3cureP4ssPhrase!",
      "Amrit",
    );
    if (!guest.ok) throw new Error("guest registration failed");
    guestToken = guest.value.token;
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    __fakeRating().reset();
    await asTenant(tenantId, async (tx) => {
      await tx.customerToken.deleteMany({});
      await tx.customer.deleteMany({});
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(method: "GET" | "PATCH" | "POST", token?: string, body?: unknown): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/staff/rating", {
      method,
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  }

  async function card(): Promise<StaffRatingPayload> {
    const res = await GET(request("GET", staffToken));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    if (!body.rating) throw new Error("no rating in body");
    return body.rating;
  }

  async function patch(input: unknown): Promise<{ status: number; body: Body }> {
    const res = await PATCH(request("PATCH", staffToken, input));
    return { status: res.status, body: (await res.json()) as Body };
  }

  it("401s with no token, a guest token, or a forged one", async () => {
    for (const token of [undefined, guestToken, "forged.payload"]) {
      for (const res of [
        await GET(request("GET", token)),
        await PATCH(request("PATCH", token, { enabled: true })),
        await REFRESH(request("POST", token, {})),
        await SEARCH(request("POST", token, { query: "x" })),
      ]) {
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
      }
    }
  });

  it("answers the preflight for the app's web surface", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("X-Staff-Token");
  });

  it("reads a fresh card: nothing stored, a Maps link, and no API key", async () => {
    const res = await GET(request("GET", staffToken));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(((await res.json()) as Body).rating).toEqual({
      enabled: true,
      placeId: null,
      fetched: null,
      manual: null,
      effective: null,
      // No Place ID yet, so the link is a Maps search for the venue —
      // the app refuses to render a rating without an http(s) URL.
      reviewUrl: mapsSearchUrl(VENUE_NAME),
      canFetch: false,
    });
  });

  it("saves the typed numbers, the Place ID, and the switch", async () => {
    const typed = await patch({ manual: { value: 4.7, count: 440 } });
    expect(typed.status).toBe(200);
    expect(typed.body.rating?.manual).toMatchObject({ value: 4.7, count: 440 });
    expect(typeof typed.body.rating?.manual?.updatedAt).toBe("string");
    expect(typed.body.rating?.effective).toEqual({ value: 4.7, count: 440, source: "manual" });

    const saved = await patch({ placeId: PLACE_ID });
    expect(saved.body.rating?.placeId).toBe(PLACE_ID);
    expect(saved.body.rating?.reviewUrl).toBe(reviewUrl(PLACE_ID));
    // A Place ID is not a rating: nothing has been fetched, so the number
    // the owner typed is still the one guests see.
    expect(saved.body.rating?.effective).toMatchObject({ source: "manual" });

    // Off hides the line without forgetting either number.
    const off = await patch({ enabled: false });
    expect(off.body.rating?.enabled).toBe(false);
    expect(off.body.rating?.effective).toBeNull();
    expect(off.body.rating?.manual).toMatchObject({ value: 4.7, count: 440 });

    const on = await patch({ enabled: true });
    expect(on.body.rating?.effective).toMatchObject({ value: 4.7, source: "manual" });

    const cleared = await patch({ manual: null });
    expect(cleared.body.rating?.manual).toBeNull();
    expect(cleared.body.rating?.effective).toBeNull();
    // Clearing the numbers leaves the Place ID alone.
    expect(cleared.body.rating?.placeId).toBe(PLACE_ID);

    const gone = await patch({ placeId: null });
    expect(gone.body.rating?.placeId).toBeNull();
    expect(gone.body.rating?.reviewUrl).toBe(mapsSearchUrl(VENUE_NAME));
  });

  it("400s each bad field by name", async () => {
    const cases: [unknown, string][] = [
      [{ manual: { value: 5.5, count: 10 } }, "value"],
      [{ manual: { value: 0.5, count: 10 } }, "value"],
      // Google publishes one decimal; "4.65" is a typo, not a rating.
      [{ manual: { value: 4.65, count: 10 } }, "value"],
      [{ manual: { value: "4.7", count: 10 } }, "value"],
      [{ manual: { value: 4.7, count: -1 } }, "count"],
      [{ manual: { value: 4.7, count: 1.5 } }, "count"],
      [{ manual: { value: 4.7, count: 10_000_001 } }, "count"],
      [{ placeId: "not a place id" }, "placeId"],
      [{ placeId: 7 }, "placeId"],
    ];
    for (const [input, field] of cases) {
      const res = await patch(input);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: "invalid", field });
    }

    // A patch with no keys, and one whose switch is not a boolean, are
    // refusals with no field to point at.
    for (const input of [{}, { enabled: "yes" }]) {
      const res = await patch(input);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: "invalid" });
    }
  });

  it("writes nothing when any part of the patch is bad", async () => {
    const before = await card();
    const res = await patch({ enabled: false, manual: { value: 9, count: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("value");
    expect(await card()).toEqual(before);
  });

  it("refuses to refresh without a Place ID, then without an API key", async () => {
    const fake = __fakeRating();
    fake.reset();
    await patch({ placeId: null });

    const none = await REFRESH(request("POST", staffToken, {}));
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ ok: false, error: "no_place_id" });
    // Nothing was asked of Google — there was nothing to ask about.
    expect(fake.calls).toHaveLength(0);

    await patch({ placeId: PLACE_ID });
    const keyless = await REFRESH(request("POST", staffToken, {}));
    expect(keyless.status).toBe(409);
    expect(await keyless.json()).toEqual({ ok: false, error: "no_api_key" });
    expect(fake.calls).toEqual([PLACE_ID]);
  });

  it("a fetched rating outranks the typed one and says so", async () => {
    const fake = __fakeRating();
    fake.reset();
    fake.next = { rating: 4.2, count: 88 };
    await patch({ placeId: PLACE_ID, manual: { value: 4.7, count: 440 } });

    const res = await REFRESH(request("POST", staffToken, {}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.rating?.fetched).toMatchObject({ value: 4.2, count: 88 });
    expect(typeof body.rating?.fetched?.fetchedAt).toBe("string");
    expect(body.rating?.effective).toEqual({ value: 4.2, count: 88, source: "fetched" });
    // The typed numbers stay put underneath it.
    expect(body.rating?.manual).toMatchObject({ value: 4.7, count: 440 });
    fake.reset();
  });

  it("searches Google for the venue's Place ID", async () => {
    const fake = __fakeRating();
    fake.reset();
    fake.nextSearch = [{ id: PLACE_ID, name: "Rangla Punjab", address: "Berlin" }];

    const res = await SEARCH(request("POST", staffToken, { query: "Rangla Punjab Berlin" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      places: [{ id: PLACE_ID, name: "Rangla Punjab", address: "Berlin" }],
    });
    expect(fake.searches).toEqual(["Rangla Punjab Berlin"]);

    // A blank box never spends a billable request.
    fake.reset();
    const blank = await SEARCH(request("POST", staffToken, { query: "   " }));
    expect(blank.status).toBe(502);
    expect(await blank.json()).toEqual({ ok: false, error: "not_found" });
    expect(fake.searches).toHaveLength(0);
  });
});
