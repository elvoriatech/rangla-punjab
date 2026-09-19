-- Complaint threads on an order (P7-10).
--
-- "The curry was cold." Until now that conversation happened on the phone,
-- or not at all — the guest had a tracking page and no way to say anything
-- back. These two tables give it a home: one thread per order, one row per
-- turn, with an optional photo the guest can show instead of describe.
--
-- ONE THREAD PER ORDER (`order_id` UNIQUE). "My food was cold AND the drink
-- was missing" is one conversation, not two tickets. Reporting IS creating
-- the thread with its first message, so a thread never exists empty and
-- "does this order have a complaint?" is a single indexed lookup.
--
-- The status is a conversation, not a workflow: a guest message leaves it
-- `open` (the restaurant owes an answer), a restaurant reply moves it to
-- `answered`, and only the restaurant closes it as `resolved`. After that
-- the guest side is read-only, while the restaurant may still add a note —
-- which is why a resolved thread is not deleted or frozen at the DB level,
-- only in the service.
--
-- Both statuses and both author values are CHECK-constrained rather than
-- Postgres enums, for the same reason `orders.status` is: adding a value
-- later is an ALTER on this table instead of a type-wide migration, and the
-- app's `IssueStatus` union is the real authority.

CREATE TABLE "order_issues" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "venue_id"    TEXT NOT NULL,
  "order_id"    TEXT NOT NULL,
  "customer_id" TEXT,
  "status"      TEXT NOT NULL DEFAULT 'open',
  "resolved_at" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_issues_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_issues_venue_id_fkey" FOREIGN KEY ("venue_id")
    REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_issues_order_id_fkey" FOREIGN KEY ("order_id")
    REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- SetNull, like reservations: deleting an account must not erase the
  -- complaint the restaurant handled, nor the answer they gave.
  CONSTRAINT "order_issues_customer_id_fkey" FOREIGN KEY ("customer_id")
    REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "order_issues_status_check"
    CHECK ("status" IN ('open', 'answered', 'resolved'))
);

CREATE UNIQUE INDEX "order_issues_order_id_key" ON "order_issues"("order_id");
CREATE INDEX "order_issues_tenant_id_idx" ON "order_issues"("tenant_id");
-- The dashboard badge and the app's complaints screen both ask the same
-- question — "unresolved threads, newest activity first" — so the index
-- carries the sort column too and neither has to re-sort in memory.
CREATE INDEX "order_issues_tenant_id_status_updatedAt_idx"
  ON "order_issues"("tenant_id", "status", "updatedAt");

-- One turn in the conversation.
--
-- `author_user_id` is a PLAIN reference to users.id, deliberately without a
-- foreign key: a staff account that leaves must not cascade away the reply
-- they wrote, and the id is only ever used to say who answered.
--
-- `photo_key` is an image-storage key (`{tenant_id}/issues/{uuid}`), never a
-- URL. The bytes are served exclusively by the token-gated photo route with
-- `Cache-Control: private, no-store` — NOT by `/img`, which is public and
-- immutable-cached and would leak a guest's photo to anyone with the key.
CREATE TABLE "order_issue_messages" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "issue_id"       TEXT NOT NULL,
  "author"         TEXT NOT NULL,
  "author_user_id" TEXT,
  "body"           TEXT NOT NULL,
  "photo_key"      TEXT,
  "photo_type"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_issue_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_issue_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_issue_messages_issue_id_fkey" FOREIGN KEY ("issue_id")
    REFERENCES "order_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_issue_messages_author_check"
    CHECK ("author" IN ('guest', 'restaurant'))
);

CREATE INDEX "order_issue_messages_tenant_id_idx" ON "order_issue_messages"("tenant_id");
-- Every read of a thread is "its messages, oldest first".
CREATE INDEX "order_issue_messages_issue_id_createdAt_idx"
  ON "order_issue_messages"("issue_id", "createdAt");

-- Same tenant-isolation posture as every other tenant table (loyalty,
-- reservations, customers): RLS on AND forced, so the GUC `asTenant` sets is
-- the only thing that makes a row visible — even to the table owner.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_issues','order_issue_messages'] LOOP
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

-- New tables are NOT covered by the ALTER DEFAULT PRIVILEGES in
-- prisma/dev-roles.sql (those apply only to tables created by the role that
-- set them), so every migration that adds a table grants them too. Guarded
-- on the role existing, like the webhook_events grants: production runs
-- RLS-off with the app connected as the database owner, where elvoria_app is
-- absent and a bare GRANT would abort `prisma migrate deploy`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "order_issues", "order_issue_messages" TO elvoria_app;
  END IF;
END
$$;
