import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import { dispatchOrder, dispatchUrl, getDispatchOrder } from "./dispatch-service";
import { signDispatchToken, verifyDispatchToken } from "./dispatch-token";
import { signReceiptToken } from "./receipt-token";
import { asTenant } from "./tenant";

/**
 * Driver dispatch: the ticket QR that flips an order to
 * "out for delivery".
 *
 * The thing worth testing hard here is not the happy path — it is that a
 * bearer link which anyone holding a printed ticket can scan does
 * EXACTLY one narrow thing, and that a driver who scans twice (or two
 * drivers sent to one address) never see an error they will try to work
 * around.
 */
describe("dispatch tokens", () => {
  it("round-trips the order and tenant it was minted for", () => {
    const token = signDispatchToken("order_1", "tenant_1");
    expect(verifyDispatchToken(token)).toEqual({ orderId: "order_1", tenantId: "tenant_1" });
  });

  it("rejects a tampered payload", () => {
    const token = signDispatchToken("order_1", "tenant_1");
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ o: "order_2", t: "tenant_1", iat: 0, exp: 9_999_999_999 }),
    ).toString("base64url");
    expect(verifyDispatchToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyDispatchToken(`${payload}.${sig}x`)).toBeNull();
    expect(verifyDispatchToken("nonsense")).toBeNull();
    expect(verifyDispatchToken("")).toBeNull();
  });

  it("rejects an expired token", () => {
    expect(verifyDispatchToken(signDispatchToken("o", "t", -1))).toBeNull();
  });

  /**
   * The point of the separate domain tag. Guests HAVE receipt tokens —
   * they are in every receipt email — so if the two were interchangeable
   * any guest could dispatch their own order and tell themselves the food
   * had left.
   */
  it("does not accept a receipt token, and its own token is not a receipt token", async () => {
    const receipt = signReceiptToken("order_1", "tenant_1");
    expect(verifyDispatchToken(receipt)).toBeNull();

    const { verifyReceiptToken } = await import("./receipt-token");
    expect(verifyReceiptToken(signDispatchToken("order_1", "tenant_1"))).toBeNull();
  });

  it("builds a url carrying a token that verifies for that order", () => {
    const url = dispatchUrl("order_9", "tenant_9");
    expect(url).toContain("/dispatch/order_9?t=");
    const token = decodeURIComponent(new URL(url).searchParams.get("t") ?? "");
    expect(verifyDispatchToken(token)).toEqual({ orderId: "order_9", tenantId: "tenant_9" });
  });
});

