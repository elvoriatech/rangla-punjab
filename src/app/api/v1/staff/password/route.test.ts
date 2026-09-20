import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifySessionValue } from "@/lib/auth";
import { loginUser, signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { signSession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { OPTIONS, POST } from "./route";

/**
 * The owner changing their own password from the app, at the wire level.
 *
 * The contract the app codes against, and the two halves of it that are
 * easy to break silently:
 *
 *  - a mistyped CURRENT password must be a 400 with a named reason, never
 *    a 401 — the app treats 401 as "your session died" and signs the
 *    counter's tablet out;
 *  - a success must hand back a WORKING token, because the write it just
 *    did killed the one the request arrived with.
 */

interface Body {
  ok: boolean;
  error?: string;
  minLength?: number;
  token?: string;
}

describe("POST /api/v1/staff/password", () => {
  const FIRST = "S3cureP4ssPhrase!";
  let tenantId: string;
  let userId: string;
  let email: string;
  let staffToken: string;
  let guestToken: string;
  const originalSlug = process.env.RESTAURANT_SLUG;

  /** A fresh IP per request by default: this route's own limiter is 10
   *  per hour, which one test file would otherwise burn through. */
  const someIp = (): string =>
    `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(
      Math.random() * 250,
    )}`;

  beforeAll(async () => {
    email = `pw-staff-${randomUUID()}@ex.com`;
    const s = await signupUser({ email, password: FIRST, tenantName: "Password Staff Test" });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `pw-staff-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: "Password Venue", slug, currency: "EUR" },
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
      await tx.customerToken.deleteMany({});
      await tx.customer.deleteMany({});
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(token: string | undefined, body: unknown, ip = someIp()): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/staff/password", {
      method: "POST",
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        "content-type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
  }

  async function post(body: unknown, token = staffToken): Promise<{ status: number; body: Body }> {
    const res = await POST(request(token, body));
    return { status: res.status, body: (await res.json()) as Body };
  }

  it("401s with no token, a guest token, or a forged one", async () => {
    for (const token of [undefined, guestToken, "forged.payload"]) {
      const res = await POST(
        request(token, { currentPassword: FIRST, newPassword: "x".repeat(14) }),
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("answers the preflight for the app's web surface", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("X-Staff-Token");
  });

  it("400s every refusal BY NAME — and never 401, which would sign the tablet out", async () => {
    const cases: [unknown, string][] = [
      // The one that matters most: a mistyped current password.
      [{ currentPassword: "not-my-password", newPassword: "LongEnoughPhrase1" }, "wrong_password"],
      [
        { currentPassword: FIRST, newPassword: "LongEnoughPhrase1", confirmPassword: "other" },
        "mismatch",
      ],
      [{ currentPassword: FIRST, newPassword: "short" }, "too_short"],
      [{ currentPassword: FIRST, newPassword: FIRST }, "same_as_current"],
      // Broken clients, not password problems.
      [{ currentPassword: FIRST }, "invalid"],
      [{ currentPassword: 1234, newPassword: "LongEnoughPhrase1" }, "invalid"],
      [{ currentPassword: FIRST, newPassword: "LongEnoughPhrase1", confirmPassword: 7 }, "invalid"],
      [[], "invalid"],
    ];
    for (const [input, error] of cases) {
      const res = await post(input);
      expect(res.status, JSON.stringify(input)).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe(error);
      expect(res.body.minLength).toBe(12);
    }
    // Nothing was written: the password the restaurant signs in with is
    // still the one it started with.
    expect((await loginUser(email, FIRST)).ok).toBe(true);
  });

  it("changes the password, keeps THIS device signed in, signs the others out", async () => {
    const otherDevice = signSession(userId);
    expect(await verifySessionValue(otherDevice)).not.toBeNull();
    // The cutoff is compared against a whole-second `iat`, so a token
    // minted in the same second as the change legitimately survives.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const next = "TheNewCounterPhrase!";
    const res = await post({
      currentPassword: FIRST,
      newPassword: next,
      confirmPassword: next,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The new token works …
    const handedBack = res.body.token;
    expect(typeof handedBack).toBe("string");
    expect((await verifySessionValue(handedBack!))?.userId).toBe(userId);
    // … the phone left on the pass does not …
    expect(await verifySessionValue(otherDevice)).toBeNull();
    // … and so does the one this request arrived with.
    expect(await verifySessionValue(staffToken)).toBeNull();
    staffToken = handedBack!;

    // The account really did re-credential.
    expect((await loginUser(email, next)).ok).toBe(true);
    expect((await loginUser(email, FIRST)).ok).toBe(false);

    // The answer is never cached — it carries a credential.
    const again = await POST(request(staffToken, { currentPassword: next, newPassword: FIRST }));
    expect(again.headers.get("Cache-Control")).toBe("private, no-store");
    expect(again.status).toBe(200);
    staffToken = ((await again.json()) as Body).token!;
  });

  it("429s once the per-IP ceiling is spent, without touching the password", async () => {
    const ip = someIp();
    let sawRateLimit = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await POST(
        request(
          staffToken,
          { currentPassword: "wrong-on-purpose", newPassword: "x".repeat(14) },
          ip,
        ),
      );
      if (res.status === 429) {
        expect((await res.json()) as Body).toEqual({ ok: false, error: "rate_limited" });
        expect(res.headers.get("Retry-After")).toBeTruthy();
        sawRateLimit = true;
        break;
      }
      expect(res.status).toBe(400);
    }
    expect(sawRateLimit).toBe(true);
    expect((await loginUser(email, FIRST)).ok).toBe(true);
  });
});
