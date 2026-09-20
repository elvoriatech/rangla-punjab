-- migration:expand
--
-- What a redeemed reward COST the guest, in points, on the order itself.
--
-- The owner wants the redemption visible to the restaurant and to the
-- guest on every surface, and stating the points is what makes the line
-- mean something ("Reward · 100 points  -20,00 EUR") rather than looking
-- like an unexplained discount. The number already exists on
-- `loyalty_vouchers.points_spent`, but `orders.voucher_id` is a plain
-- reference with no FK and therefore no Prisma relation to join through,
-- so every one of the eight read models that draws the line would have
-- needed its own second lookup. Copying the integer onto the order at
-- placement is the cheaper half of that trade: it is immutable once the
-- voucher is spent, so there is nothing for the copy to drift from.
--
-- EXPAND-only and additive: NOT NULL with a DEFAULT 0, so existing rows
-- are filled by Postgres without a rewrite (PG 11+ stores the default in
-- the catalogue) and no reader changes behaviour until the code that
-- writes it ships. 0 reads as "no reward on this order".
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "discount_points" INTEGER NOT NULL DEFAULT 0;

-- Backfill the orders that already redeemed a reward. `points_spent` is
-- written once when the voucher is minted and never touched again, so
-- this is the same number the order would have copied had the column
-- existed then. Orders whose voucher row has since been deleted keep the
-- 0 — the amount is still on the line, only the points are unknown.
UPDATE "orders" AS o
SET "discount_points" = v."points_spent"
FROM "loyalty_vouchers" AS v
WHERE o."voucher_id" = v."id"
  AND o."discount_points" = 0;
