-- Which voucher a loyalty movement is about.
--
-- The guest's history has to say "€20 reward used · Order #0031" with the
-- value the voucher ITSELF carried. Deriving that from the venue's current
-- `rewardValueCents` drifts the moment the owner changes the reward: every
-- historic line silently re-prices itself, and a guest who spent a €20
-- voucher last month reads that they spent €25.
--
-- Plain reference, no FK, like `loyalty_vouchers.redeemed_order_id`: the
-- ledger is an append-only record and must outlive whatever happens to the
-- voucher row.
ALTER TABLE "loyalty_ledger" ADD COLUMN "voucher_id" TEXT;

-- Backfill, exactly where it can be exact: a redemption's voucher is the
-- one its order recorded.
UPDATE "loyalty_ledger" l
   SET "voucher_id" = o."voucher_id"
  FROM "orders" o
 WHERE l."order_id" = o."id"
   AND l."reason" = 'redeem'
   AND o."voucher_id" IS NOT NULL;

-- And best-effort for the mint rows that pre-date this column. A voucher
-- and its debit row are written in the same loop of the same transaction,
-- so per customer the two sequences line up one-for-one in creation order.
-- A mis-pairing could only ever swap two vouchers of the same customer —
-- and any row this misses simply keeps NULL, which the API reports as
-- `valueCents: null` rather than as a wrong number.
WITH debits AS (
  SELECT "id", "customer_id",
         row_number() OVER (PARTITION BY "customer_id" ORDER BY "createdAt", "id") AS n
    FROM "loyalty_ledger"
   WHERE "reason" = 'voucher'
), minted AS (
  SELECT "id", "customer_id",
         row_number() OVER (PARTITION BY "customer_id" ORDER BY "createdAt", "id") AS n
    FROM "loyalty_vouchers"
)
UPDATE "loyalty_ledger" l
   SET "voucher_id" = minted."id"
  FROM debits
  JOIN minted
    ON minted."customer_id" = debits."customer_id"
   AND minted."n" = debits."n"
 WHERE l."id" = debits."id";
