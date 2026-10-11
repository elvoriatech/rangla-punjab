-- A percentage off the whole order (owner, 2026-10-11: "offer on the total
-- order value, configurable in the app, e.g. 10 %"). The percentage lives
-- in venues.ordering (orderDiscountPercent); each order keeps a snapshot of
-- the percent it was placed with and the cents it took off the food, so a
-- later change of the setting never rewrites an old receipt or report.
ALTER TABLE "orders" ADD COLUMN "order_discount_percent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "order_discount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_discount_check"
  CHECK ("order_discount_percent" BETWEEN 0 AND 100 AND "order_discount_cents" >= 0);
