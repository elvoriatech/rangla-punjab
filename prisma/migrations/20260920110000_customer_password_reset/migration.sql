-- Guest password reset (P7-15).
--
-- Owners have had "forgot my password" since P1-2 (`password_reset_tokens`).
-- Guests — the people who actually order the food — had nothing: an email
-- account whose password was lost was an account gone for good, taking its
-- order history and loyalty points with it.
--
-- Same primitive as the owner table, deliberately NOT the same table:
--   * a guest is a `customers` row, not a `users` row, so the FK differs;
--   * customers are TENANT-SCOPED, so this table carries `tenant_id` and
--     lives behind the same RLS policy as `customers`/`customer_tokens` —
--     a token minted for one tenant is invisible to another.
--
-- The token itself never touches this table: only its SHA-256 hash does
-- (`token_hash`, UNIQUE so a collision is a constraint error rather than a
-- silent second account). `used_at` makes it single-use and `expires_at`
-- bounds it to 60 minutes; consuming one also revokes every live
-- `customer_tokens` row of that customer, which is the whole point of a
-- reset — whoever had the old password is signed out everywhere.
CREATE TABLE "customer_password_reset_tokens" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "token_hash"  TEXT NOT NULL,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "used_at"     TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_password_reset_tokens_customer_id_fkey" FOREIGN KEY ("customer_id")
    REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_password_reset_tokens_token_hash_key"
  ON "customer_password_reset_tokens"("token_hash");
-- Every write-side read is "this customer's outstanding tokens".
CREATE INDEX "customer_password_reset_tokens_customer_id_idx"
  ON "customer_password_reset_tokens"("customer_id");

-- Same tenant-isolation posture as every other tenant table (customers,
-- customer_tokens, loyalty, order_issues): RLS on AND forced, so the GUC
-- `asTenant` sets is the only thing that makes a row visible — even to the
-- table owner.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "customer_password_reset_tokens" ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'ALTER TABLE "customer_password_reset_tokens" FORCE ROW LEVEL SECURITY;';
  EXECUTE
    'CREATE POLICY tenant_isolation ON "customer_password_reset_tokens" '
    || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
    || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));';
END $$;

-- New tables are NOT covered by the ALTER DEFAULT PRIVILEGES in
-- prisma/dev-roles.sql (those apply only to tables created by the role that
-- set them), so every migration that adds a table grants them too. Guarded
-- on the role existing, like the order_issues grants: production runs
-- RLS-off with the app connected as the database owner, where elvoria_app is
-- absent and a bare GRANT would abort `prisma migrate deploy`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "customer_password_reset_tokens" TO elvoria_app;
  END IF;
END
$$;
