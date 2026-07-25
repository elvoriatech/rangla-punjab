-- Remove the AI menu-import feature (dropped in the single-restaurant
-- simplification). DROP TABLE cascades the table's own FK constraints;
-- the enum type is then unused and dropped too.
DROP TABLE IF EXISTS "menu_import_drafts"; -- migration:safe
DROP TYPE IF EXISTS "MenuImportStatus"; -- migration:safe
