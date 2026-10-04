import { writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Put the alcoholic drinks under ONE category with the printed card's
 * prices (owner, 2026-10-04, from the "Getränke – Alkoholisch" page).
 *
 * In the DRAFT menu:
 *   - the "Bier" category becomes "Alkoholische Getränke" and receives, in
 *     the printed order, every drink of Bier, Aperitif, Weißwein, Rotwein
 *     and Rosé; the four emptied categories are removed;
 *   - every drink gets the printed name and price. The three names the
 *     card prints twice (Sula, Spätburgunder, Seeliebe) say which wine they
 *     are, and every wine carries its colour as the description;
 *   - a drink on the card that is missing is created; a drink in those
 *     categories that is NOT on the card is kept, at the end, unchanged;
 *   - "Bier alkoholfrei" stays its own category; only its prices are set.
 * Nothing is live until the owner presses Publish.
 *
 *   RESTAURANT_SLUG   default "rangla-punjab"
 *   APPLY=1           write; without it the script only prints the plan
 *
 *   ./deploy/deploy.sh drinks             (dry run)
 *   APPLY=1 ./deploy/deploy.sh drinks     (write, then press Publish)
 *
 * Before writing it saves every touched dish and category to
 * `drinks-backup-<time>.json` in the current directory.
 */

const TARGET_NAME = "Alkoholische Getränke";
const TARGET_TRANSLATIONS: Record<string, string> = {
  en: "Alcoholic drinks",
  fr: "Boissons alcoolisées",
  es: "Bebidas alcohólicas",
  it: "Bevande alcoliche",
  ar: "مشروبات كحولية",
};
const SOURCES = ["Bier", "Aperitif", "Weißwein", "Rotwein", "Rosé"] as const;
type Source = (typeof SOURCES)[number];
const ALCOHOL_FREE = "Bier alkoholfrei";

interface Drink {
  from: Source;
  /** The name as the card prints it — what an existing dish is matched on. */
  match: string;
  name: string;
  description: string | null;
  priceCents: number;
  allergens: string[];
}

const beer = (match: string, size: string, priceCents: number): Drink => ({
  from: "Bier",
  match,
  name: `${match} ${size}`,
  description: null,
  priceCents,
  allergens: ["gluten"],
});
const aperitif = (match: string, size: string, priceCents: number): Drink => ({
  from: "Aperitif",
  match,
  name: `${match} ${size}`,
  description: null,
  priceCents,
  allergens: [],
});
/** `label` is set for the names the card prints under two colours. */
const wine = (from: Source, match: string, priceCents: number, label?: string): Drink => ({
  from,
  match,
  name: label ? `${label} 0,25l` : `${match} 0,25l`,
  description: from === "Rosé" ? "Roséwein" : from,
  priceCents,
  allergens: [],
});

/** The printed card, top to bottom, left column then right. */
export const CARD: Drink[] = [
  beer("Pils / Export / Helles", "0,5l", 510),
  beer("Hefeweizen", "0,5l", 510),
  beer("Radler-Russ", "0,5l", 490),
  aperitif("Aperol Spritz", "0,25l", 790),
  aperitif("Campari Spritz", "0,25l", 790),
  aperitif("Gin Tonic", "0,25l", 890),
  aperitif("Sekt", "0,1l", 410),
  aperitif("Wodka Lemon", "0,25l", 890),
  wine("Weißwein", "Sula (Indischer Wein)", 650, "Sula Weißwein (Indischer Wein)"),
  wine("Weißwein", "Pinot Grigio", 610),
  wine("Weißwein", "Müller-Thurgau", 610),
  wine("Weißwein", "Gutedel", 610),
  wine("Weißwein", "Grauburgunder", 610),
  wine("Rotwein", "Sula (Indischer Wein)", 640, "Sula Rotwein (Indischer Wein)"),
  wine("Rotwein", "Spätburgunder", 610, "Spätburgunder Rotwein"),
  wine("Rotwein", "Merlot", 610),
  wine("Rotwein", "Montepulciano", 610),
  wine("Rotwein", "Chianti", 610),
  wine("Rotwein", "Seeliebe", 610, "Seeliebe Rotwein"),
  wine("Rosé", "Spätburgunder", 650, "Spätburgunder Rosé"),
  wine("Rosé", "Seeliebe", 610, "Seeliebe Rosé"),
];

/** Bier alkoholfrei keeps its names; only the printed prices are set. */
export const ALCOHOL_FREE_PRICES: { match: string; priceCents: number }[] = [
  { match: "Fürstenberg Pils", priceCents: 510 },
  { match: "Radler", priceCents: 490 },
  { match: "Rothaus Hefeweizen", priceCents: 490 },
];

/**
 * A dish name reduced to what identifies the drink: no menu number in
 * front ("150. "), no size ("0,5l", "0.25 l"), no "alkoholfrei", case and
 * spacing folded.
 */
export function drinkKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\s*\d+\s*[.)]\s*/, "")
    .replace(/\d+([.,]\d+)?\s*l\b/g, "")
    .replace(/alkoholfrei/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const euro = (cents: number): string => (cents / 100).toFixed(2).replace(".", ",") + " €";

async function main(): Promise<void> {
  const slug = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
  const apply = process.env.APPLY === "1";
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const venue = await prisma.venue.findUnique({
      where: { slug },
      select: { id: true, tenantId: true, currency: true },
    });
    if (!venue) throw new Error(`no venue with slug "${slug}"`);
    // FORCE ROW LEVEL SECURITY on every menu table: all reads and writes
    // run with the tenant set (the lesson of the test-order cleanup).
    const tenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${venue.tenantId}, true)`;
          return fn(tx);
        },
        { timeout: 60_000 },
      );

    const loaded = await tenantTx(async (tx) => {
      const draft = await tx.menuVersion.findFirst({
        where: { status: "draft", menu: { venueId: venue.id, deletedAt: null } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!draft) throw new Error("this restaurant has no draft menu");
      const categories = await tx.category.findMany({
        where: { menuVersionId: draft.id, name: { in: [...SOURCES, ALCOHOL_FREE, TARGET_NAME] } },
        include: {
          items: { where: { deletedAt: null }, orderBy: { orderIndex: "asc" } },
        },
      });
      return { draftId: draft.id, categories };
    });

    const byName = new Map(loaded.categories.map((c) => [c.name, c]));
    const target = byName.get(TARGET_NAME) ?? byName.get("Bier");
    if (!target) throw new Error(`no "Bier" (or "${TARGET_NAME}") category in the draft menu`);
    const missingSources = SOURCES.filter((s) => s !== "Bier" && !byName.has(s));
    if (missingSources.length) console.log(`(not found, skipped: ${missingSources.join(", ")})`);

    // Where each dish sits now: its category's printed name, so "Sula" in
    // Weißwein and "Sula" in Rotwein stay two different drinks. Dishes
    // already merged by an earlier run keep their colour in the description.
    type Row = (typeof loaded.categories)[number]["items"][number];
    const pool: { from: Source; item: Row }[] = [];
    for (const source of SOURCES) {
      const cat = source === "Bier" ? target : byName.get(source);
      if (!cat) continue;
      for (const item of cat.items) pool.push({ from: source, item });
    }
    const taken = new Set<string>();
    const findDish = (d: Drink): Row | undefined => {
      const key = drinkKey(d.match);
      const candidates = pool.filter(
        (p) =>
          !taken.has(p.item.id) &&
          (drinkKey(p.item.name) === key || drinkKey(p.item.name) === drinkKey(d.name)),
      );
      const hit =
        candidates.find((p) => p.from === d.from) ??
        candidates.find((p) => (p.item.description ?? "") === (d.description ?? ""));
      if (hit) taken.add(hit.item.id);
      return hit?.item;
    };

    const plan = CARD.map((d, i) => ({ drink: d, item: findDish(d), orderIndex: (i + 1) * 100 }));
    const leftovers = pool.filter((p) => !taken.has(p.item.id));

    console.log(
      `Draft menu — "${target.name}" becomes "${TARGET_NAME}" with ${CARD.length} drinks:`,
    );
    for (const { drink, item } of plan) {
      if (!item) {
        console.log(`  + NEW   ${drink.name} — ${euro(drink.priceCents)}`);
        continue;
      }
      const changes: string[] = [];
      if (item.name !== drink.name) changes.push(`name "${item.name}" → "${drink.name}"`);
      if (item.priceCents !== drink.priceCents) {
        changes.push(`price ${euro(item.priceCents)} → ${euro(drink.priceCents)}`);
      }
      if ((item.description ?? null) !== drink.description) {
        changes.push(`description → ${drink.description ?? "(none)"}`);
      }
      console.log(
        `  ${changes.length ? "~" : "="}       ${drink.name} — ${euro(drink.priceCents)}` +
          (changes.length ? `   [${changes.join("; ")}]` : ""),
      );
    }
    for (const { from, item } of leftovers) {
      console.log(
        `  ? KEPT  "${item.name}" (${from}, ${euro(item.priceCents)}) — not on the card, moved to the end`,
      );
    }
    const emptied = SOURCES.filter((s) => s !== "Bier")
      .map((s) => byName.get(s))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (emptied.length) console.log(`Categories removed: ${emptied.map((c) => c.name).join(", ")}`);

    const free = byName.get(ALCOHOL_FREE);
    const freePlan = (free?.items ?? []).flatMap((item) => {
      const price = ALCOHOL_FREE_PRICES.find((p) =>
        drinkKey(item.name).startsWith(drinkKey(p.match)),
      );
      return price && price.priceCents !== item.priceCents
        ? [{ item, priceCents: price.priceCents }]
        : [];
    });
    console.log(`"${ALCOHOL_FREE}": ${freePlan.length} price(s) to set`);
    for (const { item, priceCents } of freePlan) {
      console.log(`  ~       ${item.name} — ${euro(item.priceCents)} → ${euro(priceCents)}`);
    }

    if (!apply) {
      console.log("\nDry run — nothing was changed. Re-run with APPLY=1, then press PUBLISH.");
      return;
    }

    const backup = `drinks-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(backup, JSON.stringify({ categories: loaded.categories }, null, 2));

    await tenantTx(async (tx) => {
      await tx.category.update({ where: { id: target.id }, data: { name: TARGET_NAME } });
      await tx.translation.deleteMany({
        where: { entityType: "category", entityId: target.id, field: "name" },
      });
      await tx.translation.createMany({
        data: Object.entries(TARGET_TRANSLATIONS).map(([locale, value]) => ({
          tenantId: venue.tenantId,
          entityType: "category",
          entityId: target.id,
          locale,
          field: "name",
          value,
        })),
      });

      for (const { drink, item, orderIndex } of plan) {
        if (item) {
          await tx.item.update({
            where: { id: item.id },
            data: {
              categoryId: target.id,
              orderIndex,
              name: drink.name,
              description: drink.description,
              priceCents: drink.priceCents,
            },
          });
          // A renamed drink's old translated names would bring the
          // duplicates back in other languages; without them the German
          // name shows, which says which wine it is.
          if (item.name !== drink.name) {
            await tx.translation.deleteMany({
              where: {
                entityType: "item",
                entityId: item.id,
                field: { in: ["name", "description"] },
              },
            });
          }
        } else {
          await tx.item.create({
            data: {
              tenantId: venue.tenantId,
              categoryId: target.id,
              name: drink.name,
              description: drink.description,
              priceCents: drink.priceCents,
              currency: venue.currency,
              orderIndex,
              allergens: drink.allergens as never,
            },
          });
        }
      }
      let next = (CARD.length + 1) * 100;
      for (const { item } of leftovers) {
        await tx.item.update({
          where: { id: item.id },
          data: { categoryId: target.id, orderIndex: next },
        });
        next += 100;
      }
      for (const cat of emptied) {
        const left = await tx.item.count({ where: { categoryId: cat.id, deletedAt: null } });
        if (left > 0) throw new Error(`"${cat.name}" still has ${left} dish(es) — rolled back`);
        await tx.translation.deleteMany({ where: { entityType: "category", entityId: cat.id } });
        await tx.category.delete({ where: { id: cat.id } });
      }
      for (const { item, priceCents } of freePlan) {
        await tx.item.update({ where: { id: item.id }, data: { priceCents } });
      }
    });
    console.log(
      `✓ Done in the draft menu. Backup: ${backup}\n  Open the dashboard and press PUBLISH to make it live.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("merge-alcohol-drinks.ts")) {
  main().catch((err) => {
    console.error(
      `✗ merge-alcohol-drinks failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  });
}
