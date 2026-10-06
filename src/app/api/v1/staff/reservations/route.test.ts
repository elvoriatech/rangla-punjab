import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { signSession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { GET as SUMMARY } from "../summary/route";
import { POST as SET_STATUS } from "./[id]/route";
import { GET } from "./route";

/**
 * The restaurant app's reservations endpoints, asserted at the wire level:
 * the app codes against these exact keys, and the summary's
 * `pendingReservations` is the badge on the owner menu.
 */

interface Row {
  id: string;
  name: string;
  phone: string;
  guests: number;
  at: string;
  date: string;
  time: string;
  note: string | null;
  status: string;
}
interface Body {
  ok: boolean;
  error?: string;
  status?: string;
  reservations?: Row[];
  pendingReservations?: number;
}

describe("/api/v1/staff/reservations", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  const ids: { soon: string; later: string; stale: string } = { soon: "", later: "", stale: "" };
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.13.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `res-staff-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Reservations Staff Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `res-staff-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    await asTenant(tenantId, async (tx) => {
      const v = await tx.venue.create({
        data: { tenantId, name: "Booking Venue", slug, currency: "EUR" },
        select: { id: true },
      });
      const row = (name: string, hoursFromNow: number, time: string) => ({
        tenantId,
        venueId: v.id,
        name,
        phone: "+4975311234",
        guests: 4,
        at: new Date(Date.now() + hoursFromNow * 3_600_000),
        date: "2026-10-10",
        time,
        note: name === "Amrit" ? "Window seat" : null,
      });
      ids.soon = (await tx.reservation.create({ data: row("Amrit", 2, "19:00") })).id;
      ids.later = (await tx.reservation.create({ data: row("Bea", 26, "20:30") })).id;
      // Long past and never answered: neither listed nor counted.
      ids.stale = (await tx.reservation.create({ data: row("Old", -48, "12:00") })).id;
    });
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, async (tx) => {
      await tx.reservation.deleteMany({});
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(url: string, token?: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${url}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("401s without a staff token", async () => {
    const res = await GET(request("/api/v1/staff/reservations"));
    expect(res.status).toBe(401);
    const set = await SET_STATUS(
      request(`/api/v1/staff/reservations/${ids.soon}`, undefined, { status: "confirmed" }),
      params(ids.soon),
    );
    expect(set.status).toBe(401);
  });

  it("lists upcoming reservations soonest first, without the stale one", async () => {
    const res = await GET(request("/api/v1/staff/reservations", staffToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as Body;
    expect(body.reservations?.map((r) => r.id)).toEqual([ids.soon, ids.later]);
    expect(body.reservations?.[0]).toMatchObject({
      name: "Amrit",
      phone: "+4975311234",
      guests: 4,
      date: "2026-10-10",
      time: "19:00",
      note: "Window seat",
      status: "requested",
    });
  });

  it("counts only upcoming requests on the summary badge", async () => {
    const res = await SUMMARY(request("/api/v1/staff/summary", staffToken));
    const body = (await res.json()) as Body;
    expect(body.pendingReservations).toBe(2);
  });

  it("confirms and declines, and the badge follows", async () => {
    const ok = await SET_STATUS(
      request(`/api/v1/staff/reservations/${ids.soon}`, staffToken, { status: "confirmed" }),
      params(ids.soon),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Body).status).toBe("confirmed");
    const no = await SET_STATUS(
      request(`/api/v1/staff/reservations/${ids.later}`, staffToken, { status: "declined" }),
      params(ids.later),
    );
    expect(no.status).toBe(200);

    const list = (await (
      await GET(request("/api/v1/staff/reservations", staffToken))
    ).json()) as Body;
    expect(list.reservations?.map((r) => r.status)).toEqual(["confirmed", "declined"]);
    const summary = (await (
      await SUMMARY(request("/api/v1/staff/summary", staffToken))
    ).json()) as Body;
    expect(summary.pendingReservations).toBe(0);
  });

  it("400s on a status the restaurant cannot set, 404s on an unknown id", async () => {
    const bad = await SET_STATUS(
      request(`/api/v1/staff/reservations/${ids.soon}`, staffToken, { status: "requested" }),
      params(ids.soon),
    );
    expect(bad.status).toBe(400);
    const missing = randomUUID();
    const gone = await SET_STATUS(
      request(`/api/v1/staff/reservations/${missing}`, staffToken, { status: "confirmed" }),
      params(missing),
    );
    expect(gone.status).toBe(404);
  });
});
