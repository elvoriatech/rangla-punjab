-- Optional guest email on an order: the receipt (with VAT split) is mailed
-- there — on placement for cash orders, on settlement for online ones.
ALTER TABLE "orders" ADD COLUMN "customer_email" TEXT;
