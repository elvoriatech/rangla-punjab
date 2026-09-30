import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import { signSession } from "./session";
import { signInRestaurant } from "./staff-auth";
import { asTenant } from "./tenant";
import { createStaffMember } from "./team-service";
import { GET as GET_ORDERS } from "@/app/api/v1/staff/orders/route";
import { GET as GET_CONTACT } from "@/app/api/v1/staff/contact/route";
import { GET as GET_HOURS, PATCH as PATCH_HOURS } from "@/app/api/v1/staff/hours/route";
import { GET as GET_GIFTS } from "@/app/api/v1/staff/gift-cards/route";
import { POST as CHANGE_PASSWORD } from "@/app/api/v1/staff/password/route";

/**
 * Team logins in the APP (owner, 2026-09-30): the app's restaurant login
 * takes a team member too, hands back their ticked boxes, and every
 * `/api/v1/staff/*` route refuses what is not ticked with 403 — while
 * the owner keeps everything.
 */

describe("team logins in the app", () => {
  let tenantId: string;
  let venueId: string;
  let ownerId: string;
  let staffId: string;
  let staffEmail: string;
  const staffPassword = "kitchen-2026!";
  const originalSlug = process.env.RESTAURANT_SLUG;

  // Fresh IP per request: the staff routes share a per-IP limiter.
  const ip = (): string =>
    `10.44.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  function req(path: string, token: string, method = "GET", body?: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: {
        "x-staff-token": token,
        "x-forwarded-for": ip(),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  beforeAll(async () => {
    const s = await signupUser({
      email: `app-team-owner-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "App Team Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    ownerId = s.userId;
    const slug = `app-team-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    venueId = await asTenant(
      tenantId,
      async (tx) =>
        (
          await tx.venue.create({
            data: { tenantId, name: "App Team Venue", slug, currency: "EUR" },
            select: { id: true },
          })
        ).id,
    );
    staffEmail = `app-staff-${randomUUID().slice(0, 8)}@ex.com`;
    const created = await createStaffMember(ownerId, {
      name: "Ali",
      email: staffEmail,
      password: staffPassword,
      permissions: ["orders", "kitchen"],
    });
    if (!created.ok) throw new Error(created.error);
    staffId = created.value.userId;
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
  });

  it("signs a team member in and hands back their boxes", async () => {
    const signedIn = await signInRestaurant({ tenantId, venueId }, staffEmail, staffPassword);
    expect(signedIn).not.toBeNull();
    expect(signedIn?.isOwner).toBe(false);
    expect(signedIn?.permissions).toEqual(["orders", "kitchen"]);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    const asOwner = await signInRestaurant({ tenantId, venueId }, owner.email, "S3cureP4ssPhrase!");
    expect(asOwner?.isOwner).toBe(true);
  });

  it("opens what is ticked and refuses the rest with 403", async () => {
    const token = signSession(staffId);
    expect((await GET_ORDERS(req("/api/v1/staff/orders", token))).status).toBe(200);
    // Open/closed and the week are harmless reads every login needs...
    expect((await GET_HOURS(req("/api/v1/staff/hours", token))).status).toBe(200);
    // ...but changing them is Settings.
    const patch = await PATCH_HOURS(req("/api/v1/staff/hours", token, "PATCH", {}));
    expect(patch.status).toBe(403);
    expect(await patch.json()).toEqual({ ok: false, error: "forbidden" });
    expect((await GET_CONTACT(req("/api/v1/staff/contact", token))).status).toBe(403);
    expect((await GET_GIFTS(req("/api/v1/staff/gift-cards", token))).status).toBe(403);
  });

  it("never lets a team member change the password the owner set", async () => {
    const res = await CHANGE_PASSWORD(
      req("/api/v1/staff/password", signSession(staffId), "POST", {
        currentPassword: staffPassword,
        newPassword: "my-own-secret-99",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("gives the owner everything", async () => {
    const token = signSession(ownerId);
    expect((await GET_CONTACT(req("/api/v1/staff/contact", token))).status).toBe(200);
    expect((await GET_GIFTS(req("/api/v1/staff/gift-cards", token))).status).toBe(200);
  });

  it("a removed membership locks the app out on the next request", async () => {
    const token = signSession(staffId);
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({ where: { userId: staffId } }));
    expect((await GET_ORDERS(req("/api/v1/staff/orders", token))).status).toBe(401);
  });
});
