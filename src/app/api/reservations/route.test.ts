import { randomUUID } from "node:crypto";
import { ReservationStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { signInCustomer } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { RESERVATION_DAYS_AHEAD, reservableDates, slotTimesForDate } from "@/lib/opening-hours";
import { RESERVATION_STATUSES, setReservationStatus } from "@/lib/reservation-service";
import { signReservationToken, verifyReservationToken } from "@/lib/reservation-token";
import { asTenant } from "@/lib/tenant";
import { GET as GET_STATUS } from "../v1/reservations/[id]/route";
import { GET as GET_MINE } from "../v1/me/reservations/route";
import { POST } from "./route";

/**
 * "Can a guest see their reservation status?" end to end — creation,
 * the token-gated public read, and the signed-in guest's own list. One
 * suite because it is one contract: the token minted by POST is the
 * credential the status route takes, and the mobile app codes against
 * these exact keys, so a silent rename anywhere in the chain is a
 * shipped app showing a guest nothing.
 */

interface CreateBody {
  reservationId: string;
  id: string;
  date: string;
  time: string;
  status: string;
  token: string;
}

interface ReservationView {
  id: string;
  date: string;
  time: string;
  guests: number;
  name: string;
  status: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  venue: { name: string; phone: string | null };
}

interface StatusBody {
  ok: boolean;
  error?: string;
  reservation?: ReservationView;
}

interface MineBody {
  ok: boolean;
  error?: string;
  reservations?: ReservationView[];
}

const HOURS = {
  configured: true,
  days: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
      d,
      { closed: false, slots: [{ open: "09:00", close: "23:00" }] },
    ]),
  ),
};

const VENUE_NAME = "Reservation Test House";
const TIMEZONE = "Europe/Berlin";

