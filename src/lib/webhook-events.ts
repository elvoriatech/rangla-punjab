import { prisma } from "./db";

/**
 * Retention for the provider-webhook de-duplication table.
 *
 * The guard only has to remember an event for as long as the provider
 * might retry it. Stripe's retry window is 3 days on live keys and up to
 * ~7 in practice; 14 gives comfortable margin while keeping the table
 * small. Beyond the window a "replay" cannot arrive, so forgetting the
 * id is safe — and if one somehow did, the downstream writes are
 * upsert-shaped and converge anyway.
 */
export const WEBHOOK_EVENT_RETENTION_DAYS = Number(process.env.WEBHOOK_EVENT_RETENTION_DAYS ?? 14);

/** Delete claim rows past the retention window. Returns the row count. */
export async function pruneWebhookEvents(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.webhookEvent.deleteMany({
    where: { processedAt: { lt: cutoff } },
  });
  return count;
}
