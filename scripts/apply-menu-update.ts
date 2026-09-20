import { readFileSync } from "node:fs";
import path from "node:path";
import type { Allergen, Dietary, Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../src/lib/db";
import { asTenant } from "../src/lib/tenant";
import { ensureDraftForTenant, publishDraft } from "../src/lib/menu-versions-service";
import { purgeMenuForTenant } from "../src/lib/cdn-purge";

/**
 * Apply a transcribed printed menu (`scripts/data/rangla-menu-2026-09.json`)
 * to a venue's DRAFT menu version, then optionally publish it.
 *
 *   pnpm exec tsx --env-file=.env scripts/apply-menu-update.ts \
 *     rangla-punjab scripts/data/rangla-menu-2026-09.json [--dry-run] [--publish]
 *
 * Flags
 *   --dry-run            print the full plan, write nothing, do not purge
 *   --publish            publish the draft afterwards (same path as the dashboard)
 *   --refresh-draft      throw the current draft away and re-fork it from the
 *                        published version first. Use when the draft has drifted
 *                        (the script warns when it detects drift) — a stale draft
 *                        is how dish PHOTOS get lost, because matching happens
 *                        against the draft rows.
 *   --allergens=replace  (default) the printed card is the declaration of
 *                        record: an item ends up with exactly the allergens its
 *                        footnotes code, and anything the card does not code is
 *                        dropped. The card omits codes that the previous record
 *                        carried on 25 dishes — the owner reviewed that list
 *                        (rangla-menu-diff.md) and confirmed the card is right.
 *   --allergens=union    opt-in: add what the card codes but never drop an
 *                        existing declaration. Use when applying a card that has
 *                        NOT been reviewed dish by dish, so a missing footnote
 *                        cannot quietly remove a warning a guest relies on.
 *   --prune-categories   hard-delete draft categories the new menu no longer has
 *                        (off by default; they are reported instead).
 *
 * WHAT IT DOES. Everything runs against the draft, exactly like the menu
 * editor in the dashboard:
 *
 *   • categories are matched by explicit `matchNames`, then by normalised name
 *     (case, umlauts, „Groß/Gross“, punctuation); matched ones are renamed and
 *     reordered in place, missing ones are created.
 *   • items are matched inside their matched category the same way, plus a
 *     third pass that REVIVES a previously soft-deleted row with that name.
 *     A matched item keeps its `id`, its `photoMediaId`, its variants and any
 *     running offer — only name/description/price/allergens/traces/dietary/
 *     spice/order are rewritten. That is what keeps the dish photos.
 *   • items the printed card no longer has are soft-deleted (`deletedAt`), the
 *     same mechanism as `softDeleteItem` in src/lib/items-service.ts.
 *   • `--publish` calls `publishDraft` for a tenant owner, so translations and
 *     photos are deep-copied onto the fresh published version, then the CDN is
 *     purged through `purgeMenuForTenant`.
 *
 * Idempotent: a second run reports "no changes".
 */

const ORDER_STEP = 100;

// ---------------------------------------------------------------- input file

interface NewItem {
  id: string;
  number: number | null;
  name: string;
  description: string | null;
  priceCents: number;
  allergens: string[];
  traces: string[];
  dietary: string[];
  spice: number;
  matchNames?: string[];
}
interface NewCategory {
  id: string;
  name: string;
  notes?: string;
  matchNames?: string[];
  items: NewItem[];
}
interface NewMenu {
  venueSlug?: string;
  categories: NewCategory[];
}

type AllergenMode = "union" | "replace";

/** Normalised key used for every name match. */
export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

// ----------------------------------------------------------------- matching

interface DraftItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  orderIndex: number;
  isAvailable: boolean;
  allergens: Allergen[];
  traces: Allergen[];
  dietary: Dietary[];
  spice: number;
  photoMediaId: string | null;
  offerPriceCents: number | null;
  deletedAt: Date | null;
}
interface DraftCategory {
  id: string;
  name: string;
  orderIndex: number;
  items: DraftItem[];
}

