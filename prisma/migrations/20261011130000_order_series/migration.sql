-- Two number series (owner, 2026-10-11): "B" for cash orders, "O" for online
-- ones (PayPal, Apple Pay, Google Pay, card — and orders a voucher or gift card
-- paid). `order_number` now counts WITHIN the series, so B-1, B-2 … and
-- O-1, O-2 … run side by side; orders placed before this keep their old
-- running number and no series (shown without a letter).
ALTER TABLE "orders" ADD COLUMN "order_series" TEXT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_series_check"
  CHECK ("order_series" IS NULL OR "order_series" IN ('B', 'O'));
DROP INDEX IF EXISTS "orders_venue_id_order_number_key";
CREATE UNIQUE INDEX "orders_venue_id_order_series_order_number_key"
  ON "orders"("venue_id", "order_series", "order_number");
-- Old orders (series NULL) keep their uniqueness through this partial index.
CREATE UNIQUE INDEX "orders_venue_id_order_number_legacy_key"
  ON "orders"("venue_id", "order_number") WHERE "order_series" IS NULL;

-- A deleted order keeps its series too, so its number is never handed out again.
ALTER TABLE "deleted_orders" ADD COLUMN "order_series" TEXT;
