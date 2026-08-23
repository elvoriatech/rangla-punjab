-- Email sign-up for customers: Argon2id hash, only for provider "password"
-- accounts; OAuth customers keep NULL.
ALTER TABLE "customers" ADD COLUMN "password_hash" TEXT;
