import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Untick the dietary boxes (vegetarian, vegan, gluten-free, dairy-free,
 * halal, kosher) on every dish of the DRAFT menu in one go — the bulk
 * version of unticking them dish by dish on the dashboard. Nothing is
 * live until the owner presses Publish.
 *
 *   RESTAURANT_SLUG   default "rangla-punjab"
 *   DIETS             optional, comma-separated: clear only these
 *                     (e.g. DIETS=halal,vegan). Unset = clear all.
 *   APPLY=1           write; without it the script only prints the plan
 *
 *   ./deploy/deploy.sh dietary                 (dry run)
 *   APPLY=1 ./deploy/deploy.sh dietary         (clear everything)
 *
 * Before writing it saves what every dish had to
 * `dietary-backup-<time>.json` next to the repo, so the ticks can be put
 * back. Allergens are not touched.
 */

const ALL = ["vegetarian", "vegan", "halal", "kosher", "gluten_free", "dairy_free"];

/** The flags to remove: the requested ones, or all of them. */
export function dietsToClear(raw: string | undefined): string[] | { unknown: string[] } {
  const asked = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/-/g, "_"))
    .filter(Boolean);
  if (asked.length === 0) return ALL;
  const unknown = asked.filter((d) => !ALL.includes(d));
  return unknown.length > 0 ? { unknown } : asked;
}

async function main(): Promise<void> {
  const slug = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
  const apply = process.env.APPLY === "1";
  const clear = dietsToClear(process.env.DIETS);
  if (!Array.isArray(clear)) {
    throw new Error(`unknown diet(s): ${clear.unknown.join(", ")} — use ${ALL.join(", ")}`);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const venue = await prisma.venue.findUnique({ where: { slug }, select: { id: true } });
    if (!venue) throw new Error(`no venue with slug "${slug}"`);
    const draft = await prisma.menuVersion.findFirst({
      where: { status: "draft", menu: { venueId: venue.id, deletedAt: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!draft) throw new Error("this restaurant has no draft menu");

    const items = await prisma.item.findMany({
      where: { deletedAt: null, category: { menuVersionId: draft.id } },
      select: { id: true, name: true, dietary: true },
    });
    const changes = items
      .map((item) => ({ ...item, next: item.dietary.filter((d) => !clear.includes(d)) }))
      .filter((item) => item.next.length !== item.dietary.length);

    const counts = new Map<string, number>();
    for (const c of changes) {
      for (const d of c.dietary) {
        if (clear.includes(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
      }
    }
    console.log(`Clearing: ${clear.join(", ")}`);
    for (const [diet, n] of [...counts].sort()) console.log(`  ${diet}: ${n} dish(es)`);
    console.log(`${changes.length} of ${items.length} dish(es) would change.`);
    if (!apply) {
      console.log("Dry run — nothing was changed. Re-run with APPLY=1 to clear.");
      return;
    }
    if (changes.length === 0) return;

    const backup = `dietary-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(
      backup,
      JSON.stringify(
        changes.map((c) => ({ id: c.id, name: c.name, dietary: c.dietary })),
        null,
        2,
      ),
    );
    await prisma.$transaction(
      changes.map((c) => prisma.item.update({ where: { id: c.id }, data: { dietary: c.next } })),
    );
    console.log(
      `✓ Cleared on ${changes.length} dish(es) in the draft menu. Previous ticks saved to ${backup}.\n` +
        "  Open the dashboard and press PUBLISH to make it live.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("clear-dietary.ts")) {
  main().catch((err) => {
    console.error(`✗ clear-dietary failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