/** First-come-first-served pool of draft rows keyed by normalised name. */
class NamePool<T extends { name: string }> {
  private readonly byName = new Map<string, T[]>();
  constructor(rows: T[]) {
    for (const row of rows) {
      const key = normaliseName(row.name);
      const list = this.byName.get(key);
      if (list) list.push(row);
      else this.byName.set(key, [row]);
    }
  }
  take(candidates: string[]): T | null {
    for (const candidate of candidates) {
      const list = this.byName.get(normaliseName(candidate));
      if (list && list.length > 0) return list.shift() ?? null;
    }
    return null;
  }
  rest(): T[] {
    return [...this.byName.values()].flat();
  }
}

interface ItemPlan {
  kind: "update" | "create" | "revive";
  category: string;
  newItem: NewItem;
  draft?: DraftItem;
  changes: string[];
  data: {
    name: string;
    description: string | null;
    priceCents: number;
    allergens: Allergen[];
    traces: Allergen[];
    dietary: Dietary[];
    spice: number;
    orderIndex: number;
    isAvailable: boolean;
  };
}
interface CategoryPlan {
  kind: "update" | "create";
  newCategory: NewCategory;
  draft?: DraftCategory;
  renamedFrom?: string;
  reordered: boolean;
}
interface Plan {
  categories: CategoryPlan[];
  items: ItemPlan[];
  softDeletes: { id: string; category: string; name: string; priceCents: number }[];
  orphanCategories: DraftCategory[];
  warnings: string[];
}

interface Wanted {
  key: string;
  name: string;
  matchNames: string[];
}

/**
 * Pair the entries the new menu wants against the rows the draft still has.
 *
 * Three passes, and the order is what makes a re-run a no-op:
 *
 *  1. an entry whose own name NOBODY ELSE claims via `matchNames` takes the
 *     draft row of that name — this is the common case and it is stable.
 *  2. explicit `matchNames`, which is how a rename finds its predecessor:
 *     "Bier alkoholfrei" claims the old "Bier" category (and its dish photos).
 *  3. the contested names that are left, so the *new* alcoholic "Bier" can
 *     take a row called "Bier" once nothing older wants it.
 *
 * Doing 2 before 1 would be wrong the second time round: "Bier alkoholfrei"
 * would grab the alcoholic "Bier" category its own first run had created,
 * and the two would swap contents on every run.
 */
function resolveMatches<T extends { name: string }>(
  wanted: Wanted[],
  pool: NamePool<T>,
): Map<string, T> {
  const contested = new Set(wanted.flatMap((w) => w.matchNames.map((m) => normaliseName(m))));
  const out = new Map<string, T>();
  const claim = (w: Wanted, candidates: string[]): void => {
    if (out.has(w.key)) return;
    const hit = pool.take(candidates);
    if (hit) out.set(w.key, hit);
  };
  for (const w of wanted) if (!contested.has(normaliseName(w.name))) claim(w, [w.name]);
  for (const w of wanted) claim(w, w.matchNames);
  for (const w of wanted) claim(w, [w.name]);
  return out;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((x, i) => x === sorted[i]);
}

