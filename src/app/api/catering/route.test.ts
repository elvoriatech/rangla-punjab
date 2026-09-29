import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import {
  addMonthsISO,
  cateringWindow,
  listCateringRequests,
  setCateringStatus,
} from "@/lib/catering-service";
import { asTenant } from "@/lib/tenant";
import { POST } from "./route";

/**
 * Catering enquiries end to end: the public POST the app sends, the
 * owner's dashboard list, and the status buttons. The rules under test
 * are the owner's (2026-09-29): any guest count, a phone number always,
 * and any date from tomorrow to four months out.
 */

const TIMEZONE = "Europe/Berlin";

describe("addMonthsISO", () => {
  it("adds calendar months and clamps the day to the month's length", () => {
    expect(addMonthsISO("2026-09-29", 4)).toBe("2027-01-29");
    expect(addMonthsISO("2026-10-31", 4)).toBe("2027-02-28");
    expect(addMonthsISO("2027-10-31", 4)).toBe("2028-02-29");
    expect(addMonthsISO("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("guest catering requests", () => {
  let tenantId: string;
  let userId: string;
  let otherTenantId: string;
  let otherUserId: string;
  let slug: string;
  const originalSlug = process.env.RESTAURANT_SLUG;
  const window = cateringWindow(TIMEZONE);

  beforeAll(async () => {
    const s = await signupUser({
      email: `cat-api-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Catering API Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    slug = `cat-api-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: "Catering Test House", slug, timezone: TIMEZONE, currency: "EUR" },
      }),
    );

    const o = await signupUser({
      email: `cat-other-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Catering Other Tenant",
    });
    if (!o.ok) throw new Error("signup failed");
    otherTenantId = o.tenantId;
    otherUserId = o.userId;
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    for (const [t, u] of [
      [tenantId, userId],
      [otherTenantId, otherUserId],
    ] as const) {
      await asTenant(t, (tx) => tx.cateringRequest.deleteMany({}));
      await asTenant(t, (tx) => tx.membership.deleteMany({}));
      await asTenant(t, (tx) => tx.tenant.deleteMany({}));
      await prisma.user.deleteMany({ where: { id: u } });
    }
  });

  /** One POST. Fresh IP per call: the create limiter is 5/hour. */
  async function post(body: Record<string, unknown>): Promise<Response> {
    const ip = `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    return POST(
      new NextRequest("http://localhost:3000/api/catering", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ slug, ...body }),
      }),
    );
  }

  const valid = {
    name: "Anna Müller",
    phone: "+49 176 1234567",
    guests: 80,
    date: window.last,
  };

  it("files a full enquiry and lists it on the owner's dashboard", async () => {
    const res = await post({
      ...valid,
      email: "anna@example.com",
      time: "18:30",
      location: "Bürgersaal, Hauptstr. 12",
      message: "Wedding, mostly vegetarian",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; date: string };
    expect(body.status).toBe("requested");
    expect(body.date).toBe(window.last);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const rows = await listCateringRequests(userId);
    const row = rows.find((r) => r.id === body.id);
    expect(row).toMatchObject({
      name: "Anna Müller",
      guests: 80,
      email: "anna@example.com",
      time: "18:30",
      location: "Bürgersaal, Hauptstr. 12",
      message: "Wedding, mostly vegetarian",
      status: "requested",
    });
  });

  it("accepts any party size — a wedding of 1200 as well as a dinner for 1", async () => {
    expect((await post({ ...valid, guests: 1200, date: window.first })).status).toBe(201);
    expect((await post({ ...valid, guests: 1, email: "", time: "" })).status).toBe(201);
  });

  it("requires a phone number and a name", async () => {
    expect((await post({ ...valid, phone: "" })).status).toBe(400);
    const { phone: _p, ...noPhone } = valid;
    expect((await post(noPhone)).status).toBe(400);
    expect((await post({ ...valid, name: "A" })).status).toBe(400);
  });

  it("rejects dates outside tomorrow … four months, and impossible dates", async () => {
    const res = await post({ ...valid, date: addMonthsISO(window.last, 1) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_date" });
    const dayAfterLast = new Date(`${window.last}T12:00:00Z`);
    dayAfterLast.setUTCDate(dayAfterLast.getUTCDate() + 1);
    const tooLate = dayAfterLast.toISOString().slice(0, 10);
    expect((await post({ ...valid, date: tooLate })).status).toBe(400);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
    expect((await post({ ...valid, date: today })).status).toBe(400);
    expect((await post({ ...valid, date: "2026-02-30" })).status).toBe(400);
  });

  it("rejects a malformed email rather than storing it", async () => {
    expect((await post({ ...valid, email: "not-an-email" })).status).toBe(400);
  });

  it("lets the owner confirm, and refuses unknown statuses", async () => {
    const res = await post(valid);
    const { id } = (await res.json()) as { id: string };
    expect(await setCateringStatus(userId, id, "confirmed")).toEqual({ ok: true });
    expect(await setCateringStatus(userId, id, "requested")).toEqual({ ok: false });
    expect(await setCateringStatus(userId, id, "bogus")).toEqual({ ok: false });
    const row = (await listCateringRequests(userId)).find((r) => r.id === id);
    expect(row?.status).toBe("confirmed");
  });

  it("never shows one restaurant's enquiries to another", async () => {
    expect(await listCateringRequests(otherUserId)).toEqual([]);
    const anyId = (await listCateringRequests(userId))[0]!.id;
    expect(await setCateringStatus(otherUserId, anyId, "declined")).toEqual({ ok: false });
    expect(
      await asTenant(otherTenantId, (tx) => tx.cateringRequest.findMany({ where: { tenantId } })),
    ).toEqual([]);
  });

  it("404s an unknown venue", async () => {
    const res = await post({ ...valid, slug: `nope-${randomUUID().slice(0, 6)}` });
    expect(res.status).toBe(404);
  });
});
