-- Inline-marker case: the specific ALTER TYPE line is grandfathered
-- because the new type is a superset of the old — no data-fill needed
-- and no risk to existing rows. The trailing comment tells the checker.
ALTER TABLE "widgets" ALTER COLUMN "name" TYPE citext; -- migration:safe (widening)
