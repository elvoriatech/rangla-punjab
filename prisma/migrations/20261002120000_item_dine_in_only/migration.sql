-- Dine-in only (owner, 2026-10-02): some dishes are served at the table
-- and never packed. The menu shows them with a label instead of the add
-- button, and a pickup or delivery order containing one is refused.
ALTER TABLE "items" ADD COLUMN "dine_in_only" BOOLEAN NOT NULL DEFAULT false;