export function buildPlan(
  menu: NewMenu,
  draft: DraftCategory[],
  mode: AllergenMode = "replace",
): Plan {
  const plan: Plan = {
    categories: [],
    items: [],
    softDeletes: [],
    orphanCategories: [],
    warnings: [],
  };
  const pool = new NamePool(draft);
  const claimed = resolveMatches(
    menu.categories.map((c) => ({ key: c.id, name: c.name, matchNames: c.matchNames ?? [] })),
    pool,
  );
  plan.orphanCategories = pool.rest();

  menu.categories.forEach((cat, ci) => {
    const target = claimed.get(cat.id);
    const orderIndex = (ci + 1) * ORDER_STEP;
    if (!target) {
      plan.categories.push({ kind: "create", newCategory: cat, reordered: false });
    } else {
      plan.categories.push({
        kind: "update",
        newCategory: cat,
        draft: target,
        renamedFrom: target.name === cat.name ? undefined : target.name,
        reordered: target.orderIndex !== orderIndex,
      });
    }

    const live = new NamePool((target?.items ?? []).filter((i) => i.deletedAt === null));
    const dead = new NamePool((target?.items ?? []).filter((i) => i.deletedAt !== null));
    const wanted = cat.items.map((i) => ({
      key: i.id,
      name: i.name,
      matchNames: i.matchNames ?? [],
    }));
    const liveMatch = resolveMatches(wanted, live);
    // Second look among the rows a previous run soft-deleted: reviving one
    // keeps its photo and its translations instead of creating a twin.
    const deadMatch = resolveMatches(
      wanted.filter((w) => !liveMatch.has(w.key)),
      dead,
    );

    cat.items.forEach((item, ii) => {
      const row = liveMatch.get(item.id) ?? deadMatch.get(item.id);
      const kind: ItemPlan["kind"] = !row ? "create" : liveMatch.has(item.id) ? "update" : "revive";
      // "replace" (the default) makes the printed card the declaration of
      // record — what it does not code, the dish does not carry. "union" only
      // ever adds, for a card nobody has reviewed dish by dish yet.
      const allergens =
        mode === "replace" || !row
          ? (item.allergens as Allergen[])
          : ([...new Set([...row.allergens, ...item.allergens])] as Allergen[]);
      const data = {
        name: item.name,
        description: item.description,
        priceCents: item.priceCents,
        allergens,
        traces: item.traces as Allergen[],
        dietary: item.dietary as Dietary[],
        spice: item.spice,
        orderIndex: (ii + 1) * ORDER_STEP,
        isAvailable: true,
      };
      const changes: string[] = [];
      if (row) {
        if (row.name !== data.name) changes.push(`name "${row.name}" → "${data.name}"`);
        if ((row.description ?? null) !== data.description) changes.push("description");
        if (row.priceCents !== data.priceCents)
          changes.push(`price ${row.priceCents} → ${data.priceCents}`);
        if (!sameSet(row.allergens, data.allergens))
          changes.push(`allergens [${row.allergens.join(",")}] → [${data.allergens.join(",")}]`);
        if (!sameSet(row.traces, data.traces)) changes.push("traces");
        if (!sameSet(row.dietary, data.dietary))
          changes.push(`dietary [${row.dietary.join(",")}] → [${data.dietary.join(",")}]`);
        if (row.spice !== data.spice) changes.push(`spice ${row.spice} → ${data.spice}`);
        if (row.orderIndex !== data.orderIndex) changes.push("order");
        if (!row.isAvailable) changes.push("back on sale");
        if (kind === "revive") changes.push("un-deleted");
        // A running offer must stay strictly below the (new) list price, or
        // the items_offer_below_price CHECK rejects the write.
        if (row.offerPriceCents !== null && row.offerPriceCents >= data.priceCents) {
          plan.warnings.push(
            `"${item.name}" has a running offer of ${row.offerPriceCents} cents which is not below ` +
              `the new price of ${data.priceCents} — clear the offer in the dashboard first`,
          );
        }
      }
      if (kind !== "update" || changes.length > 0) {
        plan.items.push({
          kind,
          category: cat.name,
          newItem: item,
          draft: row ?? undefined,
          changes,
          data,
        });
      }
    });

    for (const leftover of live.rest()) {
      plan.softDeletes.push({
        id: leftover.id,
        category: target?.name ?? cat.name,
        name: leftover.name,
        priceCents: leftover.priceCents,
      });
    }
  });

  return plan;
}

// ------------------------------------------------------------------ plumbing

interface VenueRow {
  id: string;
  tenantId: string;
  slug: string;
  enabledLocales: string[];
}

/**
 * `asTenant` with a transaction timeout. Identical semantics — the RLS GUC is
 * set transaction-locally with the tenant id bound as a parameter — but the
 * 200-odd writes this script makes in one go do not fit in Prisma's 5-second
 * default, and `asTenant` takes no options.
 */
function asTenantSlow<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    { timeout: 180_000, maxWait: 30_000 },
  );
}

