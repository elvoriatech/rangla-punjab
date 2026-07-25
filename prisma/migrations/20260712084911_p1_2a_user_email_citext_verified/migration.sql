-- P1-2a: case-insensitive unique email + verified-at column.
--
-- Case-insensitive uniqueness is enforced at the database (not by lowercasing
-- in app code), so "Alice@Ex.com" and "alice@ex.com" cannot both sign up even
-- if a code path forgets to normalise. `citext` is the standard PostgreSQL
-- way to do this without an extra `lower(email)` unique index.

CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE "users" ALTER COLUMN "email" TYPE citext; -- migration:safe (citext is a superset of text; no data-fill needed)

-- `email_verified_at` stays NULL until P1-2b's verification flow flips it.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);
