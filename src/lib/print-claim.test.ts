import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { asTenant } from "./tenant";
import { signupUser } from "./auth-service";
import { recordOrderEvent } from "./order-events";
import { claimFirstPrint } from "./print-claim";

describe("automatic printing: once in total across devices", () => {
  const tenants: string[] = [];
  const users: string[] = [];
  afterEach(async () => {
    for (const t of tenants) {
      await asTenant(t, (tx) => tx.membership.deleteMany({}));
      await asTenant(t, (tx) => tx.tenant.deleteMany({}));
    }
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    tenants.length = 0;
    users.length = 0;
  });

  async function setup() {
    const s = await signupUser({
      email: `print-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Print Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenants.push(s.tenantId);
    users.push(s.userId);
    const venueId = await asTenant(s.tenantId, async (tx) => {
      const v = await tx.venue.create({
        data: { tenantId: s.tenantId, name: "Print Venue", slug: `pr-${randomUUID().slice(0, 8)}` },
        select: { id: true },
      });
      return v.id;
    });
    const claim = (orderId: string, actor = "restaurant:a@ex.com") =>
      claimFirstPrint({
        tenantId: s.tenantId,
        venueId,
        orderId,
        orderLabel: "O-14",
        actor,
        summary: "Printed (dashboard, automatic)",
      });
    return { tenantId: s.tenantId, venueId, claim };
  }

  it("the first automatic print wins; later ones are refused", async () => {
    const t = await setup();
    const orderId = randomUUID();
    expect(await t.claim(orderId)).toBe(true);
    expect(await t.claim(orderId, "restaurant:b@ex.com")).toBe(false);
  });

  it("two devices at the same moment: exactly one prints", async () => {
    const t = await setup();
    const orderId = randomUUID();
    const results = await Promise.all([
      t.claim(orderId, "restaurant:phone"),
      t.claim(orderId, "restaurant:dashboard"),
      t.claim(orderId, "restaurant:tablet"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("an order already printed by hand (e.g. Bluetooth on the owner's phone) is not auto-printed", async () => {
    const t = await setup();
    const orderId = randomUUID();
    await recordOrderEvent({
      tenantId: t.tenantId,
      venueId: t.venueId,
      orderId,
      orderLabel: "O-14",
      kind: "order.printed",
      actor: "restaurant:owner",
      summary: "Printed (Bluetooth)",
    });
    expect(await t.claim(orderId)).toBe(false);
  });
});