describe("guest reservations", () => {
  let tenantId: string;
  let userId: string;
  let slot: { date: string; time: string };
  const originalSlug = process.env.RESTAURANT_SLUG;
  let slug: string;
  // Per-run IP for the READ routes so their Redis buckets are never
  // shared with an earlier run of this suite.
  const readIp = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `res-api-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Reservation API Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    slug = `res-api-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    await asTenant(tenantId, async (tx) => {
      const v = await tx.venue.create({
        data: {
          tenantId,
          name: VENUE_NAME,
          slug,
          timezone: TIMEZONE,
          currency: "EUR",
          hours: HOURS,
        },
        select: { id: true },
      });
      return v.id;
    });

    // Ask the same slot generator the endpoint validates against, so the
    // fixture can never drift out of the venue's opening hours (or fail
    // at midnight, when "today" has no slots left).
    const now = new Date();
    const dates = reservableDates({ configured: true, days: HOURS.days }, TIMEZONE, now);
    const day = dates[1] ?? dates[0];
    if (!day) throw new Error("no reservable date in the fixture hours");
    const times = slotTimesForDate({ configured: true, days: HOURS.days }, TIMEZONE, day.date, now);
    const time = times[Math.floor(times.length / 2)];
    if (!time) throw new Error("no reservable slot in the fixture hours");
    slot = { date: day.date, time };
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.reservation.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function signIn(): Promise<{ customerId: string; token: string }> {
    const s = await signInCustomer(tenantId, "dev", {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `guest-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Guest",
    });
    return { customerId: s.customerId, token: s.token };
  }

  /** One reservation. Fresh IP per call: the create limiter is 5/hour. */
  async function create(
    customerToken?: string,
    overrides: Partial<{ name: string; guests: number; note: string }> = {},
  ): Promise<CreateBody> {
    const ip = `10.6.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const res = await POST(
      new NextRequest("http://localhost:3000/api/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
          ...(customerToken ? { "x-customer-token": customerToken } : {}),
        },
        body: JSON.stringify({
          slug,
          name: overrides.name ?? "Priya",
          phone: "+49 170 1234567",
          guests: overrides.guests ?? 4,
          date: slot.date,
          time: slot.time,
          ...(overrides.note ? { note: overrides.note } : {}),
        }),
      }),
    );
    expect(res.status).toBe(201);
    return (await res.json()) as CreateBody;
  }

  function statusRequest(id: string, token: string): NextRequest {
    return new NextRequest(
      `http://localhost:3000/api/v1/reservations/${id}?token=${encodeURIComponent(token)}`,
      { headers: { "x-forwarded-for": readIp } },
    );
  }

  const statusParams = (id: string): { params: Promise<{ id: string }> } => ({
    params: Promise.resolve({ id }),
  });

  it("publishes exactly the four statuses the column can hold", () => {
    // The mobile app branches on these strings. Asserted against the
    // generated Prisma enum so adding a fifth value to the schema
    // without telling the clients fails here, not in the app store.
    expect([...RESERVATION_STATUSES]).toEqual(Object.values(ReservationStatus));
  });

  /** POST an arbitrary date/time, without the 201 assertion `create` makes. */
  async function post(date: string, time: string): Promise<Response> {
    const ip = `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    return POST(
      new NextRequest("http://localhost:3000/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({
          slug,
          name: "Horizon",
          phone: "+49 170 1234567",
          guests: 2,
          date,
          time,
        }),
      }),
    );
  }

  it("accepts the LAST day the picker offers, and refuses the day after", async () => {
    // The date picker is a two-month calendar over the whole
    // `RESERVATION_DAYS_AHEAD` window (P-B). It used to offer 14 days
    // against a 60-day server limit, so the boundary was never exercised;
    // now the last cell the guest can tap IS the limit, and an
    // off-by-one here is a guest tapping an enabled day and being told
    // "that time is unavailable".
    //
    // The clock is pinned, because both sides of this assertion read it:
    // `reservableDates` here, and `new Date()` inside the endpoint. Run
    // for real late in a Berlin evening and today's last slot has already
    // gone, today drops out of the offered list, and the window is 59 —
    // a red CI that says nothing about the boundary. 10:00 venue-local is
    // a morning with slots still ahead, so today counts and the endpoint
    // agrees with the picker on which day is last.
    //
    // Only Date is faked: the suite talks to real Postgres and Redis, and
    // stubbing setTimeout would hang their drivers.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-21T10:00:00+02:00"));
      const now = new Date();
      const hours = { configured: true, days: HOURS.days };
      const offered = reservableDates(hours, TIMEZONE, now);
      const last = offered.at(-1);
      if (!last) throw new Error("no reservable date in the fixture hours");
      // These fixture hours open every day and the pinned "now" is a
      // morning, so today counts and the window is offered whole.
      expect(offered).toHaveLength(RESERVATION_DAYS_AHEAD);
      expect(offered[0]?.date).toBe("2026-09-21");
      expect(last.date).toBe("2026-11-19");

      const lastTimes = slotTimesForDate(hours, TIMEZONE, last.date, now);
      const lastTime = lastTimes[0];
      if (!lastTime) throw new Error("no slot on the last offered date");
      expect((await post(last.date, lastTime)).status).toBe(201);

      // One day further is a day the calendar draws disabled — and a forged
      // POST for it is refused.
      const beyond = new Date(`${last.date}T12:00:00Z`);
      beyond.setUTCDate(beyond.getUTCDate() + 1);
      const beyondISO = beyond.toISOString().slice(0, 10);
      expect(offered.map((d) => d.date)).not.toContain(beyondISO);
      const res = await post(beyondISO, lastTime);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error?: string }).error).toBe("invalid_time");
    } finally {
      vi.useRealTimers();
    }
  });

  it("links a reservation to the signed-in guest and returns a verifiable token", async () => {
    const me = await signIn();
    const body = await create(me.token, { note: "Window table please" });

    // The pre-existing keys must survive — the menu dialog reads them.
    expect(body.reservationId).toBeTypeOf("string");
    expect(body.date).toBe(slot.date);
    expect(body.time).toBe(slot.time);
    // …plus the three the app needs.
    expect(body.id).toBe(body.reservationId);
    expect(body.status).toBe("requested");
    expect(verifyReservationToken(body.token)).toEqual({
      reservationId: body.id,
      tenantId,
    });

    const row = await asTenant(tenantId, (tx) =>
      tx.reservation.findFirst({ where: { id: body.id }, select: { customerId: true } }),
    );
    expect(row?.customerId).toBe(me.customerId);
  });

  it("keeps an anonymous reservation anonymous", async () => {
    const body = await create();
    const row = await asTenant(tenantId, (tx) =>
      tx.reservation.findFirst({ where: { id: body.id }, select: { customerId: true } }),
    );
    expect(row?.customerId).toBeNull();
  });

  it("ignores a customer token minted for another restaurant", async () => {
    const other = await signupUser({
      email: `res-other-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Another Tenant",
    });
    if (!other.ok) throw new Error("signup failed");
    const foreign = await signInCustomer(other.tenantId, "dev", {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `foreign-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Foreign",
    });

    const body = await create(foreign.token);
    const row = await asTenant(tenantId, (tx) =>
      tx.reservation.findFirst({ where: { id: body.id }, select: { customerId: true } }),
    );
    expect(row?.customerId).toBeNull();

    await asTenant(other.tenantId, (tx) => tx.customerToken.deleteMany({}));
    await asTenant(other.tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(other.tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(other.tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: other.userId } });
  });

  it("answers the full status contract for a token holder, and follows the dashboard", async () => {
    const body = await create(undefined, { name: "Amrit", guests: 2, note: "High chair" });

    const res = await GET_STATUS(statusRequest(body.id, body.token), statusParams(body.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    // The Expo web surface has to be able to READ the answer.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const json = (await res.json()) as StatusBody;
    expect(json.ok).toBe(true);
    expect(json.reservation).toEqual({
      id: body.id,
      date: slot.date,
      time: slot.time,
      guests: 2,
      name: "Amrit",
      status: "requested",
      note: "High chair",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      // No phone column on Venue yet — null, never invented.
      venue: { name: VENUE_NAME, phone: null },
    });
    expect(new Date(json.reservation!.createdAt).getTime()).toBeLessThanOrEqual(Date.now());

    // What the owner records in the console is exactly what the guest reads.
    expect(await setReservationStatus(userId, body.id, "confirmed")).toEqual({ ok: true });
    const after = (await (
      await GET_STATUS(statusRequest(body.id, body.token), statusParams(body.id))
    ).json()) as StatusBody;
    expect(after.reservation?.status).toBe("confirmed");
    expect(after.reservation?.updatedAt).not.toBe(json.reservation?.updatedAt);

    // Both outcomes the dashboard offers must be reachable.
    expect(await setReservationStatus(userId, body.id, "declined")).toEqual({ ok: true });
    expect(await setReservationStatus(userId, body.id, "seated")).toEqual({ ok: false });
  });

  it("403s a forged token, and a valid token for a different reservation", async () => {
    const mine = await create();
    const other = await create();

    const forged = await GET_STATUS(
      statusRequest(mine.id, "not-a-token.not-a-signature"),
      statusParams(mine.id),
    );
    expect(forged.status).toBe(403);
    expect(await forged.json()).toEqual({ ok: false, error: "invalid_token" });

    // A real, unexpired token — for someone else's table.
    const swapped = await GET_STATUS(statusRequest(mine.id, other.token), statusParams(mine.id));
    expect(swapped.status).toBe(403);
    expect(await swapped.json()).toEqual({ ok: false, error: "invalid_token" });
  });

  it("404s a well-signed token for a reservation that isn't there", async () => {
    const ghost = `res_${randomUUID().replace(/-/g, "")}`;
    const token = signReservationToken(ghost, tenantId);
    const res = await GET_STATUS(statusRequest(ghost, token), statusParams(ghost));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
  });

  it("lists the signed-in guest's own reservations, newest first", async () => {
    const me = await signIn();
    const first = await create(me.token, { name: "Simran", guests: 2 });
    const second = await create(me.token, { name: "Simran", guests: 6 });
    // Someone else's table must never appear in this list.
    const stranger = await signIn();
    await create(stranger.token, { name: "Stranger" });

    const res = await GET_MINE(
      new NextRequest("http://localhost:3000/api/v1/me/reservations", {
        headers: { "x-customer-token": me.token, "x-forwarded-for": readIp },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const json = (await res.json()) as MineBody;
    expect(json.ok).toBe(true);
    expect(json.reservations?.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(json.reservations?.[0]).toMatchObject({
      guests: 6,
      name: "Simran",
      status: "requested",
      venue: { name: VENUE_NAME, phone: null },
    });
  });

  it("401s the guest's list without a valid customer token", async () => {
    const res = await GET_MINE(
      new NextRequest("http://localhost:3000/api/v1/me/reservations", {
        headers: { "x-customer-token": "bogus-token-bogus-token-bogus", "x-forwarded-for": readIp },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
