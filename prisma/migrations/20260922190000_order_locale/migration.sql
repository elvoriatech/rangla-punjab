-- The language the guest ordered in; picks the order e-mail's language.
-- Nullable: older orders (and older app builds) fall back to the
-- account's language, then the venue default.
ALTER TABLE "orders" ADD COLUMN "locale" VARCHAR(8);
