-- P1-6: soft-delete + photo reference on items.
--
-- `deleted_at` is the CLAUDE.md soft-delete convention; the item service
-- filters on `deletedAt IS NULL` everywhere. `photo_media_id` points at
-- `media.id` — set NULL on delete so deleting the source media doesn't
-- orphan the item, it just drops the picture. Real upload wires through
-- in P1-14 (signed S3 presign); the column exists now so items can carry
-- a photo the moment the pipeline lands.

ALTER TABLE "items" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "items" ADD COLUMN "photo_media_id" TEXT;

ALTER TABLE "items"
  ADD CONSTRAINT "items_photo_media_id_fkey"
  FOREIGN KEY ("photo_media_id") REFERENCES "media"("id") ON DELETE SET NULL;
