-- migration:expand-contract
-- Expand step: add the new column as NULLable, backfill existing rows.
-- The whole-file marker at the top tells the checker that the NEXT
-- migration (04) may safely contract this column to NOT NULL.
ALTER TABLE "widgets" ADD COLUMN "priority" INT;
UPDATE "widgets" SET "priority" = 0 WHERE "priority" IS NULL;
