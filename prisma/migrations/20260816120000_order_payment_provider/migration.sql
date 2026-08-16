-- Which rail settled (or is settling) the order: 'stripe' | 'paypal'.
-- NULL = no online payment was ever started (cash / at the counter).
-- Reports and the payments view group on this; free text so a future
-- rail is a code change, not a migration.
ALTER TABLE "orders" ADD COLUMN "payment_provider" TEXT;