describe("dispatchOrder", () => {
  const userIds: string[] = [];
  const tenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of tenantIds) {
      await asTenant(tid, (tx) => tx.order.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    tenantIds.length = 0;
  });

  async function fixture(opts: { orderType?: string; status?: string } = {}) {
    const s = await signupUser({
      email: `dispatch-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Dispatch Test",
    });
    if (!s.ok) throw new Error("signup failed");
    userIds.push(s.userId);
    tenantIds.push(s.tenantId);

    return asTenant(s.tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Dispatch Venue",
          slug: `dispatch-${randomUUID().slice(0, 8)}`,
          currency: "EUR",
        },
        select: { id: true },
      });
      const order = await tx.order.create({
        data: {
          tenantId: s.tenantId,
          venueId: venue.id,
          orderNumber: 1,
          orderType: opts.orderType ?? "delivery",
          status: opts.status ?? "ready",
          customerName: "Amrit Kaur",
          customerPhone: "+49 170 0000000",
          deliveryAddress: { street: "Bornstraße 12", zip: "44145", city: "Dortmund" },
          totalCents: 2490,
          currency: "EUR",
        },
        select: { id: true },
      });
      return { tenantId: s.tenantId, venueId: venue.id, orderId: order.id };
    });
  }

  async function statusOf(tenantId: string, orderId: string) {
    return asTenant(tenantId, (tx) =>
      tx.order.findFirst({
        where: { id: orderId },
        select: { status: true, outForDeliveryAt: true },
      }),
    );
  }

  it("moves a ready delivery order out, stamps the time, and hands back the route", async () => {
    const fx = await fixture();
    const result = await dispatchOrder(fx.tenantId, fx.orderId, "dispatch-qr");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.already).toBe(false);
    expect(result.status).toBe("out_for_delivery");
    expect(result.customerName).toBe("Amrit Kaur");
    expect(result.addressLine).toBe("Bornstraße 12, 44145 Dortmund");
    // The Maps link the QR used to point at directly still exists — it is
    // just on the far side of our redirect now.
    expect(result.directionsUrl).toContain("google.com/maps/dir/");
    expect(result.directionsUrl).toContain(encodeURIComponent("Bornstraße 12, 44145 Dortmund"));

    const row = await statusOf(fx.tenantId, fx.orderId);
    expect(row?.status).toBe("out_for_delivery");
    expect(row?.outForDeliveryAt).toBeInstanceOf(Date);
  });

  /** A second scan is an ordinary event, not an error: the driver taps
   *  again because the page was slow, or a colleague was sent to the same
   *  address. Either way the answer is "drive". */
  it("is idempotent — a second scan reports `already` and never re-stamps", async () => {
    const fx = await fixture();
    const first = await dispatchOrder(fx.tenantId, fx.orderId, "dispatch-qr");
    expect(first.ok && first.already).toBe(false);
    const stamped = (await statusOf(fx.tenantId, fx.orderId))?.outForDeliveryAt;

    const second = await dispatchOrder(fx.tenantId, fx.orderId, "dispatch-qr");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.already).toBe(true);
    expect(second.directionsUrl).toContain("google.com/maps/dir/");

    const after = (await statusOf(fx.tenantId, fx.orderId))?.outForDeliveryAt;
    expect(after?.toISOString()).toBe(stamped?.toISOString());
  });

  /** Two drivers, one ticket, same second. Exactly one may write the
   *  timestamp; both must be told the food is on its way. */
  it("survives two simultaneous scans with one transition", async () => {
    const fx = await fixture();
    const [a, b] = await Promise.all([
      dispatchOrder(fx.tenantId, fx.orderId, "dispatch-qr"),
      dispatchOrder(fx.tenantId, fx.orderId, "staff-app"),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Both succeed; exactly one of them did the moving.
    expect([a.already, b.already].filter((x) => x === false)).toHaveLength(1);
    expect((await statusOf(fx.tenantId, fx.orderId))?.status).toBe("out_for_delivery");
  });

  it("refuses an order the kitchen has not finished", async () => {
    const fx = await fixture({ status: "placed" });
    const result = await dispatchOrder(fx.tenantId, fx.orderId, "dispatch-qr");
    expect(result).toEqual({ ok: false, error: "wrong_state" });
    expect((await statusOf(fx.tenantId, fx.orderId))?.status).toBe("placed");
  });

  it("refuses a cancelled order", async () => {
    const fx = await fixture({ status: "cancelled" });
    const result = await dispatchOrder(fx.tenantId, fx.orderId, "dispatch-qr");
    expect(result).toEqual({ ok: false, error: "wrong_state" });
  });

  it("refuses a pickup or dine-in order — there is nothing to dispatch", async () => {
    for (const orderType of ["takeaway", "dine_in"]) {
      const fx = await fixture({ orderType });
      expect(await dispatchOrder(fx.tenantId, fx.orderId, "dispatch-qr")).toEqual({
        ok: false,
        error: "not_delivery",
      });
    }
  });

  it("reports a delivered order as already out rather than as an error", async () => {
    const fx = await fixture({ status: "done" });
    const result = await dispatchOrder(fx.tenantId, fx.orderId, "dispatch-qr");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.already).toBe(true);
    expect(result.status).toBe("done");
  });

  it("returns not_found for an unknown order", async () => {
    const fx = await fixture();
    expect(await dispatchOrder(fx.tenantId, "does_not_exist", "dispatch-qr")).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("getDispatchOrder reads without changing anything", async () => {
    const fx = await fixture();
    const before = await getDispatchOrder(fx.tenantId, fx.orderId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.already).toBe(false);
    expect(before.status).toBe("ready");
    expect((await statusOf(fx.tenantId, fx.orderId))?.status).toBe("ready");
  });
});

/**
 * The ticket's QR content. This is the regression that would be easiest
 * to ship by accident: revert the QR to the Maps URL and everything
 * still "works" for the driver while the guest's tracker silently stops
 * updating.
 */
describe("ticket QR content", () => {
  it("encodes our dispatch link for a delivery, and nothing at all otherwise", async () => {
    const { ticketAddressLine } = await import("./ticket-html");

    const delivery = {
      orderType: "delivery",
      deliveryAddress: { street: "Bornstraße 12", zip: "44145", city: "Dortmund" },
    };
    expect(ticketAddressLine(delivery)).toBe("Bornstraße 12, 44145 Dortmund");
    const url = dispatchUrl("order_x", "tenant_x");
    expect(url).toContain("/dispatch/order_x");
    expect(url).not.toContain("google.com/maps");

    // Pickup and dine-in have no address, so the callers render no QR.
    expect(ticketAddressLine({ orderType: "takeaway", deliveryAddress: null })).toBeNull();
    expect(ticketAddressLine({ orderType: "dine_in", deliveryAddress: null })).toBeNull();
  });
});
