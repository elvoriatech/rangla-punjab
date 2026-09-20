-- Gift cards, round one: sell, hold, redeem.
--
-- A gift card is a BEARER instrument, which is the one thing that makes
-- it unlike every other row in this schema. The loyalty voucher it is
-- modelled on is addressed by cuid and welded to a `customer_id`; a gift
-- card is meant to be handed to someone else, so it is addressed by a
-- short human-typable `code` and its purchaser is a provenance record,
-- not a permission. Everything downstream follows from that: the code is
-- UNIQUE globally (not per tenant — a cashier types a code, not a code
-- plus a tenant), it is drawn from a CSPRNG, and holding it is what
-- authorises spending it.
--
-- LEGAL (DE): these are multi-purpose vouchers (Mehrzweckgutschein,
-- § 3 Abs. 14 UStG) — VAT falls due at REDEMPTION, not at sale. That is
-- why `redeemed_at` and `redeemed_order_id` exist as first-class columns
-- and why the dashboard report keys off them: the accountant needs the
-- redemption dates. Expiry defaults to 36 months (§ 195 BGB) and the
-- owner's switch lives in venues.gift_cards (src/lib/gift-card-config.ts).

-- Owner-side gift-card switches. Unlike `loyalty`, the default parses to
-- ON — a gift card is a product the owner asked for, and the per-product
-- `active` flag is the finer gate.
ALTER TABLE "venues" ADD COLUMN "gift_cards" JSONB NOT NULL DEFAULT '{}';

-- A gift card can pay for an in-app order, so the order carries the same
-- pair of columns the loyalty voucher already has. Separate from
-- `discount_cents`/`voucher_id` on purpose: a guest may hold a reward
-- voucher AND a gift card, the two stack, and the receipt has to be able
-- to name each line. Plain reference, no FK, like `voucher_id` — the
-- order is a financial record and must outlive the card row.
ALTER TABLE "orders" ADD COLUMN "gift_card_discount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "gift_card_id" TEXT;
-- The last four characters of the code, denormalised for exactly the
-- reason `discount_points` is: eight separate surfaces render the line
-- "Gift card ····1234 · −€20" off the ORDER, `gift_card_id` is a plain
-- reference with no relation to join through, and printing the WHOLE
-- bearer code on a kitchen ticket or in an accountant's CSV would hand
-- it to everyone who can see the pass. Four characters identify the card
-- to the guest holding it and are worthless to anyone who is not.
ALTER TABLE "orders" ADD COLUMN "gift_card_last4" TEXT;

-- The three sellable designs per venue. Owner-editable name + price, so
-- no translations: the owner writes the name in their own words and it
-- is shown verbatim in all six UI languages.
CREATE TABLE "gift_card_products" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "venue_id"    TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "price_cents" INTEGER NOT NULL,
  -- Either a `media.storage_key` (owner upload, served by /img/[key]) or
  -- one of the shipped defaults under /brand/gift-cards/. Distinguished
  -- by the leading slash — see giftCardImageUrl() in gift-card-service.ts.
  "image_key"   TEXT,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "sort_index"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "gift_card_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gift_card_products_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gift_card_products_venue_id_fkey" FOREIGN KEY ("venue_id")
    REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gift_card_products_price_cents_check" CHECK ("price_cents" > 0)
);
CREATE INDEX "gift_card_products_tenant_id_venue_id_idx"
  ON "gift_card_products"("tenant_id", "venue_id");
-- A venue has exactly three designs, at slots 0/1/2. Making the slot
-- unique is what lets seeding be an idempotent `createMany(…,
-- skipDuplicates)` instead of a count-then-insert that two concurrent
-- first-page-loads could both win. Partial on the soft delete so a
-- retired design does not hold its slot hostage.
CREATE UNIQUE INDEX "gift_card_products_venue_id_sort_index_key"
  ON "gift_card_products"("venue_id", "sort_index")
  WHERE "deleted_at" IS NULL;

-- One sold card.
--
-- `status` is a plain string with a CHECK, like every other status column
-- here, so a later 'cancelled' is an ALTER and not a type migration:
--   pending_payment → active → redeemed | expired | refunded
-- `pending_payment` rows are born before the guest reaches the payment
-- sheet and are activated by the webhook, exactly like an order.
--
-- Expiry is applied LAZILY on read/redeem (never by a cron nobody
-- watches) — same posture as loyalty_vouchers.
CREATE TABLE "gift_cards" (
  "id"                    TEXT NOT NULL,
  "tenant_id"             TEXT NOT NULL,
  "venue_id"              TEXT NOT NULL,
  -- Nullable so an owner deleting a retired design never destroys the
  -- financial record of the cards sold under it.
  "product_id"            TEXT,
  -- 12 Crockford-base32 characters, stored undashed and uppercase.
  -- Globally unique: the counter-redeem lookup is by code alone.
  "code"                  TEXT NOT NULL,
  "purchaser_customer_id" TEXT NOT NULL,
  "recipient_name"        TEXT,
  "message"               TEXT,
  "value_cents"           INTEGER NOT NULL,
  "currency"              TEXT NOT NULL,
  "status"                TEXT NOT NULL DEFAULT 'pending_payment',
  "payment_provider"      TEXT,
  "payment_ref"           TEXT,
  "paid_at"               TIMESTAMP(3),
  -- NULL until paid: an unpaid card has no clock running.
  "expires_at"            TIMESTAMP(3),
  -- The first time anyone opened the share link. Drives the "shared"
  -- step of the timeline the guest and the dashboard both show; it is
  -- evidence the card reached someone, not a permission of any kind.
  "shared_at"             TIMESTAMP(3),
  "redeemed_at"           TIMESTAMP(3),
  -- Exactly one of these two is set on redemption: a staff user (counter)
  -- or an order (spent in the app cart). Plain references, no FK.
  "redeemed_by_user_id"   TEXT,
  "redeemed_order_id"     TEXT,
  "redeemed_note"         TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gift_cards_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gift_cards_venue_id_fkey" FOREIGN KEY ("venue_id")
    REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gift_cards_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "gift_card_products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "gift_cards_purchaser_customer_id_fkey" FOREIGN KEY ("purchaser_customer_id")
    REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gift_cards_status_check"
    CHECK ("status" IN ('pending_payment', 'active', 'redeemed', 'expired', 'refunded')),
  CONSTRAINT "gift_cards_value_cents_check" CHECK ("value_cents" > 0)
);
CREATE UNIQUE INDEX "gift_cards_code_key" ON "gift_cards"("code");
CREATE INDEX "gift_cards_tenant_id_purchaser_customer_id_idx"
  ON "gift_cards"("tenant_id", "purchaser_customer_id");
-- The dashboard list filters by status and sorts by purchase date.
CREATE INDEX "gift_cards_tenant_id_venue_id_status_idx"
  ON "gift_cards"("tenant_id", "venue_id", "status");
-- Webhook settlement resolves a card from the provider's payment ref.
CREATE INDEX "gift_cards_payment_ref_idx" ON "gift_cards"("payment_ref");

-- Same tenant-isolation posture as every other tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gift_card_products','gift_cards'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
      || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
      t
    );
  END LOOP;
END $$;

-- New tables are NOT covered by the ALTER DEFAULT PRIVILEGES in
-- prisma/dev-roles.sql, so grant explicitly. Guarded on the role
-- existing: production runs with the app connected as the database
-- owner, where elvoria_app is absent and a bare GRANT would abort
-- `prisma migrate deploy`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elvoria_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "gift_card_products", "gift_cards" TO elvoria_app;
  END IF;
END
$$;
