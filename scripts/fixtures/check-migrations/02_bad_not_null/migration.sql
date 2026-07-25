-- Fixture: adds NOT NULL to an existing column with no expand-contract
-- predecessor and no inline marker. The checker MUST reject this.
ALTER TABLE "widgets" ALTER COLUMN "name" SET NOT NULL;
