import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { signSession } from "@/lib/session";
import type { StaffHoursWeek } from "@/lib/staff-hours-service";
import { asTenant } from "@/lib/tenant";
import { GET, PATCH } from "./route";

/**
 * Opening hours, edited from the counter.
 *
 * Asserted at the wire level because the React Native grid codes against
 * these exact keys: seven days ALWAYS present (a missing row is a missing
 * day on a phone), and a refusal that names the day so the app can mark
 * it rather than shrug. The round-trip goes all the way to the stored
 * JSONB, since that blob is the one the dashboard's Settings form and the
 * public open/closed badge both read.
 */
interface HoursBody {
  ok: boolean;
  error?: string;
  field?: string;
  timezone?: string;
  hours?: StaffHoursWeek;
  openNow?: boolean;
}

const FULL_WEEK = {
  mon: { closed: false, slots: [{ open: "11:00", close: "22:00" }] },
  tue: { closed: false, slots: [{ open: "11:00", close: "22:00" }] },
  wed: { closed: true, slots: [] },
  thu: {
    closed: false,
    slots: [
      { open: "11:00", close: "14:30" },
      { open: "17:30", close: "22:00" },
    ],
  },
  fri: { closed: false, slots: [{ open: "11:00", close: "23:00" }] },
  sat: { closed: false, slots: [{ open: "17:00", close: "02:00" }] },
  sun: { closed: false, slots: [{ open: "12:00", close: "21:00" }] },
};

