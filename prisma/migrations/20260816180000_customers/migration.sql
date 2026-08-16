-- Customer accounts for the guest app/web: Google + Microsoft (Hotmail)
-- sign-in. A customer belongs to THE restaurant (tenant-scoped like every
-- guest-facing table); identity is (provider, provider_sub) — the OIDC
-- subject — with email kept for display and lookup.
CREATE TABLE "customers" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "provider"      TEXT NOT NULL,
  "provider_sub"  TEXT NOT NULL,
  "email"         TEXT NOT NULL,
  "name"          TEXT,
  "phone"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "customers_provider_sub_key" ON "customers"("tenant_id", "provider", "provider_sub");
CREATE INDEX "customers_email_idx" ON "customers"("tenant_id", "email");

-- Opaque bearer tokens (P1-1 pattern: random 32 bytes, stored SHA-256
-- hashed, TTL, revocable — never JWTs). The web cookie and the app's
-- secure storage carry the SAME kind of token.
CREATE TABLE "customer_tokens" (
  "id"           TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "customer_id"  TEXT NOT NULL,
  "token_hash"   TEXT NOT NULL,
  "expires_at"   TIMESTAMP(3) NOT NULL,
  "revoked_at"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_tokens_customer_id_fkey" FOREIGN KEY ("customer_id")
    REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "customer_tokens_token_hash_key" ON "customer_tokens"("token_hash");
CREATE INDEX "customer_tokens_customer_idx" ON "customer_tokens"("customer_id");

-- A signed-in customer's orders are theirs to list.
ALTER TABLE "orders" ADD COLUMN "customer_id" TEXT
  REFERENCES "customers"("id") ON DELETE SET NULL;
CREATE INDEX "orders_customer_idx" ON "orders"("customer_id");

-- Same tenant-isolation posture as every other tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','customer_tokens'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
      || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
      t
    );
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON "customers", "customer_tokens" TO elvoria_app;
