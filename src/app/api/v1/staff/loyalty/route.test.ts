import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { signSession } from "@/lib/session";
import type { StaffLoyaltyOverview } from "@/lib/staff-loyalty-service";
import { asTenant } from "@/lib/tenant";
import { GET, OPTIONS, PATCH } from "./route";

/**
 * The loyalty switch inside the restaurant app.
 *
 * The thing under test is the MERGE: the app sends `{ enabled: false }` and
 * nothing else, and the numbers the owner configured in the dashboard have to
 * survive that round trip. `loyaltyConfigSchema` defaults every missing field,
 * so a patch written as a plain overwrite would quietly reset a venue's
 * reward value to 20 € the first time someone turned the programme off — the
 * stored row is asserted directly, not just the response body.
 */

type LoyaltyBody = { ok: boolean; error?: string; field?: string } & Partial<StaffLoyaltyOverview>;

describe("/api/v1/staff/loyalty", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  let guestToken: string;
  let venueId: string;

  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const signup = await signupUser({
      email: `loyalty-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Loyalty Test",
    });
    if (!signup.ok) throw new Error("signup failed");
    tenantId = signup.tenantId;
    userId = signup.userId;
    staffToken = signSession(userId);

    const slug = `loyalty-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venueId = await asTenant(tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId,
          name: "Loyalty Venue",
          slug,
          currency: "EUR",
          timezone: "Europe/Berlin",
          // Deliberately NOT the defaults: every one of these has to still be
          // here after a one-field patch.
          loyalty: {
            enabled: true,
            minOrderCents: 1500,
            pointsPerOrder: 7,
            rewardPoints: 70,
            rewardValueCents: 1200,
            voucherExpiryMonths: 3,
          },
        },
        select: { id: true },
      });
      return venue.id;
    });

    const guest = await registerCustomerWithPassword(
      tenantId,
      `guest-${randomUUID()}@ex.com`,
      "GuestP4ssPhrase!",
      "Simran",
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
    return new NextRequest("http://localhost:3000/api/v1/staff/loyalty", {
      method: body === undefined ? "GET" : "PATCH",
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function patch(body: unknown, token = staffToken) {
    const res = await PATCH(request(token, body));
    return { status: res.status, body: (await res.json()) as LoyaltyBody };
  }

  /** The config exactly as it sits in `venues.loyalty`. */
  async function stored(): Promise<Record<string, unknown>> {
    const venue = await asTenant(tenantId, (tx) =>
      tx.venue.findFirstOrThrow({ where: { id: venueId }, select: { loyalty: true } }),
    );
    return venue.loyalty as Record<string, unknown>;
  }

  it("reports the programme's own switches alongside the overview", async () => {
    const res = await GET(request(staffToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = (await res.json()) as LoyaltyBody;
    expect(body.enabled).toBe(true);
    expect(body.config).toEqual({
      enabled: true,
      minOrderCents: 1500,
      pointsPerOrder: 7,
      rewardPoints: 70,
      rewardValueCents: 1200,
      voucherExpiryMonths: 3,
    });
    expect(body.totals).toEqual({
      members: 0,
      pointsOutstanding: 0,
      vouchersAvailable: 0,
      vouchersRedeemed30d: 0,
    });
    expect(body.members).toEqual([]);
  });

  it("switches the programme off without touching the numbers, and back on", async () => {
    const off = await patch({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    expect(off.body.config).toEqual({
      enabled: false,
      minOrderCents: 1500,
      pointsPerOrder: 7,
      rewardPoints: 70,
      rewardValueCents: 1200,
      voucherExpiryMonths: 3,
    });
    // The answer is the whole tab, not just the switch.
    expect(off.body.totals).toBeDefined();
    expect(off.body.members).toEqual([]);

    // Persisted, with everything the app never sent still in the row.
    expect(await stored()).toMatchObject({
      enabled: false,
      minOrderCents: 1500,
      pointsPerOrder: 7,
      rewardPoints: 70,
      rewardValueCents: 1200,
      voucherExpiryMonths: 3,
    });

    // A fresh read agrees — nothing was cached from before the write.
    const reread = (await (await GET(request(staffToken))).json()) as LoyaltyBody;
    expect(reread.enabled).toBe(false);
    expect(reread.config?.enabled).toBe(false);

    const on = await patch({ enabled: true });
    expect(on.body.config?.enabled).toBe(true);
    expect((await stored()).enabled).toBe(true);
  });

  it("adjusts the basic numbers and leaves the rest alone", async () => {
    const res = await patch({ pointsPerOrder: 9, rewardValueCents: 2500 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({
      enabled: true,
      minOrderCents: 1500,
      pointsPerOrder: 9,
      rewardPoints: 70,
      rewardValueCents: 2500,
      voucherExpiryMonths: 3,
    });
    expect(await stored()).toMatchObject({ pointsPerOrder: 9, rewardValueCents: 2500 });
  });

  it("refuses a value the owner cannot have meant, and names the field", async () => {
    const negative = await patch({ pointsPerOrder: -5 });
    expect(negative.status).toBe(400);
    expect(negative.body).toEqual({ ok: false, error: "invalid", field: "pointsPerOrder" });

    const notABoolean = await patch({ enabled: "yes" });
    expect(notABoolean.status).toBe(400);
    expect(notABoolean.body).toEqual({ ok: false, error: "invalid", field: "enabled" });

    const fractional = await patch({ rewardPoints: 12.5 });
    expect(fractional.status).toBe(400);
    expect(fractional.body.field).toBe("rewardPoints");

    // …and nothing landed. The schema would have `.catch()`ed each of these
    // into a default, which is exactly the silent rewrite we refuse.
    expect(await stored()).toMatchObject({ pointsPerOrder: 9, rewardPoints: 70, enabled: true });
  });

  it("refuses a guest token and a missing one on both verbs", async () => {
    const calls: [string, Promise<Response>][] = [
      ["GET anonymous", GET(request())],
      ["GET guest", GET(request(guestToken))],
      ["PATCH anonymous", PATCH(request(undefined, { enabled: false }))],
      ["PATCH guest", PATCH(request(guestToken, { enabled: false }))],
    ];
    for (const [name, call] of calls) {
      const res = await call;
      expect(res.status, name).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    // The guest never got near the row.
    expect((await stored()).enabled).toBe(true);
  });

  it("answers the CORS preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
