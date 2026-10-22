import { randomUUID } from "node:crypto";
import { orderCode } from "./order-code";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import { deleteOrder } from "./order-delete-service";
import { recordForOrder, redactPayload } from "./order-events";
import { getOrderLog, listOrderLog } from "./order-log-service";
import { asTenant } from "./tenant";

describe("redactPayload", () => {
  it("blanks secrets at any depth and keeps the rest", () => {
    expect(
      redactPayload({
        customerName: "A",
        receiptToken: "x",
        nested: { client_secret: "pi_x_secret_y", amount: 5 },
        list: [{ password: "p" }],
      }),
    ).toEqual({
      customerName: "A",
      receiptToken: "[redacted]",
      nested: { client_secret: "[redacted]", amount: 5 },
      list: [{ password: "[redacted]" }],
    });
  });
});

describe("order log", () => {
  let tenantId: string;
  let userId: string;
  let venueId: string;
  const email = `log-${randomUUID()}@ex.com`;

  beforeAll(async () => {
    const s = await signupUser({ email, password: "0wnerP4ssPhrase!", tenantName: "Log Venue" });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    venueId = (
      await asTenant(tenantId, (tx) =>
        tx.venue.create({
          data: { tenantId, name: "Log", slug: `log-${randomUUID().slice(0, 8)}`, currency: "EUR" },
          select: { id: true },
        }),
      )
    ).id;
  });

  afterAll(async () => {
    await asTenant(tenantId, (tx) => tx.venue.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { email } });
  });

  it("keeps the history after the order is deleted, with a full copy of it", async () => {
    const order = await asTenant(tenantId, (tx) =>
      tx.order.create({
        data: {
          tenantId,
          venueId,
          orderNumber: 5,
          orderSeries: "O",
          totalCents: 6420,
          currency: "EUR",
          customerName: "Aman",
          paymentStatus: "pending",
          paymentProvider: "stripe",
          items: { create: [{ tenantId, name: "Dal", priceCents: 6420, quantity: 1 }] },
        },
        select: { id: true },
      }),
    );
    await recordForOrder(tenantId, order.id, {
      kind: "payment.started",
      actor: "guest",
      summary: "Stripe card page · cs_live_x",
      payload: { ref: "cs_live_x" },
    });
    expect((await deleteOrder(userId, order.id, "Testbestellung")).ok).toBe(true);

    const detail = await getOrderLog(userId, order.id);
    expect(detail?.row).toMatchObject({
      label: orderCode("O", 5),
      deleted: true,
      totalCents: 6420,
    });
    expect(detail?.events.map((e) => e.kind)).toEqual(["payment.started", "order.deleted"]);
    expect(detail?.guest.name).toBe("Aman");
    expect(detail?.items).toEqual([{ quantity: 1, name: "Dal", priceCents: 6420 }]);

    const day = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) };
    expect((await listOrderLog(userId, { ...day, filter: "deleted" })).map((r) => r.label)).toEqual(
      [orderCode("O", 5)],
    );
    // Searching the raw JSON finds it by its Stripe reference.
    expect(
      (await listOrderLog(userId, { ...day, q: "cs_live_x", filter: "all" })).map((r) => r.label),
    ).toEqual([orderCode("O", 5)]);
    // …and by its public code, in any case, with or without the prefix.
    expect(
      (
        await listOrderLog(userId, { ...day, q: orderCode("O", 5).toLowerCase(), filter: "all" })
      ).map((r) => r.label),
    ).toEqual([orderCode("O", 5)]);
  });
});
