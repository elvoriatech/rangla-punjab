-- Gift-card purchase: the buyer's contact number (required for new
-- purchases, nullable for cards sold before it was asked) and the amount
-- actually charged — the card's value less the purchase discount. NULL on
-- older rows means "charged the full value".
ALTER TABLE "gift_cards" ADD COLUMN "purchaser_phone" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "paid_cents" INTEGER;
