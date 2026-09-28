-- DAYS-1: the weekdays a dish is on the menu. Monday-first indexes into
-- opening-hours' WEEKDAYS (0 = Monday … 6 = Sunday), the same convention as
-- `offer_weekly.days`. Default = every day, so every existing dish keeps
-- showing exactly as before.
--
-- Lives ON `items` for the same reason offers do: publish deep-copies the
-- draft tree with fresh ids. Tenant-scoped FORCE-RLS already covers the row;
-- adding a column changes no policy. Pure DDL.

ALTER TABLE "items"
  ADD COLUMN "available_days" INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6];

-- At least one day, and only real weekdays. "No day at all" is what the
-- Available switch is for; the dashboard refuses it, the DB is the wall a
-- forged write hits.
ALTER TABLE "items"
  ADD CONSTRAINT "items_available_days_check"
  CHECK (cardinality("available_days") BETWEEN 1 AND 7
         AND "available_days" <@ ARRAY[0,1,2,3,4,5,6]);
