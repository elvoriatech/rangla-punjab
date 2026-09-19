-- Loyalty round two: spending a voucher on an order.
--
-- The columns redemption writes (orders.discount_cents, orders.voucher_id,
-- loyalty_vouchers.status/armed_at/redeemed_order_id) all shipped with
-- round one. The only thing round one could not foresee precisely was the
-- NAME of the ledger movement a redemption writes, and `reason` is
-- CHECK-constrained to the four reasons that existed then.
--
-- 'redeem' is a delta-0 row: the points were spent when the voucher was
-- minted, so this movement changes no balance. It exists so the guest's
-- history can say "€20 reward used · Order #0031" — a wallet with no
-- record of where the reward went is a support ticket waiting to happen.
ALTER TABLE "loyalty_ledger" DROP CONSTRAINT "loyalty_ledger_reason_check";
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_reason_check"
  CHECK ("reason" IN ('order', 'reversal', 'voucher', 'redeem', 'adjust'));
