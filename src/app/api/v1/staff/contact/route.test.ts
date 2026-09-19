import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { signSession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { GET, OPTIONS, PATCH } from "./route";

/**
 * The owner's contact card, at the wire level.
 *
 * The app codes against these exact keys and re-derives none of them, so
 * the assertions worth having are about the CONTRACT: raw E.164 out (this
 * is the editor's read, not the guest projection), a patch that touches
 * only what it carries, an empty box that clears a number, and a refusal
 * that names the box the message belongs under.
 */

interface Body {
  ok: boolean;
  error?: string;
  field?: string;
  contact?: { landline: string | null; mobile: string | null; whatsapp: string | null };
}

describe("/api/v1/staff/contact", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  let guestToken: string;
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.17.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `contact-staff-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Contact Staff Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `contact-staff-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: "Contact Venue", slug, currency: "EUR" },
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

  function request(method: "GET" | "PATCH", token?: string, body?: unknown): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/staff/contact", {
      method,
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  }

  async function card(): Promise<Body["contact"]> {
    const res = await GET(request("GET", staffToken));
    expect(res.status).toBe(200);
    return ((await res.json()) as Body).contact;
  }

  async function patch(input: unknown): Promise<{ status: number; body: Body }> {
    const res = await PATCH(request("PATCH", staffToken, input));
    return { status: res.status, body: (await res.json()) as Body };
  }

  it("401s with no token, a guest token, or a forged one", async () => {
    for (const token of [undefined, guestToken, "forged.payload"]) {
      for (const res of [
        await GET(request("GET", token)),
        await PATCH(request("PATCH", token, { mobile: "0170 1234567" })),
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

  it("reads a fresh card: three empty slots, never cached", async () => {
    const res = await GET(request("GET", staffToken));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(((await res.json()) as Body).contact).toEqual({
      landline: null,
      mobile: null,
      whatsapp: null,
    });
  });

  it("saves the three numbers in E.164, whatever spelling arrives", async () => {
    const saved = await patch({
      landline: "07531 123456",
      mobile: "+49 170 / 1234567",
      whatsapp: "0049 170 1234567",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.contact).toEqual({
      landline: "+497531123456",
      mobile: "+491701234567",
      whatsapp: "+491701234567",
    });
    // The read is the editor's read: raw numbers, no display string and no
    // href — the app posts these values straight back.
    expect(await card()).toEqual(saved.body.contact);
  });

  it("patches one slot at a time and clears with null or an empty string", async () => {
    await patch({ landline: "07531 123456", mobile: "0170 1234567", whatsapp: "0170 1234567" });

    const one = await patch({ mobile: "0170 7654321" });
    expect(one.body.contact).toEqual({
      landline: "+497531123456",
      mobile: "+491707654321",
      whatsapp: "+491701234567",
    });

    expect((await patch({ whatsapp: null })).body.contact?.whatsapp).toBeNull();
    expect((await patch({ landline: "" })).body.contact?.landline).toBeNull();
    // The slot nobody touched is exactly where the owner left it.
    expect((await card())?.mobile).toBe("+491707654321");
  });

  it("400s the bad number by name and writes nothing", async () => {
    await patch({ landline: "07531 123456", mobile: null, whatsapp: null });
    const before = await card();

    const cases: [unknown, string][] = [
      [{ mobile: "ring the bell" }, "mobile"],
      [{ landline: "0 12" }, "landline"],
      [{ whatsapp: "+49 (0)7531 ABC" }, "whatsapp"],
      // A JSON number loses the leading zero and the plus — the two
      // characters that decide what a phone number means.
      [{ mobile: 1701234567 }, "mobile"],
      [{ whatsapp: { number: "+491701234567" } }, "whatsapp"],
      // Validation runs over the whole patch before any of it is written.
      [{ landline: "0170 1234567", whatsapp: "nope" }, "whatsapp"],
    ];
    for (const [input, field] of cases) {
      const res = await patch(input);
      expect(res.status, JSON.stringify(input)).toBe(400);
      expect(res.body).toEqual({ ok: false, error: "invalid", field });
    }
    expect(await card()).toEqual(before);
  });

  it("400s a patch with nothing in it — there is no no-op verb here", async () => {
    for (const input of [{}, { unknownKey: "x" }, [], "mobile"]) {
      const res = await patch(input);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: "invalid" });
    }
  });
});
