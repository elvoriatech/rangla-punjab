-- OFFER-1: restaurant offers ("Angebot") — a reduced fixed item price, valid
-- inside an optional date range and/or an optional weekly venue-local window.
--
-- The offer lives ON `items`: publish deep-copies the draft tree with fresh
-- ids on every publish, so a separate offers table keyed on item id would
-- dangle after the next publish. Riding the item row means offers flow through
-- draft → preview → publish → CDN purge with zero new machinery.
--
-- `order_items.base_price_cents` is the OFFER-3 snapshot: `price_cents` stays
-- "what was charged", base is the regular price it was reduced from. NULL =
-- no offer applied. This is the invariant that keeps receipts immutable when
-- an offer is later edited or removed.
--
-- Both tables are already tenant-scoped FORCE-RLS; adding columns changes no
-- policy. Pure DDL — no NO FORCE toggle needed (that rule is for data writes).

ALTER TABLE "items"
  ADD COLUMN "offer_price_cents" INTEGER,
  ADD COLUMN "offer_starts_at" TIMESTAMPTZ(6),
  ADD COLUMN "offer_ends_at" TIMESTAMPTZ(6),
  ADD COLUMN "offer_weekly" JSONB;

-- An offer must be a genuine reduction: positive, and strictly below the
-- regular price. Equal-or-above is a data-entry error the dashboard also
-- refuses; the DB is the wall a forged write hits.
ALTER TABLE "items"
  ADD CONSTRAINT "items_offer_price_check"
  CHECK ("offer_price_cents" IS NULL
         OR ("offer_price_cents" > 0 AND "offer_price_cents" < "price_cents"));

ALTER TABLE "order_items"
  ADD COLUMN "base_price_cents" INTEGER;

-- When a base price is recorded, it is the price the charge was reduced FROM —
-- so it must exceed what was charged. NULL is the everyday no-offer case.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_base_price_check"
  CHECK ("base_price_cents" IS NULL OR "base_price_cents" > "price_cents");
