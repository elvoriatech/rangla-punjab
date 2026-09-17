-- Order idempotency + provider webhook de-duplication, both in Postgres.
--
-- WHY HERE AND NOT IN REDIS: creating an order must not depend on Redis
-- being reachable, and settling a payment shouldn't either. Keeping both
-- guards in the same database as the rows they protect makes each guard
-- atomic with its own write.

-- A retried submit (lost response, flaky mobile connection) carries the
-- same client_request_id, so the unique index below turns the second
-- attempt into a lookup instead of a duplicate order. NULLs are distinct
-- in Postgres, so keyless orders never collide with each other.
ALTER TABLE "orders" ADD COLUMN "client_request_id" TEXT;

CREATE UNIQUE INDEX "orders_venue_id_client_request_id_key"
  ON "orders"("venue_id", "client_request_id");

-- Replaces the Redis SET that de-duplicated Stripe webhook retries.
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- Supports the daily prune (delete rows past the retry window).
CREATE INDEX "webhook_events_processed_at_idx" ON "webhook_events"("processed_at");
