import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { __fakePush } from "@/lib/push-service";
import { signSession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { DELETE, POST } from "./route";

/**
 * The endpoint the app calls to say "buzz this handset".
 *
 * Two things are worth pinning at the wire level: the credential (a guest
 * token is never a staff token, however valid it is for its own purpose)
 * and the token shape — a malformed Expo token must come back as a 400
 * now, not as a row that silently fails to deliver forever.
 */

const TOKEN = "ExponentPushToken[route-test-aaaaaaaa]";

interface Body {
  ok: boolean;
  error?: string;
}

describe("/api/v1/staff/devices", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  let guestToken: string;
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.13.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `devices-staff-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Devices Staff Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `devices-staff-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: "Devices Venue", slug, currency: "EUR" },
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
    await asTenant(tenantId, async (tx) => {
      await tx.staffDevice.deleteMany({});
      await tx.customerToken.deleteMany({});
      await tx.customer.deleteMany({});
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(method: "POST" | "DELETE", token?: string, body?: unknown): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/staff/devices", {
      method,
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        "content-type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
  }

  it("401s with no token, a guest token, or a forged one", async () => {
    for (const token of [undefined, guestToken, "forged.payload"]) {
      const res = await POST(request("POST", token, { token: TOKEN, platform: "ios" }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");

      const removed = await DELETE(request("DELETE", token, { token: TOKEN }));
      expect(removed.status).toBe(401);
    }
    expect(await asTenant(tenantId, (tx) => tx.staffDevice.count())).toBe(0);
  });

  it("400s a token that is not an Expo push token, and an unknown platform", async () => {
    for (const body of [
      {},
      { token: "fcm:not-an-expo-token", platform: "ios" },
      { token: "ExponentPushToken[]", platform: "ios" },
      { token: TOKEN, platform: "windows" },
      { token: TOKEN, platform: "ios", appVersion: "v".repeat(41) },
    ]) {
      const res = await POST(request("POST", staffToken, body));
      expect(res.status).toBe(400);
      expect((await res.json()) as Body).toEqual({ ok: false, error: "invalid" });
    }
    const removed = await DELETE(request("DELETE", staffToken, { token: "nope" }));
    expect(removed.status).toBe(400);
    expect(await asTenant(tenantId, (tx) => tx.staffDevice.count())).toBe(0);
  });

  it("registers, re-registers idempotently, then unregisters", async () => {
    const res = await POST(
      request("POST", staffToken, { token: TOKEN, platform: "ios", appVersion: "1.2.3" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as Body).toEqual({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const rows = await asTenant(tenantId, (tx) => tx.staffDevice.findMany({}));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      expoPushToken: TOKEN,
      platform: "ios",
      appVersion: "1.2.3",
      disabledAt: null,
    });

    // The app calls this on every sign-in; the second call is an update.
    const again = await POST(
      request("POST", staffToken, { token: TOKEN, platform: "ios", appVersion: "1.3.0" }),
    );
    expect(again.status).toBe(200);
    const after = await asTenant(tenantId, (tx) => tx.staffDevice.findMany({}));
    expect(after).toHaveLength(1);
    expect(after[0]?.appVersion).toBe("1.3.0");

    const removed = await DELETE(request("DELETE", staffToken, { token: TOKEN }));
    expect(removed.status).toBe(200);
    expect((await removed.json()) as Body).toEqual({ ok: true });
    expect(await asTenant(tenantId, (tx) => tx.staffDevice.count())).toBe(0);

    // Forgetting an already-forgotten handset is still `ok: true` — the app
    // retries this on a flaky connection and must not learn to ignore errors.
    const twice = await DELETE(request("DELETE", staffToken, { token: TOKEN }));
    expect(twice.status).toBe(200);
  });

  it("nothing on this route ever reaches a real push transport", () => {
    // Belt and braces for the structural half: with EXPO_PUSH_ENABLED unset
    // the selector must hand out the recorder, in every suite, forever.
    expect(process.env.EXPO_PUSH_ENABLED).toBeUndefined();
    expect(__fakePush().mode).toBe("fake");
  });
});
