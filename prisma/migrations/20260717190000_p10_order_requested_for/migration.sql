-- P10: scheduled pickup/delivery. NULL = "as soon as possible" (the
-- default); a timestamp = the guest asked for that time, validated
-- against the venue's opening hours at order placement.
ALTER TABLE orders ADD COLUMN requested_for timestamp(3);