describe("/api/v1/staff/hours", () => {
  let tenantId: string;
  let userId: string;
  let venueId: string;
  let staffToken: string;
  let guestToken: string;

  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.11.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const signup = await signupUser({
      email: `hours-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Hours Test",
    });
    if (!signup.ok) throw new Error("signup failed");
    tenantId = signup.tenantId;
    userId = signup.userId;
    staffToken = signSession(userId);

    const slug = `hours-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venueId = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const venue = await tx.venue.create({
        data: {
          tenantId,
          name: "Hours Venue",
          slug,
          currency: "EUR",
          timezone: "Europe/Berlin",
        },
        select: { id: true },
      });
      return venue.id;
    });

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
    await asTenant(tenantId, (tx) => tx.customerToken.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(token?: string, body?: unknown): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/staff/hours", {
      method: body === undefined ? "GET" : "PATCH",
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function patch(body: unknown): Promise<{ status: number; body: HoursBody }> {
    const res = await PATCH(request(staffToken, body));
    return { status: res.status, body: (await res.json()) as HoursBody };
  }

  async function read(): Promise<{ status: number; body: HoursBody; headers: Headers }> {
    const res = await GET(request(staffToken));
    return { status: res.status, body: (await res.json()) as HoursBody, headers: res.headers };
  }

  it("401s with no token, a guest token, or a forged one", async () => {
    for (const token of [undefined, guestToken, "forged.payload"]) {
      const get = await GET(request(token));
      expect(get.status).toBe(401);
      expect(await get.json()).toEqual({ ok: false, error: "unauthorized" });
      expect(get.headers.get("access-control-allow-origin")).toBe("*");

      const write = await PATCH(request(token, { hours: FULL_WEEK }));
      expect(write.status).toBe(401);
      expect(await write.json()).toEqual({ ok: false, error: "unauthorized" });
    }
  });

  it("answers all seven days — closed — for a venue with no hours yet", async () => {
    const { status, body, headers } = await read();
    expect(status).toBe(200);
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.ok).toBe(true);
    expect(body.timezone).toBe("Europe/Berlin");
    expect(Object.keys(body.hours!)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    expect(Object.values(body.hours!).every((d) => d.closed && d.slots.length === 0)).toBe(true);
    // Never configured is never open — a misleading "Open" is worse than
    // an empty grid.
    expect(body.openNow).toBe(false);
  });

  it("round-trips a whole week, including a split day and an overnight bar", async () => {
    const written = await patch({ hours: FULL_WEEK });
    expect(written.status).toBe(200);
    expect(written.body.ok).toBe(true);
    expect(written.body.timezone).toBe("Europe/Berlin");
    expect(written.body.hours).toEqual(FULL_WEEK);
    expect(typeof written.body.openNow).toBe("boolean");

    // The next GET agrees — the answer was a re-read, not an echo.
    const after = await read();
    expect(after.body.hours).toEqual(FULL_WEEK);
    expect(after.body.openNow).toBe(written.body.openNow);

    // And the stored JSONB is the canonical shape the dashboard form and
    // the public badge read, not a second dialect.
    const stored = await asTenant(tenantId, (tx) =>
      tx.venue.findFirstOrThrow({ where: { id: venueId }, select: { hours: true } }),
    );
    const hours = stored.hours as { configured: boolean; days: Record<string, unknown> };
    expect(hours.configured).toBe(true);
    // jsonb does not preserve key order, so compare the SET of days.
    expect(Object.keys(hours.days).sort()).toEqual(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].sort(),
    );
    expect(hours.days.sat).toEqual({ closed: false, slots: [{ open: "17:00", close: "02:00" }] });
  });

  it("reports openNow from the venue's clock, not the caller's", async () => {
    const open = await patch({
      hours: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
          d,
          { closed: false, slots: [{ open: "00:00", close: "23:59" }] },
        ]),
      ),
    });
    expect(open.body.openNow).toBe(true);

    const shut = await patch({
      hours: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
          d,
          { closed: true, slots: [] },
        ]),
      ),
    });
    expect(shut.body.openNow).toBe(false);
    expect(shut.body.hours?.mon).toEqual({ closed: true, slots: [] });
  });

  it("accepts a partial week and closes every day it was not told about", async () => {
    const { status, body } = await patch({
      hours: { mon: { closed: false, slots: [{ open: "09:00", close: "17:00" }] } },
    });
    expect(status).toBe(200);
    expect(body.hours?.mon).toEqual({ closed: false, slots: [{ open: "09:00", close: "17:00" }] });
    expect(body.hours?.sun).toEqual({ closed: true, slots: [] });
  });

  it("400s a bad slot and names the day, leaving the stored week untouched", async () => {
    await patch({ hours: FULL_WEEK });

    const cases: [string, unknown, string][] = [
      [
        "out-of-range hour",
        { ...FULL_WEEK, tue: { closed: false, slots: [{ open: "25:00", close: "22:00" }] } },
        "tue",
      ],
      [
        "out-of-range minute",
        { ...FULL_WEEK, fri: { closed: false, slots: [{ open: "11:00", close: "22:70" }] } },
        "fri",
      ],
      [
        "unpadded time",
        { ...FULL_WEEK, mon: { closed: false, slots: [{ open: "9:00", close: "17:00" }] } },
        "mon",
      ],
      [
        "missing close",
        { ...FULL_WEEK, sun: { closed: false, slots: [{ open: "11:00" }] } },
        "sun",
      ],
      [
        "a third window",
        {
          ...FULL_WEEK,
          thu: {
            closed: false,
            slots: [
              { open: "08:00", close: "10:00" },
              { open: "11:00", close: "14:00" },
              { open: "17:00", close: "22:00" },
            ],
          },
        },
        "thu",
      ],
      ["day is not an object", { ...FULL_WEEK, sat: "17:00-02:00" }, "sat"],
    ];

    for (const [name, hours, field] of cases) {
      const res = await patch({ hours });
      expect(res.status, name).toBe(400);
      expect(res.body, name).toEqual({ ok: false, error: "invalid", field });
    }

    // A refused write is a write that did not happen.
    expect((await read()).body.hours).toEqual(FULL_WEEK);
  });

  it("400s a body that is not a week at all, with nothing to blame", async () => {
    for (const body of [null, {}, { hours: "closed" }, { hours: [] }]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: "invalid" });
    }
  });
});
