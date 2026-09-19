import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { publishDraft } from "@/lib/menu-versions-service";
import { signSession } from "@/lib/session";
import type { StaffCategory, StaffItem, StaffOrdering } from "@/lib/staff-menu-service";
import type { StaffLoyaltyOverview } from "@/lib/staff-loyalty-service";
import { asTenant } from "@/lib/tenant";
import { GET as PUBLIC_MENU } from "../../menu/route";
import { PATCH as PATCH_ITEM } from "../items/[id]/route";
import { GET as GET_LOYALTY } from "../loyalty/route";
import { GET as GET_ORDERING, PATCH as PATCH_ORDERING } from "../ordering/route";
import { GET } from "./route";

/**
 * The restaurant's menu controls inside the guest app.
 *
 * The thing under test is the LIVE-edit promise: the owner taps "sold out"
 * and the guest menu changes before the next table orders, with no publish.
 * That only works if `publishDraft` links every published copy back to its
 * draft row and the patch walks that link in both directions — so these
 * tests assert the pair, not just the row the request named, and read the
 * PUBLIC endpoint afterwards to prove guests actually see it.
 */

interface MenuBody {
  ok: boolean;
  error?: string;
  field?: string;
  categories?: StaffCategory[];
  item?: StaffItem;
  mirrored?: boolean;
  ordering?: StaffOrdering;
}

type LoyaltyBody = { ok: boolean } & Partial<StaffLoyaltyOverview>;

interface PublicMenuBody {
  categories: { items: { id: string; isAvailable: boolean; priceCents: number }[] }[];
}

