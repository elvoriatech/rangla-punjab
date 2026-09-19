-- items.source_item_id — the link from a PUBLISHED item back to the DRAFT
-- item it was deep-copied from at publish time.
--
-- Why it exists: guests read the published version, the dashboard edits the
-- draft, and publishing is an explicit act. That is right for "rewrite the
-- menu", and wrong for "we've run out of dal" — the owner tapping a switch in
-- the restaurant's app expects the guest menu to change NOW. With this column
-- an app edit can resolve the PAIR (draft row + its published copy) and write
-- both in one transaction, so the change is live without a publish and the
-- next publish does not silently undo it.
--
-- Direction is always published -> draft: the copy points at its source. Draft
-- rows keep NULL. `publishDraft` sets it on every copy it creates, and
-- `ensureDraft` (which forks a draft FROM the published version when a venue
-- has none) back-fills it onto the published rows it just copied.

ALTER TABLE "items" ADD COLUMN "source_item_id" TEXT;

CREATE INDEX "items_source_item_id_idx" ON "items"("source_item_id");

-- ---------------------------------------------------------------------------
-- Backfill for menus that are already published.
--
-- Nothing recorded the pairing before this column, so it is reconstructed
-- positionally. The rule, in order:
--
--   1. Pair the current published version with the menu's newest draft.
--   2. Pair their categories by `order_index` — the snapshot renumbers with a
--      100-unit gap and no ties, so position is a faithful key. A published
--      category whose `order_index` matches zero or several draft categories
--      is skipped entirely.
--   3. Inside a paired category, match items on (name, order_index).
--   4. FALLBACK: for published items rule 3 left unmatched (the draft was
--      reordered since the last publish), match on `name` alone.
--
-- Both item rules require the match to be unique in BOTH directions. Anything
-- ambiguous — two dishes with the same name in one category, a category whose
-- items were rewritten wholesale — is left NULL on purpose. A NULL simply
-- means the app's edit updates one row and reports `mirrored: false`; a WRONG
-- pairing would make an owner's "sold out" tap hide a different dish, which is
-- far worse than not mirroring at all. The next publish repairs every row it
-- touches, so this is self-healing.
--
-- `items`/`categories`/`menus`/`menu_versions` are FORCE ROW LEVEL SECURITY
-- and this statement runs with no `app.current_tenant_id`, which would make
-- the backfill a silent no-op for a non-superuser owner. NO FORCE is lifted
-- for the duration and restored immediately after; the policies themselves are
-- never touched.
-- ---------------------------------------------------------------------------

ALTER TABLE "items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "categories" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "menus" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "menu_versions" NO FORCE ROW LEVEL SECURITY;

-- Rule 3: exact (name, order_index) match.
WITH version_pairs AS (
  SELECT m."published_version" AS pub_version, d."id" AS draft_version
    FROM "menus" m
    JOIN LATERAL (
      SELECT v."id"
        FROM "menu_versions" v
       WHERE v."menu_id" = m."id" AND v."status" = 'draft'
       ORDER BY v."createdAt" DESC
       LIMIT 1
    ) d ON TRUE
   WHERE m."published_version" IS NOT NULL
),
category_pairs AS (
  SELECT pub_cat, draft_cat FROM (
    SELECT pc."id" AS pub_cat,
           dc."id" AS draft_cat,
           count(*) OVER (PARTITION BY pc."id") AS pub_hits,
           count(*) OVER (PARTITION BY dc."id") AS draft_hits
      FROM version_pairs vp
      JOIN "categories" pc ON pc."menu_version_id" = vp.pub_version
      JOIN "categories" dc ON dc."menu_version_id" = vp.draft_version
                          AND dc."order_index" = pc."order_index"
  ) c
  WHERE pub_hits = 1 AND draft_hits = 1
),
candidates AS (
  SELECT pi."id" AS pub_item,
         di."id" AS draft_item,
         count(*) OVER (PARTITION BY pi."id") AS pub_hits,
         count(*) OVER (PARTITION BY di."id") AS draft_hits
    FROM category_pairs cp
    JOIN "items" pi ON pi."category_id" = cp.pub_cat AND pi."deleted_at" IS NULL
    JOIN "items" di ON di."category_id" = cp.draft_cat AND di."deleted_at" IS NULL
                   AND di."name" = pi."name"
                   AND di."order_index" = pi."order_index"
)
UPDATE "items" t
   SET "source_item_id" = c.draft_item
  FROM candidates c
 WHERE t."id" = c.pub_item
   AND c.pub_hits = 1
   AND c.draft_hits = 1;

-- Rule 4: name-only fallback for whatever rule 3 could not pair.
WITH version_pairs AS (
  SELECT m."published_version" AS pub_version, d."id" AS draft_version
    FROM "menus" m
    JOIN LATERAL (
      SELECT v."id"
        FROM "menu_versions" v
       WHERE v."menu_id" = m."id" AND v."status" = 'draft'
       ORDER BY v."createdAt" DESC
       LIMIT 1
    ) d ON TRUE
   WHERE m."published_version" IS NOT NULL
),
category_pairs AS (
  SELECT pub_cat, draft_cat FROM (
    SELECT pc."id" AS pub_cat,
           dc."id" AS draft_cat,
           count(*) OVER (PARTITION BY pc."id") AS pub_hits,
           count(*) OVER (PARTITION BY dc."id") AS draft_hits
      FROM version_pairs vp
      JOIN "categories" pc ON pc."menu_version_id" = vp.pub_version
      JOIN "categories" dc ON dc."menu_version_id" = vp.draft_version
                          AND dc."order_index" = pc."order_index"
  ) c
  WHERE pub_hits = 1 AND draft_hits = 1
),
candidates AS (
  SELECT pi."id" AS pub_item,
         di."id" AS draft_item,
         count(*) OVER (PARTITION BY pi."id") AS pub_hits,
         count(*) OVER (PARTITION BY di."id") AS draft_hits
    FROM category_pairs cp
    JOIN "items" pi ON pi."category_id" = cp.pub_cat
                   AND pi."deleted_at" IS NULL
                   AND pi."source_item_id" IS NULL
    JOIN "items" di ON di."category_id" = cp.draft_cat
                   AND di."deleted_at" IS NULL
                   AND di."name" = pi."name"
                   AND di."id" NOT IN (
                     SELECT x."source_item_id" FROM "items" x
                      WHERE x."source_item_id" IS NOT NULL
                   )
)
UPDATE "items" t
   SET "source_item_id" = c.draft_item
  FROM candidates c
 WHERE t."id" = c.pub_item
   AND c.pub_hits = 1
   AND c.draft_hits = 1;

ALTER TABLE "items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
ALTER TABLE "menus" FORCE ROW LEVEL SECURITY;
ALTER TABLE "menu_versions" FORCE ROW LEVEL SECURITY;
