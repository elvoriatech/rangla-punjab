-- Optional runtime overrides for the email seam (P: single-restaurant ops).
-- Both columns are nullable; NULL means "fall back to the env value"
-- (EMAIL_TRANSPORT / EMAIL_FROM), so existing deploys are unaffected until
-- an operator sets them from the Operator Console. Additive only.
ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "email_transport" TEXT; -- migration:safe
ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "email_from" TEXT; -- migration:safe
