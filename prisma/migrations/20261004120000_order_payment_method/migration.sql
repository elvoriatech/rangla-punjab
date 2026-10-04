-- How a Stripe payment was made (owner, 2026-10-04: an Apple Pay order
-- showed "Card"). Read back from Stripe once the order is paid:
-- "apple_pay" | "google_pay" | "card" | another Stripe method type.
-- NULL for cash, PayPal and orders paid before it was recorded.
ALTER TABLE "orders" ADD COLUMN "payment_method" TEXT;
