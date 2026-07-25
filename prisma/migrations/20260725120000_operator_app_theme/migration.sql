-- Active app theme id for the operator's deploy. NULL ⇒ default theme.
-- Additive + nullable; existing deploys keep the default look.
ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "app_theme" TEXT; -- migration:safe
