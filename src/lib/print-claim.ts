import { prisma } from "./db";
import { recordOrderEventTx } from "./order-events";

/**
 * Automatic printing prints each order ONCE IN TOTAL (owner, 2026-10-23,
 * order O-14 / RP-9MBWS): it came out on the owner's phone and again on the
 * restaurant's dashboard, because each device only remembered its own
 * prints. Now every automatic print asks here first: under a per-order lock
 * the server checks the order log for any earlier print (on any device,
 * automatic or by hand) and, only if there is none, records this one and
 * says "print". Two devices asking at the same moment get one yes.
 *
 * Manual printing (a Print button) never asks — a person who wants another
 * ticket gets one — but it is still recorded, so a later automatic print
 * skips the order.
 */
export async function claimFirstPrint(input: {
  tenantId: string;
  venueId: string;
  orderId: string;
  orderLabel: string;
  actor: string;
  summary: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${input.tenantId}, true)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print:${input.orderId}`})::bigint)`;
    const earlier = await tx.orderEvent.findFirst({
      where: { orderId: input.orderId, kind: "order.printed" },
      select: { id: true },
    });
    if (earlier) return false;
    await recordOrderEventTx(tx, {
      tenantId: input.tenantId,
      venueId: input.venueId,
      orderId: input.orderId,
      orderLabel: input.orderLabel,
      kind: "order.printed",
      actor: input.actor,
      summary: input.summary,
    });
    return true;
  });
}
