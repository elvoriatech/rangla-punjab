import { Queue, type ConnectionOptions } from "bullmq";
import { redis } from "./redis";

// BullMQ bundles a slightly older ioredis than the app pins, which
// makes the two `Redis` types structurally identical but nominally
// distinct in tsc's eyes. Cast once, at the boundary, rather than
// propagate the mismatch through every Queue/Worker constructor.
const connection = redis as unknown as ConnectionOptions;

/**
 * BullMQ queue plumbing. One queue name per pipeline; the connection
 * piggy-backs on the ioredis singleton from `redis.ts`. Today only the
 * maintenance crons (partition-maintain, slow-query-report) use it;
 * future queues get their own factory functions here so all queue
 * lifecycles stay visible in one place.
 *
 * Retries: cron jobs run with 1 attempt (safe to retry next day). A
 * permanent failure lives in the queue's `failed` set until purged.
 */

export const PARTITION_MAINTAIN_QUEUE = "partition-maintain";
export const SLOW_QUERY_REPORT_QUEUE = "slow-query-report";

// ---------- Partition-maintain queue (P2-10) --------------------------

export const partitionMaintainQueue = new Queue(PARTITION_MAINTAIN_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 1, // safe to retry manually via cron next day
    removeOnComplete: 30,
    removeOnFail: 30,
  },
});

/**
 * Register the daily 03:00 UTC repeatable job. Idempotent — calling
 * twice does not double the schedule (BullMQ dedupes by cron + name).
 * Called from the worker bootstrap (`src/workers/*` — not the Next
 * server) so a scaled-out replica does not accidentally schedule N
 * copies.
 */
export async function registerPartitionMaintainCron(): Promise<void> {
  await partitionMaintainQueue.upsertJobScheduler(
    "partition-maintain-daily",
    { pattern: "0 3 * * *", tz: "UTC" },
    { name: "maintain", data: {}, opts: { removeOnComplete: 30 } },
  );
}

// ---------- Slow-query-report queue (P2-13) ---------------------------

export const slowQueryReportQueue = new Queue(SLOW_QUERY_REPORT_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 1, // safe to retry manually via cron next day
    removeOnComplete: 30,
    removeOnFail: 30,
  },
});

/**
 * Register the daily 03:17 UTC repeatable job. Offset from the 03:00
 * partition-maintain cron so the two never contend for the same
 * superuser connection or write to `audit_events` in the same second.
 * Idempotent (BullMQ dedupes by cron + name).
 */
export async function registerSlowQueryReportCron(): Promise<void> {
  await slowQueryReportQueue.upsertJobScheduler(
    "slow-query-report-daily",
    { pattern: "17 3 * * *", tz: "UTC" },
    { name: "report", data: {}, opts: { removeOnComplete: 30 } },
  );
}