/** Same two-step resolve as scripts/import-menu-translations.ts. */
async function resolveVenue(slug: string): Promise<VenueRow> {
  const sql = `
    SELECT id, tenant_id AS "tenantId", slug, enabled_locales AS "enabledLocales"
    FROM venues WHERE slug = $1 AND "deletedAt" IS NULL LIMIT 1`;
  const direct = await prisma.$queryRawUnsafe<VenueRow[]>(sql, slug);
  if (direct[0]) return direct[0];

  const operatorUrl = process.env.DATABASE_URL;
  if (!operatorUrl) {
    throw new Error(`venue "${slug}" not visible on APP_DATABASE_URL and DATABASE_URL is not set`);
  }
  const operator = new PrismaClient({ adapter: new PrismaPg({ connectionString: operatorUrl }) });
  try {
    const rows = await operator.$queryRawUnsafe<VenueRow[]>(sql, slug);
    if (!rows[0]) throw new Error(`no venue with slug "${slug}"`);
    return rows[0];
  } finally {
    await operator.$disconnect();
  }
}

const draftSelect = {
  id: true,
  name: true,
  orderIndex: true,
  items: {
    select: {
      id: true,
      name: true,
      description: true,
      priceCents: true,
      orderIndex: true,
      isAvailable: true,
      allergens: true,
      traces: true,
      dietary: true,
      spice: true,
      photoMediaId: true,
      offerPriceCents: true,
      deletedAt: true,
    },
    orderBy: { orderIndex: "asc" },
  },
} satisfies Prisma.CategorySelect;

async function loadDraft(
  tx: Prisma.TransactionClient,
  menuId: string,
): Promise<{ id: string; categories: DraftCategory[] } | null> {
  const draft = await tx.menuVersion.findFirst({
    where: { menuId, status: "draft" },
    orderBy: { createdAt: "desc" },
    select: { id: true, categories: { select: draftSelect, orderBy: { orderIndex: "asc" } } },
  });
  return draft;
}

function summarise(categories: DraftCategory[]): string[] {
  return categories
    .flatMap((c) => c.items.filter((i) => i.deletedAt === null).map((i) => `${c.name}/${i.name}`))
    .sort();
}

