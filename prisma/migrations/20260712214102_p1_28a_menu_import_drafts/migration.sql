-- CreateEnum
CREATE TYPE "MenuImportStatus" AS ENUM ('queued', 'extracting', 'ready', 'failed', 'discarded');

-- DropForeignKey
ALTER TABLE "email_verification_tokens" DROP CONSTRAINT "email_verification_tokens_user_id_fkey";

-- DropForeignKey
ALTER TABLE "items" DROP CONSTRAINT "items_photo_media_id_fkey";

-- DropForeignKey
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_user_id_fkey";

-- CreateTable
CREATE TABLE "menu_import_drafts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "source_media_id" TEXT NOT NULL,
    "status" "MenuImportStatus" NOT NULL DEFAULT 'queued',
    "extracted_payload" JSONB,
    "error_text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_import_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_import_drafts_tenant_id_idx" ON "menu_import_drafts"("tenant_id");

-- CreateIndex
CREATE INDEX "menu_import_drafts_venue_id_idx" ON "menu_import_drafts"("venue_id");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_photo_media_id_fkey" FOREIGN KEY ("photo_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_import_drafts" ADD CONSTRAINT "menu_import_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_import_drafts" ADD CONSTRAINT "menu_import_drafts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_import_drafts" ADD CONSTRAINT "menu_import_drafts_source_media_id_fkey" FOREIGN KEY ("source_media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "subscriptions_tenant_id_active" RENAME TO "subscriptions_tenant_id_key";

-- P1-28a: RLS on the new tenant-scoped table. Same policy shape as every
-- other `tenant_id` table (see 20260711215814_rls_policies): scope to the
-- session's `app.current_tenant_id`, and FORCE so a missing GUC denies
-- rows even for the table owner.
ALTER TABLE "menu_import_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_import_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "menu_import_drafts"
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
