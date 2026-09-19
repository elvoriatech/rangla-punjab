import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { signupUser } from "@/lib/auth-service";
import { asTenant } from "@/lib/tenant";
import { GET } from "./route";

/**
 * GET /api/v1/pay/wallet-config (P7-13) — the one question the guest cart
 * drawer cannot answer on its own: may this browser show an Apple Pay /
 * Google Pay button, and against which Stripe account?
 *
 * `vitest.setup` strips STRIPE_SECRET_KEY, so every suite runs on the
 * in-memory fake provider — which is exactly the state of a dev machine,
 * CI, and any deployment nobody has pasted keys into. The contract under
 * test is therefore the SAFE one: no key, no wallet, and a body the
 * drawer can read without special-casing anything.
 *
 * The publishable-key-present path needs a real `sk_`/`pk_` pair and is
 * covered by the human-gated smoke, not here.
 */

interface WalletConfig {
  ok: boolean;
  publishableKey: string | null;
  applePay: boolean;
  country: string;
}

const userIds: string[] = [];
const tenantIds: string[] = [];

/** A published, orderable venue — the minimum `resolvePreviewContext`
 *  needs to hand back a `public` context. */
async function publishedVenue(): Promise<string> {
  const s = await signupUser({
    email: `wallet-cfg-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: "Wallet Config",
  });
  if (!s.ok) throw new Error("signup failed");
  userIds.push(s.userId);
  tenantIds.push(s.tenantId);
  const slug = `wallet-cfg-${randomUUID().slice(0, 8)}`;
  await asTenant(s.tenantId, async (tx) => {
    const venue = await tx.venue.create({
      data: { tenantId: s.tenantId, name: "Wallet Venue", slug, currency: "EUR" },
      select: { id: true },
    });
    const menu = await tx.menu.create({
      data: { tenantId: s.tenantId, venueId: venue.id, name: "Main", isDefault: true },
      select: { id: true },
    });
    const version = await tx.menuVersion.create({
      data: { tenantId: s.tenantId, menuId: menu.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });
  });
  return slug;
}

/** An unpublished one — the "no public context" branch. */
async function draftVenue(): Promise<string> {
  const s = await signupUser({
    email: `wallet-draft-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: "Wallet Draft",
  });
  if (!s.ok) throw new Error("signup failed");
  userIds.push(s.userId);
  tenantIds.push(s.tenantId);
  const slug = `wallet-draft-${randomUUID().slice(0, 8)}`;
  await asTenant(s.tenantId, (tx) =>
    tx.venue.create({
      data: { tenantId: s.tenantId, name: "Draft Venue", slug, currency: "EUR" },
      select: { id: true },
    }),
  );
  return slug;
}

/** Single-restaurant build: the route reads the slug from the env the
 *  same way `getRestaurantSlug` does in production. */
async function read(slug: string): Promise<{ status: number; body: WalletConfig }> {
  process.env.RESTAURANT_SLUG = slug;
  const res = await GET();
  return { status: res.status, body: (await res.json()) as WalletConfig };
}

afterAll(async () => {
  delete process.env.RESTAURANT_SLUG;
  for (const tid of tenantIds) {
    await asTenant(tid, (tx) => tx.menu.updateMany({ data: { publishedVersion: null } }));
    await asTenant(tid, (tx) => tx.menuVersion.deleteMany({}));
    await asTenant(tid, (tx) => tx.menu.deleteMany({}));
    await asTenant(tid, (tx) => tx.venue.deleteMany({}));
    await asTenant(tid, (tx) => tx.membership.deleteMany({}));
    await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("GET /api/v1/pay/wallet-config", () => {
  it("offers no wallet on the fake Stripe provider", async () => {
    const { status, body } = await read(await publishedVenue());
    expect(status).toBe(200);
    // Null is the whole contract: the drawer renders no wallet button,
    // never loads @stripe/stripe-js, and the guest sees the ordinary
    // payment rows — the same page a venue without Stripe gets.
    expect(body.publishableKey).toBeNull();
    expect(body).toEqual({
      ok: true,
      publishableKey: null,
      applePay: false,
      country: "DE",
    });
  });

  it("keeps Apple Pay off whenever there is no key to pair it with", async () => {
    // ⛔ APPLE_PAY_WEB_ENABLED is a human step (merchant-domain
    // verification) AND it is ANDed with the publishable key, so it can
    // never turn a keyless deployment into one that offers Apple Pay.
    // `env` is parsed once at module load, so the flag itself cannot be
    // flipped mid-suite — this asserts the invariant that survives it.
    const { body } = await read(await publishedVenue());
    expect(body.applePay).toBe(false);
  });

  it("answers the same safe shape for an unpublished venue", async () => {
    // No public context: still a 200 with a readable body, because a
    // drawer that got a 404 here would have to guess.
    const { status, body } = await read(await draftVenue());
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      publishableKey: null,
      applePay: false,
      country: "DE",
    });
  });
});
