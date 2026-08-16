-- Order lifecycle: placed → preparing → ready → (out_for_delivery) → done.
-- The service layer (src/lib/order-status.ts) is the transition authority;
-- this CHECK is the database backstop so a bug can never write a status
-- no surface knows how to render. Existing rows only ever hold
-- 'placed' or 'done', both of which remain valid.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_status_check"
  CHECK ("status" IN ('placed', 'preparing', 'ready', 'out_for_delivery', 'done'));
