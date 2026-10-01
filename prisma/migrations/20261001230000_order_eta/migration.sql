-- Expected time (owner, 2026-10-01): for an ASAP delivery or pickup order
-- the restaurant promises a time, Lieferando-style. `eta_minutes` is the
-- promise it ACCEPTED the order with (NULL = it did not answer inside the
-- accept window, so the venue's default applies). `paid_at` is when an
-- online order was settled — the moment it reaches the board, which is
-- where the accept window and the promise are counted from (a cash order
-- reaches the board when it is placed, so it stays NULL there).
ALTER TABLE "orders" ADD COLUMN "eta_minutes" INTEGER;
ALTER TABLE "orders" ADD COLUMN "paid_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD CONSTRAINT "orders_eta_minutes_check"
  CHECK ("eta_minutes" IS NULL OR ("eta_minutes" BETWEEN 5 AND 180 AND "eta_minutes" % 5 = 0));
