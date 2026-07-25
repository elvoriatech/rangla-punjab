-- Contract step: previous migration (03) carries the whole-file
-- expand-contract marker, so this SET NOT NULL passes the checker.
ALTER TABLE "widgets" ALTER COLUMN "priority" SET NOT NULL;
