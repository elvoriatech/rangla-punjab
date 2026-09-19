-- Push notifications to the owner's phone (P7-11).
--
-- One row per INSTALLATION, not per person: the owner may have the app on a
-- phone and a tablet, and both should buzz when an order lands. The Expo
-- push token is the installation's address, so it — not the user — is the
-- unique key. Reinstalling the app mints a new token and leaves the old one
-- behind, which is why `disabled_at` exists (see below).
--
-- We never talk to APNs or FCM. The token is an Expo push token
-- (`ExponentPushToken[…]`) and the server POSTs to Expo's push service,
-- which owns the Apple key and the FCM service account. That keeps two
-- vendor credentials out of this deployment entirely.
--
-- `platform` and `app_version` are diagnostics, not logic: when a whole iOS
-- build stops receiving, the first question is "which build?". Both are
-- CHECK-free text except platform, which is constrained for the same reason
-- `orders.status` is — the app's union type is the real authority and adding
-- a value later is an ALTER on this table, not a type-wide migration.
--
-- `disabled_at` is set when Expo answers `DeviceNotRegistered` for a token
-- (app deleted, permissions revoked, token rotated). We keep the row rather
-- than deleting it so a re-register can revive the same address, and so a
-- fan-out never silently shrinks without a trace of why.
CREATE TABLE "staff_devices" (
  "id"              TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "expo_push_token" TEXT NOT NULL,
  "platform"        TEXT NOT NULL,
  "app_version"     TEXT,
  "last_seen_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabled_at"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Cascade: an account that is gone cannot be notified, and a dangling
  -- token would keep costing a push request per order forever.
  CONSTRAINT "staff_devices_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "staff_devices_platform_check"
    CHECK ("platform" IN ('ios', 'android', 'web'))
);

-- The token IS the identity of an installation, globally — the same handset
-- must never end up registered twice, and re-registering is an upsert on
-- this key.
CREATE UNIQUE INDEX "staff_devices_expo_push_token_key"
  ON "staff_devices"("expo_push_token");
CREATE INDEX "staff_devices_tenant_id_idx" ON "staff_devices"("tenant_id");
-- The only question the fan-out asks: "this tenant's live devices".
CREATE INDEX "staff_devices_tenant_id_disabled_at_idx"
  ON "staff_devices"("tenant_id", "disabled_at");
-- Sign-out deletes by (user, token); the app's own list reads by user.
CREATE INDEX "staff_devices_user_id_idx" ON "staff_devices"("user_id");

-- Same tenant-isolation posture as every other tenant table: RLS on AND
-- forced, so the GUC `asTenant` sets is the only thing that makes a row
-- visible — even to the table owner.
ALTER TABLE "staff_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_devices"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- New tables are NOT covered by the ALTER DEFAULT PRIVILEGES in
-- prisma/dev-roles.sql (those apply only to tables created by the role that
-- set them), so every migration that adds a table grants them too. Guarded
-- on the role existing: production runs RLS-off with the app connected as
-- the database owner, where elvoria_app is absent and a bare GRANT would
-- abort `prisma migrate deploy`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "staff_devices" TO elvoria_app;
  END IF;
END
$$;