// ---------------------------------------------------------------------- main

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const doPublish = args.includes("--publish");
  const refreshDraft = args.includes("--refresh-draft");
  const pruneCategories = args.includes("--prune-categories");
  const modeArg = args.find((a) => a.startsWith("--allergens="))?.split("=")[1] ?? "replace";
  if (modeArg !== "union" && modeArg !== "replace") {
    throw new Error(`--allergens must be "replace" or "union", got "${modeArg}"`);
  }
  const mode: AllergenMode = modeArg;

  const positional = args.filter((a) => !a.startsWith("--"));
  const slug = positional[0];
  const file = positional[1] ?? path.join(import.meta.dirname, "data", "rangla-menu-2026-09.json");
  if (!slug) {
    throw new Error(
      "usage: apply-menu-update.ts <venue-slug> [menu.json] [--dry-run] [--publish] " +
        "[--refresh-draft] [--allergens=replace|union] [--prune-categories]",
    );
  }

  const menu = JSON.parse(readFileSync(file, "utf8")) as NewMenu;
  const itemCount = menu.categories.reduce((n, c) => n + c.items.length, 0);
  const tag = dryRun ? "[dry-run] " : "";
  console.log(
    `${tag}${path.basename(file)}: ${menu.categories.length} categories, ${itemCount} items ` +
      `→ venue "${slug}" (allergens: ${mode})`,
  );
  if (menu.venueSlug && menu.venueSlug !== slug) {
    console.warn(`! file was written for venue "${menu.venueSlug}", applying to "${slug}" anyway`);
  }

  const venue = await resolveVenue(slug);
  console.log(`venue ${venue.id} · tenant ${venue.tenantId}`);

  const menuRow = await asTenant(venue.tenantId, (tx) =>
    tx.menu.findFirst({
      where: { venueId: venue.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, publishedVersion: true },
    }),
  );
  if (!menuRow) throw new Error(`venue "${slug}" has no menu row`);

  // --- draft hygiene -------------------------------------------------------
  if (refreshDraft && !dryRun) {
    await asTenant(venue.tenantId, async (tx) => {
      const stale = await tx.menuVersion.findMany({
        where: { menuId: menuRow.id, status: "draft" },
        select: { id: true },
      });
      for (const row of stale) await tx.menuVersion.delete({ where: { id: row.id } });
      console.log(`--refresh-draft: dropped ${stale.length} draft version(s)`);
    });
  }
  if (!dryRun) await ensureDraftForTenant(venue.tenantId);

  const loaded = await asTenant(venue.tenantId, async (tx) => {
    const draft = await loadDraft(tx, menuRow.id);
    const published = menuRow.publishedVersion
      ? await tx.menuVersion.findFirst({
          where: { id: menuRow.publishedVersion },
          select: { categories: { select: draftSelect, orderBy: { orderIndex: "asc" } } },
        })
      : null;
    return { draft, published };
  });
  if (!loaded.draft) {
    throw new Error(
      dryRun
        ? "no draft exists yet — run once without --dry-run (the draft is forked from the " +
            "published version), or pass --refresh-draft"
        : "could not create a draft for this menu",
    );
  }
  // In a dry run --refresh-draft cannot actually re-fork the draft, so plan
  // against the published version instead — that is what the refreshed draft
  // would contain, and planning against the stale rows would print a fiction.
  const draftCats =
    dryRun && refreshDraft && loaded.published
      ? loaded.published.categories
      : loaded.draft.categories;
  if (dryRun && refreshDraft && loaded.published)
    console.log("[dry-run] --refresh-draft: planning against the PUBLISHED version");
  const liveCount = draftCats.reduce(
    (n, c) => n + c.items.filter((i) => i.deletedAt === null).length,
    0,
  );
  console.log(
    `draft ${loaded.draft.id}: ${draftCats.length} categories, ${liveCount} live items, ` +
      `${draftCats.reduce((n, c) => n + c.items.filter((i) => i.photoMediaId).length, 0)} with a photo`,
  );

  if (loaded.published && !refreshDraft) {
    const a = summarise(draftCats).join("\n");
    const b = summarise(loaded.published.categories).join("\n");
    if (a !== b) {
      console.warn(
        "\n! DRAFT DRIFT: the draft does not hold the same dishes as the published menu.\n" +
          "  Matching runs against the DRAFT, so dishes that only exist in the published version\n" +
          "  would be re-created WITHOUT their photo. Re-run with --refresh-draft to fork a clean\n" +
          "  draft from the published menu first (this discards unpublished draft edits).\n",
      );
    }
  }

  // --- plan ----------------------------------------------------------------
  const plan = buildPlan(menu, draftCats, mode);
  const creates = plan.items.filter((i) => i.kind === "create");
  const revives = plan.items.filter((i) => i.kind === "revive");
  const updates = plan.items.filter((i) => i.kind === "update");
  const newCats = plan.categories.filter((c) => c.kind === "create");
  const renamedCats = plan.categories.filter((c) => c.renamedFrom);

  console.log("\n── plan ──────────────────────────────────────────────");
  for (const c of newCats)
    console.log(`+ category "${c.newCategory.name}" (${c.newCategory.items.length} items)`);
  for (const c of renamedCats)
    console.log(`~ category "${c.renamedFrom}" → "${c.newCategory.name}"`);
  for (const c of plan.orphanCategories)
    console.log(
      `? category "${c.name}" is not in the new menu — ` +
        (pruneCategories ? "will be DELETED (--prune-categories)" : "left untouched"),
    );
  for (const i of creates)
    console.log(`+ ${i.category} / ${i.newItem.name} — ${i.data.priceCents}c (no photo)`);
  for (const i of revives) console.log(`^ ${i.category} / ${i.newItem.name} — revived`);
  for (const i of updates)
    console.log(`~ ${i.category} / ${i.newItem.name}: ${i.changes.join("; ")}`);
  for (const d of plan.softDeletes) console.log(`- ${d.category} / ${d.name} — soft-deleted`);
  for (const w of plan.warnings) console.log(`! ${w}`);
  console.log("──────────────────────────────────────────────────────");
  console.log(
    `${tag}${newCats.length} new categories, ${renamedCats.length} renamed, ` +
      `${creates.length} new items, ${revives.length} revived, ${updates.length} updated, ` +
      `${plan.softDeletes.length} soft-deleted`,
  );
  const touched =
    newCats.length +
    renamedCats.length +
    plan.items.length +
    plan.softDeletes.length +
    plan.categories.filter((c) => c.reordered).length;
  if (touched === 0) console.log("nothing to do — the draft already matches the file");

  if (dryRun) {
    console.log("\n[dry-run] nothing written, nothing published, CDN not purged");
    await prisma.$disconnect();
    return;
  }

  // --- apply ---------------------------------------------------------------
  await asTenantSlow(venue.tenantId, async (tx) => {
    const categoryIdFor = new Map<string, string>();
    for (const c of plan.categories) {
      const orderIndex = (menu.categories.indexOf(c.newCategory) + 1) * ORDER_STEP;
      if (c.kind === "create") {
        const created = await tx.category.create({
          data: {
            tenantId: venue.tenantId,
            menuVersionId: loaded.draft!.id,
            name: c.newCategory.name,
            orderIndex,
          },
          select: { id: true },
        });
        categoryIdFor.set(c.newCategory.id, created.id);
      } else {
        await tx.category.update({
          where: { id: c.draft!.id },
          data: { name: c.newCategory.name, orderIndex },
        });
        categoryIdFor.set(c.newCategory.id, c.draft!.id);
      }
    }

    for (const i of plan.items) {
      if (i.draft) {
        await tx.item.update({
          where: { id: i.draft.id },
          data: { ...i.data, deletedAt: null },
        });
      } else {
        const cat = menu.categories.find((c) => c.items.includes(i.newItem))!;
        await tx.item.create({
          data: {
            tenantId: venue.tenantId,
            categoryId: categoryIdFor.get(cat.id)!,
            currency: "EUR",
            ...i.data,
          },
        });
      }
    }

    const now = new Date();
    for (const d of plan.softDeletes) {
      await tx.item.update({ where: { id: d.id }, data: { deletedAt: now } });
    }

    if (pruneCategories) {
      for (const c of plan.orphanCategories) {
        await tx.category.delete({ where: { id: c.id } });
      }
    }

    // Category deletion leaves no row to carry a timestamp, so bump the
    // version itself — that is what drives "unpublished changes" in the
    // dashboard (getMenuStatus in menu-versions-service.ts).
    await tx.menuVersion.update({ where: { id: loaded.draft!.id }, data: { updatedAt: now } });
  });
  console.log("draft updated");

  // --- publish -------------------------------------------------------------
  if (doPublish) {
    const owner = await asTenant(venue.tenantId, (tx) =>
      tx.membership.findFirst({
        where: { tenantId: venue.tenantId },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: { userId: true, role: true },
      }),
    );
    if (!owner) throw new Error("tenant has no membership to publish as");
    const result = await publishDraft(owner.userId);
    if (!result.ok) throw new Error(`publish failed: ${result.error}`);
    console.log(
      `published version ${result.publishedVersionId} at ${result.publishedAt.toISOString()} ` +
        `(as ${owner.role} ${owner.userId})`,
    );

    const outcome = await purgeMenuForTenant(venue.tenantId);
    console.log(
      outcome === "purged"
        ? "CDN purged (menu pages + /api/v1/menu, all locales)"
        : outcome === "skipped_unconfigured"
          ? "CDN purge skipped — CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN unset; the 5-minute " +
            "s-maxage bounds the staleness instead"
          : "CDN purge FAILED — purge /, /{locale} and /api/v1/menu by hand in Cloudflare",
    );
    console.log(
      "\nnext: pnpm exec tsx --env-file=.env scripts/import-menu-translations.ts " +
        "scripts/data/rangla-menu-translations.json",
    );
  } else {
    console.log("draft only — re-run with --publish to put it live");
  }

  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
