-- Team accounts (owner, 2026-09-30): the owner creates a login for a
-- manager or a staff member and ticks what they may open. The `staff`
-- role has existed since the start but was never checked; this adds the
-- ticked areas and the owner's label for the person. Owners ignore
-- `permissions` (they have everything), so existing rows need no backfill.
ALTER TABLE "memberships" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "memberships" ADD COLUMN "display_name" TEXT;
