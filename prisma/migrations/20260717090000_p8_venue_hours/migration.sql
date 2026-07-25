-- P8: per-venue opening hours. Stored as JSONB on the venue (same
-- pattern as branding/ordering) — always read as one unit, never
-- queried across restaurants. Canonical shape is a 7-entry array
-- (see src/lib/opening-hours.ts); the settings UI compiles its simple
-- input down to that. Empty {} = "hours not set", rendered as no badge.
ALTER TABLE venues ADD COLUMN hours jsonb NOT NULL DEFAULT '{}';
