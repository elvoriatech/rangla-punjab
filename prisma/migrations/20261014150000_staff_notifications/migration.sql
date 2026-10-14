-- The restaurant app's bell (owner, 2026-10-14): every notification the
-- restaurant was sent (new order, guest cancel, complaint, table request,
-- catering request), kept so the bell can count the unseen ones and list
-- them. `need` is the team box that may see it ("orders", "reservations",
-- "catering"); owners see all. Seen-state is one timestamp per login.
CREATE TABLE "staff_notifications" (
  "id"        TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "need"      TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "data"      JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "staff_notifications_tenant_id_createdAt_idx"
  ON "staff_notifications"("tenant_id", "createdAt");

CREATE TABLE "staff_notification_seen" (
  "tenant_id" TEXT NOT NULL,
  "user_id"   TEXT NOT NULL,
  "seen_at"   TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "staff_notification_seen_pkey" PRIMARY KEY ("tenant_id", "user_id"),
  CONSTRAINT "staff_notification_seen_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "staff_notification_seen_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "staff_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_notifications"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
ALTER TABLE "staff_notification_seen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_notification_seen" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_notification_seen"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT, DELETE ON "staff_notifications" TO elvoria_app;
    GRANT SELECT, INSERT, UPDATE ON "staff_notification_seen" TO elvoria_app;
  END IF;
END
$$;
