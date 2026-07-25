-- Category photos: same Media-backed pattern items use (photo_media_id
-- nullable FK, SET NULL on media delete so a category never dangles).
--
-- NOTE: `prisma migrate dev` also wanted to "fix" the audit_events /
-- scan_stats primary keys — that drift is intentional (they are
-- partitioned tables authored in raw SQL; a partitioned PK must include
-- the partition column, which Prisma's model can't express). Those
-- statements were removed by hand. Do not re-add them.

-- AlterTable
ALTER TABLE "categories" ADD COLUMN "photo_media_id" TEXT;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_photo_media_id_fkey" FOREIGN KEY ("photo_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
