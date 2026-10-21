import { prisma } from "./db";
import { createLogger } from "./logger";

const log = createLogger();

/** A claim older than this still "processing" belongs to a crashed run. */
export const STALE_CLAIM_MS = 5 * 60 * 1000;

export type ClaimResult =
  /** Ours to process now. */
  | "claimed"
  /** Processed and committed before: answer 200, do nothing. */
  | "done"
  /** Another delivery of the same event is being processed right now:
   *  answer non-2xx so the provider tries again later. */
  | "busy";

/**
 * Claim a provider event for processing (owner, 2026-10-21: "transactional,
 * retry-safe and idempotent; failed processing must remain retryable").
 *
 * Before, the id was recorded BEFORE processing, so a delivery that failed
 * halfway was answered "already handled" on every retry and its payment was
 * lost. Now a claim is "processing" until `completeWebhookEvent`; a failure
 * calls `releaseWebhookEvent`, which deletes it, and the provider's retry
 * runs the whole thing again. The work itself is idempotent too (payment
 * attempts settle once), so even a double run cannot double-settle.
 */
export async function claimWebhookEvent(id: string, provider: string): Promise<ClaimResult> {
  const inserted = await prisma.webhookEvent.createMany({
    data: [{ id, provider, status: "processing", claimedAt: new Date() }],
    skipDuplicates: true,
  });
  if (inserted.count === 1) return "claimed";

  const row = await prisma.webhookEvent.findUnique({
    where: { id },
    select: { status: true, claimedAt: true },
  });
  if (!row) return claimWebhookEvent(id, provider); // released meanwhile
  if (row.status === "done") return "done";
  // A crashed run: take it over (atomically — only one taker wins).
  const takeover = await prisma.webhookEvent.updateMany({
    where: {
      id,
      status: "processing",
      claimedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) },
    },
    data: { claimedAt: new Date() },
  });
  if (takeover.count === 1) {
    log.warn("webhook.claim_taken_over", { id, provider });
    return "claimed";
  }
  return "busy";
}

/** Processing committed: later deliveries of this event are no-ops. */
export async function completeWebhookEvent(id: string): Promise<void> {
  await prisma.webhookEvent.updateMany({
    where: { id },
    data: { status: "done", processedAt: new Date() },
  });
}

/** Processing failed: forget the claim so the provider's retry runs again. */
export async function releaseWebhookEvent(id: string): Promise<void> {
  await prisma.webhookEvent
    .deleteMany({ where: { id, status: "processing" } })
    .catch((err: unknown) => log.error("webhook.release_failed", { id, err: String(err) }));
}

/**
 * Run `work` for a provider event exactly once to completion. Returns
 * "replayed" for an event already done, "busy" when another delivery holds
 * it, otherwise whatever `work` returns. A throw releases the claim and
 * re-throws (the route answers 5xx → the provider retries).
 */
export async function processWebhookOnce<T>(
  id: string,
  provider: string,
  work: () => Promise<T>,
): Promise<T | "replayed" | "busy"> {
  const claim = await claimWebhookEvent(id, provider);
  if (claim === "done") return "replayed";
  if (claim === "busy") return "busy";
  try {
    const result = await work();
    await completeWebhookEvent(id);
    return result;
  } catch (err) {
    await releaseWebhookEvent(id);
    throw err;
  }
}
