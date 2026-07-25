import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import {
  placeOrder,
  getOrderForReceipt,
  getOrderStats,
  listRecentOrders,
  markOrderDone,
} from "./order-service";
import { signReceiptToken, verifyReceiptToken } from "./receipt-token";
import { buildReceiptPdf } from "./receipt-pdf";

describe("order-service (guest self-ordering)", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  });

  async function fixtureVenue(): Promise<{
    tenantId: string;
    venueId: string;
    publishedVersionId: string;
    itemIds: { pakora: string; naan: string; unavailable: string };
  }> {
    const s = await signupUser({
      email: `orders-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Order Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);

    return asTenant(s.tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Order Test Venue",
          slug: `orders-${randomUUID().slice(0, 8)}`,
          currency: "EUR",
        },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId: s.tenantId, venueId: venue.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      const version = await tx.menuVersion.create({
        data: {
          tenantId: s.tenantId,
          menuId: menu.id,
          status: "published",
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });
      const category = await tx.category.create({
        data: {
          tenantId: s.tenantId,
          menuVersionId: version.id,
          name: "Mains",
          orderIndex: 0,
        },
        select: { id: true },
      });
      const [pakora, naan, unavailable] = await Promise.all([
        tx.item.create({
          data: {
            tenantId: s.tenantId,
            categoryId: category.id,
            name: "Pakora",
            priceCents: 690,
            orderIndex: 0,
          },
          select: { id: true },
        }),
        tx.item.create({
          data: {
            tenantId: s.tenantId,
            categoryId: category.id,
            name: "Naan",
            priceCents: 350,
            orderIndex: 100,
          },
          select: { id: true },
        }),
        tx.item.create({
          data: {
            tenantId: s.tenantId,
            categoryId: category.id,
            name: "Sold out",
            priceCents: 1000,
            orderIndex: 200,
            isAvailable: false,
          },
          select: { id: true },
        }),
      ]);
      return {
        tenantId: s.tenantId,
        venueId: venue.id,
        publishedVersionId: version.id,
        itemIds: { pakora: pakora.id, naan: naan.id, unavailable: unavailable.id },
      };
    });
  }

  it("places an order with server-computed totals and a running order number", async () => {
    const fx = await fixtureVenue();
    const first = await placeOrder(fx, {
      items: [
        { itemId: fx.itemIds.pakora, quantity: 2 },
        { itemId: fx.itemIds.naan, quantity: 3 },
      ],
      tableNumber: "12",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.totalCents).toBe(2 * 690 + 3 * 350);
    expect(first.value.orderNumber).toBe(1);
    expect(first.value.currency).toBe("EUR");

    const second = await placeOrder(fx, { items: [{ itemId: fx.itemIds.naan, quantity: 1 }] });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.orderNumber).toBe(2);
  });

  it("merges duplicate lines for the same item", async () => {
    const fx = await fixtureVenue();
    const r = await placeOrder(fx, {
      items: [
        { itemId: fx.itemIds.naan, quantity: 1 },
        { itemId: fx.itemIds.naan, quantity: 2 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalCents).toBe(3 * 350);
    const order = await getOrderForReceipt(fx.tenantId, r.value.orderId);
    expect(order?.items).toHaveLength(1);
    expect(order?.items[0]?.quantity).toBe(3);
  });

  it("rejects unknown and unavailable items, and prices from the client are ignored", async () => {
    const fx = await fixtureVenue();
    const unknown = await placeOrder(fx, {
      items: [{ itemId: "not-a-real-item", quantity: 1 }],
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toBe("unknown_items");

    const soldOut = await placeOrder(fx, {
      items: [{ itemId: fx.itemIds.unavailable, quantity: 1 }],
    });
    expect(soldOut.ok).toBe(false);

    // Client-supplied price fields are simply not part of the schema.
    const tampered = await placeOrder(fx, {
      items: [{ itemId: fx.itemIds.naan, quantity: 1, priceCents: 1 }],
    });
    expect(tampered.ok).toBe(true);
    if (tampered.ok) expect(tampered.value.totalCents).toBe(350);
  });

  it("rejects orders against a venue with no published menu", async () => {
    const fx = await fixtureVenue();
    const r = await placeOrder(
      { ...fx, publishedVersionId: null },
      { items: [{ itemId: fx.itemIds.naan, quantity: 1 }] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_published");
  });

  it("receipt token round-trips and rejects tampering", async () => {
    const token = signReceiptToken("order-1", "tenant-1");
    expect(verifyReceiptToken(token)).toEqual({ orderId: "order-1", tenantId: "tenant-1" });
    expect(verifyReceiptToken(`${token}x`)).toBeNull();
    expect(verifyReceiptToken("garbage")).toBeNull();
  });

  it("lists recent orders for the kitchen and marks them done", async () => {
    const fx = await fixtureVenue();
    const placed = await placeOrder(fx, {
      items: [{ itemId: fx.itemIds.naan, quantity: 2 }],
      tableNumber: "3",
    });
    if (!placed.ok) throw new Error("order failed");

    const userId = await asTenant(fx.tenantId, async (tx) => {
      const m = await tx.membership.findFirstOrThrow({ select: { userId: true } });
      return m.userId;
    });

    let orders = await listRecentOrders(userId);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe("placed");
    expect(orders[0]!.tableNumber).toBe("3");
    expect(orders[0]!.items[0]).toMatchObject({ name: "Naan", quantity: 2 });

    const done = await markOrderDone(userId, placed.value.orderId);
    expect(done.ok).toBe(true);
    orders = await listRecentOrders(userId);
    expect(orders[0]!.status).toBe("done");
  });

  it("aggregates today / month / best-day stats in the venue timezone", async () => {
    const fx = await fixtureVenue();
    const userId = await asTenant(fx.tenantId, async (tx) => {
      const m = await tx.membership.findFirstOrThrow({ select: { userId: true } });
      return m.userId;
    });

    // Two orders today, one heavier order earlier this month (unless we're
    // on the 1st — then everything lands today, which the assertions allow).
    const now = new Date();
    const earlier = new Date(now);
    earlier.setDate(Math.max(1, now.getDate() - 3));
    const mkOrder = (createdAt: Date, totalCents: number, orderNumber: number) =>
      asTenant(fx.tenantId, (tx) =>
        tx.order.create({
          data: {
            tenantId: fx.tenantId,
            venueId: fx.venueId,
            orderNumber,
            totalCents,
            currency: "EUR",
            createdAt,
            items: {
              create: [
                {
                  tenantId: fx.tenantId,
                  name: "Fixture dish",
                  priceCents: totalCents,
                  quantity: 1,
                },
              ],
            },
          },
        }),
      );
    await mkOrder(now, 1000, 900);
    await mkOrder(now, 500, 901);
    await mkOrder(earlier, 9000, 902);

    const stats = await getOrderStats(userId);
    expect(stats.month.orders).toBe(3);
    expect(stats.month.revenueCents).toBe(10500);
    expect(stats.today.orders).toBeGreaterThanOrEqual(2);
    expect(stats.bestDay).not.toBeNull();
    expect(stats.bestDay!.revenueCents).toBeGreaterThanOrEqual(9000);
  });

  it("requires contact details for takeaway and persists them", async () => {
    const fx = await fixtureVenue();
    const missing = await placeOrder(fx, {
      orderType: "takeaway",
      items: [{ itemId: fx.itemIds.pakora, quantity: 1 }],
    });
    expect(missing).toEqual({ ok: false, error: "invalid" });

    const placed = await placeOrder(fx, {
      orderType: "takeaway",
      customerName: "Zahoor",
      customerPhone: "+49 170 1234567",
      items: [{ itemId: fx.itemIds.pakora, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("takeaway failed");
    const receipt = await getOrderForReceipt(fx.tenantId, placed.value.orderId);
    expect(receipt?.orderType).toBe("takeaway");
    expect(receipt?.customerName).toBe("Zahoor");
    expect(receipt?.tableNumber).toBeNull();
  });

  it("blocks an ordering type the venue has switched off — a forged POST cannot buy it", async () => {
    const fx = await fixtureVenue();
    // Single restaurant: every feature is entitled, so the only gate on an
    // ordering type is the venue's own ordering config. Owner turned
    // delivery OFF — a forged delivery POST must still be refused.
    await asTenant(fx.tenantId, (tx) =>
      tx.venue.update({ where: { id: fx.venueId }, data: { ordering: { delivery: false } } }),
    );
    const forged = await placeOrder(fx, {
      orderType: "delivery",
      customerName: "A",
      customerPhone: "1",
      address: { street: "Hauptstr. 5", zip: "60311", city: "Frankfurt" },
      items: [{ itemId: fx.itemIds.pakora, quantity: 1 }],
    });
    expect(forged).toEqual({ ok: false, error: "type_not_available" });
  });

  it("enforces delivery zone + minimum and adds the fee as a line", async () => {
    const fx = await fixtureVenue();
    await asTenant(fx.tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      await tx.venue.update({
        where: { id: fx.venueId },
        data: {
          ordering: {
            delivery: true,
            deliveryZips: ["60311"],
            deliveryFeeCents: 250,
            deliveryMinCents: 1000,
          },
        },
      });
    });
    const base = {
      orderType: "delivery" as const,
      customerName: "A",
      customerPhone: "1",
      items: [{ itemId: fx.itemIds.pakora, quantity: 3 }], // 3 × 690 = 2070
    };

    const wrongZip = await placeOrder(fx, {
      ...base,
      address: { street: "Weg 1", zip: "99999", city: "Elsewhere" },
    });
    expect(wrongZip).toEqual({ ok: false, error: "outside_delivery_area" });

    const tooSmall = await placeOrder(fx, {
      ...base,
      items: [{ itemId: fx.itemIds.pakora, quantity: 1 }],
      address: { street: "Weg 1", zip: "60311", city: "Frankfurt" },
    });
    expect(tooSmall).toEqual({ ok: false, error: "below_delivery_minimum" });

    const placed = await placeOrder(fx, {
      ...base,
      address: { street: "Weg 1", zip: "60311", city: "Frankfurt", note: "ring twice" },
    });
    if (!placed.ok) throw new Error("delivery failed");
    expect(placed.value.totalCents).toBe(3 * 690 + 250);
    const receipt = await getOrderForReceipt(fx.tenantId, placed.value.orderId);
    expect(receipt?.items.map((i) => i.name)).toContain("Delivery fee");
    expect(receipt?.deliveryAddress?.zip).toBe("60311");
  });

  it("prices per-ZIP areas: own fee/minimum per row + free-delivery threshold", async () => {
    const fx = await fixtureVenue();
    await asTenant(fx.tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      await tx.venue.update({
        where: { id: fx.venueId },
        data: {
          ordering: {
            delivery: true,
            deliveryAreas: [
              { zip: "78467", locality: "Konstanz", feeCents: 100, minCents: 1000 },
              // Half-filled row (nulls) must behave as fee 0 / min 0.
              { zip: "78462", feeCents: null, minCents: null },
              {
                zip: "78476",
                locality: "Allensbach",
                feeCents: 300,
                minCents: 4000,
                freeOverCents: 4200,
              },
            ],
          },
        },
      });
    });
    const base = {
      orderType: "delivery" as const,
      customerName: "A",
      customerPhone: "1",
      items: [{ itemId: fx.itemIds.pakora, quantity: 3 }], // 3 × 690 = 2070
    };

    // Area 1: fee 1.00, min 10.00 — 20.70 basket passes, fee added.
    const near = await placeOrder(fx, {
      ...base,
      // Client sends a wrong city on purpose: the stored address must
      // carry the area row's locality, not the client's text.
      address: { street: "Weg 1", zip: "78467", city: "Tippfehlerstadt" },
    });
    if (!near.ok) throw new Error("near delivery failed");
    expect(near.value.totalCents).toBe(2070 + 100);
    const nearReceipt = await getOrderForReceipt(fx.tenantId, near.value.orderId);
    expect(nearReceipt?.deliveryAddress?.city).toBe("Konstanz");

    // Null-valued row: fee and minimum both behave as 0.
    const nullRow = await placeOrder(fx, {
      ...base,
      items: [{ itemId: fx.itemIds.pakora, quantity: 1 }],
      address: { street: "Weg 1", zip: "78462" },
    });
    if (!nullRow.ok) throw new Error("null-row delivery failed");
    expect(nullRow.value.totalCents).toBe(690);

    // Area 3: below its own 40.00 minimum even though area 1 would pass.
    const below = await placeOrder(fx, {
      ...base,
      address: { street: "Weg 1", zip: "78476", city: "Allensbach" },
    });
    expect(below).toEqual({ ok: false, error: "below_delivery_minimum" });

    // Area 3 above minimum AND past the 42.00 free-delivery threshold:
    // fee zeroed (7 × 690 = 48.30).
    const free = await placeOrder(fx, {
      ...base,
      items: [{ itemId: fx.itemIds.pakora, quantity: 7 }],
      address: { street: "Weg 1", zip: "78476", city: "Allensbach" },
    });
    if (!free.ok) throw new Error("free delivery failed");
    expect(free.value.totalCents).toBe(7 * 690);

    // ZIP not in the list stays rejected.
    const outside = await placeOrder(fx, {
      ...base,
      address: { street: "Weg 1", zip: "10115", city: "Berlin" },
    });
    expect(outside).toEqual({ ok: false, error: "outside_delivery_area" });
  });

  it("stores a valid requested pickup time and rejects past/closed times", async () => {
    const fx = await fixtureVenue();
    // Venue open 24/7-ish today: one big window so "now + 2h" is valid.
    const { compileWeekly } = await import("./opening-hours");
    await asTenant(fx.tenantId, async (tx) => {
      await tx.venue.update({
        where: { id: fx.venueId },
        data: {
          timezone: "Europe/Berlin",
          hours: compileWeekly({ slots: [{ open: "00:00", close: "23:59" }], closedDays: [] }),
        },
      });
    });
    const base = {
      orderType: "takeaway" as const,
      customerName: "A",
      customerPhone: "1",
      items: [{ itemId: fx.itemIds.pakora, quantity: 1 }],
    };

    // Two hours from now, venue-local, on the half-hour grid.
    const berlinNow = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const nowH = Number(berlinNow.find((p) => p.type === "hour")!.value);
    const futureH = (nowH + 2) % 24;
    const wraps = futureH < nowH; // midnight wrap would be "yesterday-local"
    if (!wraps) {
      const time = `${String(futureH).padStart(2, "0")}:00`;
      const placed = await placeOrder(fx, { ...base, requestedTime: time });
      if (!placed.ok) throw new Error(`scheduled order failed at ${time}`);
      const receipt = await getOrderForReceipt(fx.tenantId, placed.value.orderId);
      expect(receipt?.requestedFor).toBeInstanceOf(Date);
      expect(receipt!.requestedFor!.getTime()).toBeGreaterThan(Date.now());
    }

    // A time hours in the past is rejected.
    const pastH = (nowH + 22) % 24;
    if (pastH < nowH) {
      const past = await placeOrder(fx, {
        ...base,
        requestedTime: `${String(pastH).padStart(2, "0")}:00`,
      });
      expect(past).toEqual({ ok: false, error: "invalid_time" });
    }

    // A time outside opening hours is rejected (venue closed all day).
    await asTenant(fx.tenantId, async (tx) => {
      await tx.venue.update({
        where: { id: fx.venueId },
        data: {
          hours: compileWeekly({
            slots: [],
            closedDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          }),
        },
      });
    });
    if (!wraps) {
      const closed = await placeOrder(fx, {
        ...base,
        requestedTime: `${String(futureH).padStart(2, "0")}:00`,
      });
      expect(closed).toEqual({ ok: false, error: "invalid_time" });
    }
  });

  it("builds a PDF receipt with the standard skeleton", async () => {
    const fx = await fixtureVenue();
    const placedOrder = await placeOrder(fx, {
      items: [{ itemId: fx.itemIds.pakora, quantity: 2 }],
      tableNumber: "7",
    });
    if (!placedOrder.ok) throw new Error("order failed");
    const order = await getOrderForReceipt(fx.tenantId, placedOrder.value.orderId);
    if (!order) throw new Error("order vanished");

    const pdf = await buildReceiptPdf(order, "de");
    // %PDF magic + a plausible size for a one-page receipt.
    expect(Buffer.from(pdf.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
