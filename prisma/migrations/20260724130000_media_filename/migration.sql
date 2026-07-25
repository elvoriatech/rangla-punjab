-- Bulk-import join key: the original upload filename, so re-uploading the
-- same name replaces the image and Excel rows can reference photos by name.
-- Nullable + additive; existing rows keep NULL.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "filename" TEXT; -- migration:safe
CREATE INDEX IF NOT EXISTS "media_tenant_id_filename_idx" ON "media" ("tenant_id", "filename"); -- migration:safe
