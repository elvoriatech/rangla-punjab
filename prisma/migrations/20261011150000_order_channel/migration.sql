-- Where an order was placed: the restaurant's phone app or the website
-- (owner, 2026-10-11: the order discount applies to app orders only).
-- NULL on orders from before the column existed.
ALTER TABLE "orders" ADD COLUMN "order_channel" TEXT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_channel_check"
  CHECK ("order_channel" IS NULL OR "order_channel" IN ('app', 'web'));