describe("/api/v1/staff/{menu,items,ordering,loyalty}", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  let venueId: string;
  let menuId: string;
  /** Draft item id → its published twin, as `publishDraft` linked them. */
  let draftDalId: string;
  let draftNaanId: string;
  let publishedDalId: string;
  let publishedNaanId: string;

  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const signup = await signupUser({
      email: `menu-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Menu Test",
    });
    if (!signup.ok) throw new Error("signup failed");
    tenantId = signup.tenantId;
    userId = signup.userId;
    staffToken = signSession(userId);

    const slug = `menu-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    const seeded = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const venue = await tx.venue.create({
        data: {
          tenantId,
          name: "Menu Venue",
          slug,
          currency: "EUR",
          timezone: "Europe/Berlin",
          // Seeded with settings the app never sends, so the ordering patch
          // has something to prove it does not erase.
          ordering: {
            dineIn: true,
            takeaway: true,
            delivery: true,
            reservations: false,
            deliveryAreas: [{ zip: "44135", locality: "Dortmund", feeCents: 250, minCents: 1500 }],
            notifyEmails: ["kueche@ex.de"],
            acceptedPayments: ["cash", "paypal"],
          },
          loyalty: { enabled: true, pointsPerOrder: 5, rewardPoints: 20, rewardValueCents: 2000 },
        },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId, venueId: venue.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      // A DRAFT — the dashboard's working copy. Publishing it is what mints
      // the published twins this suite then edits.
      const draft = await tx.menuVersion.create({
        data: { tenantId, menuId: menu.id, status: "draft" },
        select: { id: true },
      });
      const category = await tx.category.create({
        data: { tenantId, menuVersionId: draft.id, name: "Mains", orderIndex: 100 },
        select: { id: true },
      });
      const dal = await tx.item.create({
        data: {
          tenantId,
          categoryId: category.id,
          name: "Dal Makhani",
          description: "Slow-cooked black lentils",
          priceCents: 1200,
          orderIndex: 100,
        },
        select: { id: true },
      });
      const naan = await tx.item.create({
        data: {
          tenantId,
          categoryId: category.id,
          name: "Garlic Naan",
          priceCents: 350,
          orderIndex: 200,
        },
        select: { id: true },
      });
      return { venueId: venue.id, menuId: menu.id, dalId: dal.id, naanId: naan.id };
    });
    venueId = seeded.venueId;
    menuId = seeded.menuId;
    draftDalId = seeded.dalId;
    draftNaanId = seeded.naanId;

    const published = await publishDraft(userId);
    if (!published.ok) throw new Error(`publish failed: ${published.error}`);

    const twins = await asTenant(tenantId, (tx) =>
      tx.item.findMany({
        where: { category: { menuVersionId: published.publishedVersionId } },
        select: { id: true, sourceItemId: true },
      }),
    );
    publishedDalId = twins.find((t) => t.sourceItemId === draftDalId)!.id;
    publishedNaanId = twins.find((t) => t.sourceItemId === draftNaanId)!.id;
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.loyaltyLedger.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.loyaltyVoucher.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.order.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(url: string, token?: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${url}`, {
      method: body === undefined ? "GET" : "PATCH",
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function patchItem(id: string, body: unknown): Promise<{ status: number; body: MenuBody }> {
    const res = await PATCH_ITEM(request(`/api/v1/staff/items/${id}`, staffToken, body), {
      params: Promise.resolve({ id }),
    });
    return { status: res.status, body: (await res.json()) as MenuBody };
  }

  /** The published pair, straight from the rows — what guests will read. */
  async function rows(...ids: string[]) {
    return asTenant(tenantId, (tx) =>
      tx.item.findMany({
        where: { id: { in: ids } },
        select: { id: true, isAvailable: true, priceCents: true, offerPriceCents: true },
      }),
    );
  }

  async function publicItem(id: string): Promise<{ isAvailable: boolean; priceCents: number }> {
    const res = await PUBLIC_MENU(new NextRequest("http://localhost:3000/api/v1/menu"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicMenuBody;
    const item = body.categories.flatMap((c) => c.items).find((i) => i.id === id);
    expect(item).toBeDefined();
    return item!;
  }

  it("401s every new route without a staff token", async () => {
    const calls: [string, Promise<Response>][] = [
      ["menu", GET(request("/api/v1/staff/menu"))],
      [
        "items",
        PATCH_ITEM(
          request(`/api/v1/staff/items/${publishedDalId}`, undefined, { isAvailable: false }),
          {
            params: Promise.resolve({ id: publishedDalId }),
          },
        ),
      ],
      ["ordering GET", GET_ORDERING(request("/api/v1/staff/ordering"))],
      [
        "ordering PATCH",
        PATCH_ORDERING(request("/api/v1/staff/ordering", undefined, { takeaway: false })),
      ],
      ["loyalty", GET_LOYALTY(request("/api/v1/staff/loyalty"))],
    ];
    for (const [name, call] of calls) {
      const res = await call;
      expect(res.status, name).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("publishing links every published copy back to its draft row", async () => {
    const drafts = await asTenant(tenantId, (tx) =>
      tx.item.findMany({
        where: { id: { in: [draftDalId, draftNaanId] } },
        select: { id: true, sourceItemId: true },
      }),
    );
    // Draft rows are the anchor and carry no link of their own.
    expect(drafts.every((d) => d.sourceItemId === null)).toBe(true);
    expect(publishedDalId).not.toBe(draftDalId);
    expect(publishedNaanId).not.toBe(draftNaanId);
  });

  it("lists the published menu with raw offer fields and absolute photo URLs", async () => {
    const res = await GET(request("/api/v1/staff/menu", staffToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const categories = ((await res.json()) as MenuBody).categories!;
    expect(categories.map((c) => c.name)).toEqual(["Mains"]);
    const dal = categories[0]!.items.find((i) => i.id === publishedDalId)!;
    expect(dal).toMatchObject({
      name: "Dal Makhani",
      description: "Slow-cooked black lentils",
      priceCents: 1200,
      currency: "EUR",
      isAvailable: true,
      offer: null,
      offerActive: false,
      sourceItemId: draftDalId,
    });
    expect(dal.photoUrl.startsWith("http")).toBe(true);
  });

  it("flips availability on BOTH rows when patched by the published id, live for guests", async () => {
    const { status, body } = await patchItem(publishedDalId, { isAvailable: false });
    expect(status).toBe(200);
    expect(body.mirrored).toBe(true);
    expect(body.item).toMatchObject({ id: publishedDalId, isAvailable: false });

    const pair = await rows(publishedDalId, draftDalId);
    expect(pair.every((r) => r.isAvailable === false)).toBe(true);

    // No publish happened in between — the guest endpoint already says so.
    expect((await publicItem(publishedDalId)).isAvailable).toBe(false);

    // And back on, so later assertions start from a known state.
    const back = await patchItem(publishedDalId, { isAvailable: true });
    expect(back.body.mirrored).toBe(true);
    expect((await rows(draftDalId))[0]!.isAvailable).toBe(true);
  });

  it("accepts the DRAFT id too, and writes the published twin", async () => {
    const { status, body } = await patchItem(draftNaanId, { priceCents: 420 });
    expect(status).toBe(200);
    expect(body.mirrored).toBe(true);
    expect(body.item).toMatchObject({ id: draftNaanId, priceCents: 420 });

    const pair = await rows(draftNaanId, publishedNaanId);
    expect(pair.map((r) => r.priceCents)).toEqual([420, 420]);
    expect((await publicItem(publishedNaanId)).priceCents).toBe(420);
  });

  it("refuses an offer that is not a reduction, and reports the field", async () => {
    const tooHigh = await patchItem(publishedDalId, { offer: { priceCents: 1200 } });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body).toEqual({ ok: false, error: "invalid", field: "offer.priceCents" });

    const negative = await patchItem(publishedDalId, { priceCents: 0 });
    expect(negative.status).toBe(400);
    expect(negative.body.field).toBe("priceCents");

    const unknownItem = await patchItem("no-such-item", { isAvailable: false });
    expect(unknownItem.status).toBe(404);
    expect(unknownItem.body).toEqual({ ok: false, error: "not_found" });
  });

  it("puts a dish on offer for a window covering now, then clears it", async () => {
    const startsAt = new Date(Date.now() - 3_600_000).toISOString();
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    const on = await patchItem(publishedDalId, {
      offer: { priceCents: 900, startsAt, endsAt },
    });
    expect(on.status).toBe(200);
    expect(on.body.mirrored).toBe(true);
    expect(on.body.item?.offer).toMatchObject({ priceCents: 900, weekly: null });
    expect(on.body.item?.offerActive).toBe(true);

    const pair = await rows(publishedDalId, draftDalId);
    expect(pair.every((r) => r.offerPriceCents === 900)).toBe(true);
    // The guest endpoint prices from the same module, so the offer is live.
    expect((await publicItem(publishedDalId)).priceCents).toBe(900);

    const off = await patchItem(publishedDalId, { offer: null });
    expect(off.status).toBe(200);
    expect(off.body.item?.offer).toBeNull();
    expect(off.body.item?.offerActive).toBe(false);
    expect((await rows(draftDalId))[0]!.offerPriceCents).toBeNull();
    expect((await publicItem(publishedDalId)).priceCents).toBe(1200);
  });

  it("reports mirrored:false when a published row has no twin to write", async () => {
    const orphanId = await asTenant(tenantId, async (tx) => {
      const menu = await tx.menu.findFirstOrThrow({
        where: { id: menuId },
        select: { publishedVersion: true },
      });
      const category = await tx.category.findFirstOrThrow({
        where: { menuVersionId: menu.publishedVersion! },
        select: { id: true },
      });
      const orphan = await tx.item.create({
        data: {
          tenantId,
          categoryId: category.id,
          name: "Orphan",
          priceCents: 500,
          orderIndex: 900,
        },
        select: { id: true },
      });
      return orphan.id;
    });

    const { status, body } = await patchItem(orphanId, { isAvailable: false });
    expect(status).toBe(200);
    expect(body.mirrored).toBe(false);
    expect(body.item).toMatchObject({ isAvailable: false, sourceItemId: null });
  });

  it("toggles takeaway/delivery without dropping the rest of the ordering config", async () => {
    const before = await GET_ORDERING(request("/api/v1/staff/ordering", staffToken));
    expect(before.status).toBe(200);
    expect(((await before.json()) as MenuBody).ordering).toEqual({
      dineIn: true,
      takeaway: true,
      delivery: true,
    });

    const res = await PATCH_ORDERING(
      request("/api/v1/staff/ordering", staffToken, { delivery: false }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as MenuBody).ordering).toEqual({
      dineIn: true,
      takeaway: true,
      delivery: false,
    });

    const stored = await asTenant(tenantId, (tx) =>
      tx.venue.findFirstOrThrow({ where: { id: venueId }, select: { ordering: true } }),
    );
    const ordering = stored.ordering as Record<string, unknown>;
    expect(ordering.delivery).toBe(false);
    expect(ordering.takeaway).toBe(true);
    // Everything the app never sent survived the write.
    expect(ordering.reservations).toBe(false);
    expect(ordering.notifyEmails).toEqual(["kueche@ex.de"]);
    expect(ordering.acceptedPayments).toEqual(["cash", "paypal"]);
    expect(ordering.deliveryAreas).toHaveLength(1);

    const back = await PATCH_ORDERING(
      request("/api/v1/staff/ordering", staffToken, { delivery: true, takeaway: false }),
    );
    expect(((await back.json()) as MenuBody).ordering).toEqual({
      dineIn: true,
      takeaway: false,
      delivery: true,
    });
  });

  it("answers the loyalty overview with the programme's totals and its regulars", async () => {
    const { bigSpenderId } = await asTenant(tenantId, async (tx) => {
      const big = await tx.customer.create({
        data: {
          tenantId,
          provider: "password",
          providerSub: `big-${randomUUID()}`,
          email: "amrit@ex.com",
          name: "Amrit",
        },
        select: { id: true },
      });
      const small = await tx.customer.create({
        data: {
          tenantId,
          provider: "password",
          providerSub: `small-${randomUUID()}`,
          email: "jas@ex.com",
          name: "Jas",
        },
        select: { id: true },
      });
      await tx.loyaltyLedger.createMany({
        data: [
          { tenantId, customerId: big.id, delta: 30, reason: "order" },
          { tenantId, customerId: small.id, delta: 5, reason: "order" },
        ],
      });
      await tx.loyaltyVoucher.create({
        data: {
          tenantId,
          customerId: big.id,
          valueCents: 2000,
          pointsSpent: 20,
          status: "available",
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });
      await tx.loyaltyVoucher.create({
        data: {
          tenantId,
          customerId: small.id,
          valueCents: 2000,
          pointsSpent: 20,
          status: "redeemed",
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });
      await tx.order.create({
        data: {
          tenantId,
          venueId,
          customerId: big.id,
          orderNumber: 9001,
          totalCents: 2400,
          currency: "EUR",
        },
      });
      return { bigSpenderId: big.id };
    });

    const res = await GET_LOYALTY(request("/api/v1/staff/loyalty", staffToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await res.json()) as LoyaltyBody;

    expect(body.enabled).toBe(true);
    expect(body.config).toEqual({
      minOrderCents: 2000,
      pointsPerOrder: 5,
      rewardPoints: 20,
      rewardValueCents: 2000,
      voucherExpiryMonths: 0,
    });
    expect(body.totals).toEqual({
      members: 2,
      pointsOutstanding: 35,
      vouchersAvailable: 1,
      vouchersRedeemed30d: 1,
    });

    // Richest first, with the voucher and the last order attached.
    expect(body.members?.map((m) => m.email)).toEqual(["amrit@ex.com", "jas@ex.com"]);
    const big = body.members![0]!;
    expect(big).toMatchObject({
      customerId: bigSpenderId,
      name: "Amrit",
      balance: 30,
      vouchersAvailable: 1,
    });
    expect(new Date(big.lastOrderAt!).getTime()).toBeGreaterThan(0);
    expect(body.members![1]!.lastOrderAt).toBeNull();
  });
});
