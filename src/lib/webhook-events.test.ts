import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { pruneWebhookEvents, WEBHOOK_EVENT_RETENTION_DAYS } from "./webhook-events";

describe("webhook event de-duplication store", () => {
  const ids: string[] = [];

  afterEach(async () => {
    if (ids.length) await prisma.webhookEvent.deleteMany({ where: { id: { in: ids } } });
    ids.length = 0;
  });

  async function seed(id: string, processedAt: Date): Promise<void> {
    ids.push(id);
    await prisma.webhookEvent.create({ data: { id, provider: "stripe", processedAt } });
  }

  it("claims an event id exactly once", async () => {
    const id = `evt_${randomUUID()}`;
    ids.push(id);

    const first = await prisma.webhookEvent.createMany({
      data: [{ id, provider: "stripe" }],
      skipDuplicates: true,
    });
    const second = await prisma.webhookEvent.createMany({
      data: [{ id, provider: "stripe" }],
      skipDuplicates: true,
    });

    // 1 then 0 is what makes the guard work: the second delivery of the
    // same Stripe event is recognised without reprocessing it.
    expect(first.count).toBe(1);
    expect(second.count).toBe(0);
  });

  it("lets two simultaneous claims of one id produce a single winner", async () => {
    const id = `evt_${randomUUID()}`;
    ids.push(id);

    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.webhookEvent.createMany({
          data: [{ id, provider: "stripe" }],
          skipDuplicates: true,
        }),
      ),
    );
    expect(claims.filter((c) => c.count === 1)).toHaveLength(1);
  });

  it("prunes rows past the retention window and keeps recent ones", async () => {
    const stale = `evt_${randomUUID()}`;
    const fresh = `evt_${randomUUID()}`;
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;

    await seed(stale, new Date(now.getTime() - (WEBHOOK_EVENT_RETENTION_DAYS + 2) * dayMs));
    await seed(fresh, new Date(now.getTime() - dayMs));

    await pruneWebhookEvents(now);

    expect(await prisma.webhookEvent.findUnique({ where: { id: stale } })).toBeNull();
    expect(await prisma.webhookEvent.findUnique({ where: { id: fresh } })).not.toBeNull();
  });
});
