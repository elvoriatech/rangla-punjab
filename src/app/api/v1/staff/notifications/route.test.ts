import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { sendStaffPush } from "@/lib/push-service";
import { signSession } from "@/lib/session";
import { createStaffMember } from "@/lib/team-service";
import { asTenant } from "@/lib/tenant";
import { GET as LOG } from "../order-log/route";
import { POST as SEEN } from "./seen/route";
import { GET } from "./route";

interface Body {
  ok: boolean;
  unread?: number;
  items?: { kind: string; title: string; unseen: boolean }[];
}

describe("/api/v1/staff/notifications (the app's bell)", () => {
  let tenantId: string;
  let ownerId: string;
  const users: string[] = [];
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.15.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `bell-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Bell Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    ownerId = s.userId;
    users.push(ownerId);
    const slug = `bell-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({ data: { tenantId, name: "Bell", slug, currency: "EUR" } }),
    );
    await sendStaffPush(tenantId, { title: "New order #B-1", body: "x", data: { kind: "order" } });
    await sendStaffPush(tenantId, {
      title: "Table request",
      body: "y",
      data: { kind: "reservation" },
    });
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, async (tx) => {
      await tx.membership.deleteMany({});
    });
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const req = (path: string, token: string, method = "GET"): NextRequest =>
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { "x-staff-token": token, "x-forwarded-for": ip },
    });

  const team = async (permissions: string[]): Promise<string> => {
    const made = await createStaffMember(ownerId, {
      name: "Team",
      email: `bell-team-${randomUUID()}@ex.com`,
      password: "team-pass-123",
      permissions,
    });
    if (!made.ok) throw new Error("team create failed");
    users.push(made.value.userId);
    return signSession(made.value.userId);
  };

  it("counts and lists everything for the owner; opening it resets the count", async () => {
    const owner = signSession(ownerId);
    const first = (await (await GET(req("/api/v1/staff/notifications", owner))).json()) as Body;
    expect(first.unread).toBe(2);
    expect(first.items!.map((i) => i.kind)).toEqual(["reservation", "order"]);
    expect((await SEEN(req("/api/v1/staff/notifications/seen", owner, "POST"))).status).toBe(200);
    const after = (await (await GET(req("/api/v1/staff/notifications", owner))).json()) as Body;
    expect(after.unread).toBe(0);
    expect(after.items).toHaveLength(2);
  });

  it("shows a team login only the kinds its boxes cover", async () => {
    const kitchen = await team(["orders"]);
    const body = (await (await GET(req("/api/v1/staff/notifications", kitchen))).json()) as Body;
    expect(body.items!.map((i) => i.kind)).toEqual(["order"]);
    expect(body.unread).toBe(1);
  });

  it("order history needs the orders box", async () => {
    const tables = await team(["reservations"]);
    expect((await LOG(req("/api/v1/staff/order-log", tables))).status).toBe(403);
    expect((await LOG(req("/api/v1/staff/order-log", signSession(ownerId)))).status).toBe(200);
  });
});
