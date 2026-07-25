-- P1-2b: email verification + password reset token tables.
--
-- Tokens are 32 random bytes shown once to the user (via email link) and
-- stored *hashed* — a DB dump never leaks a usable token. Single-use is
-- enforced by the `used_at` column: consuming a token stamps it, and the
-- consume query joins on `used_at IS NULL AND expires_at > NOW()`.

CREATE TABLE "email_verification_tokens" (
    "id"         TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at"    TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_verification_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key"
  ON "email_verification_tokens"("token_hash");
CREATE INDEX "email_verification_tokens_user_id_idx"
  ON "email_verification_tokens"("user_id");

CREATE TABLE "password_reset_tokens" (
    "id"         TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at"    TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key"
  ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx"
  ON "password_reset_tokens"("user_id");

-- Session-invalidation column. Every session cookie carries an `iat`
-- (issued-at); a request is only trusted when `iat >= sessions_valid_from`.
-- Reset consuming this token bumps `sessions_valid_from` so every previously
-- issued cookie for that user is instantly dead.
ALTER TABLE "users"
  ADD COLUMN "sessions_valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
