import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Put the printed menu's dish numbers in front of the dish names —
 * "68. Chicken Curry" — for exactly the dishes the printed menu numbers
 * (1–124, and 150/151 on the children's plate). Thali and every drink
 * carry no number on paper and are left alone.
 *
 * It renames the DRAFT menu, like 126 edits made by hand on the dashboard
 * would: nothing is live until the owner presses Publish. Each name's
 * translations (other languages) get the same number.
 *
 *   RESTAURANT_SLUG   default "rangla-punjab"
 *   APPLY=1           write; without it the script only prints the plan
 *
 *   ./deploy/deploy.sh dishes            (on the VPS: dry run)
 *   APPLY=1 ./deploy/deploy.sh dishes    (on the VPS: rename)
 *
 * Safe to run twice: a name that already starts with a number (the owner
 * typed "9 Extra Reis", "7.  Gemischte Tikkas") is normalised, not
 * numbered again. It refuses to write if any category does not hold
 * exactly the dishes the printed menu lists, in the same order.
 */

/** Category → the printed numbers and names, in printed order. */
export const PRINTED: Record<string, [number, string][]> = {
  "Warme Vorspeisen": [
    [1, "Pakoras"],
    [2, "Mix Pakora"],
    [3, "Paneer Pakora"],
    [4, "Chicken Pakora"],
    [5, "Jhinga Pakora"],
    [6, "Samosa"],
    [7, "Gemischte Tikkas"],
    [8, "Pommes Frites"],
    [9, "Extra Reis"],
    [10, "Chutneys"],
    [11, "Pani Puri"],
    [12, "Chaat Papri"],
  ],
  Tagessuppen: [
    [13, "Dal"],
    [14, "Sabzi"],
    [15, "Hühnersuppe"],
    [16, "Tomatensuppe"],
  ],
  "Fladenbrot-Spezialitäten": [
    [17, "Tandoori Roti"],
    [18, "Naan"],
    [19, "Garlic Naan"],
    [20, "Butter Naan"],
    [21, "Hariyali Naan"],
    [22, "Aloo Paratha"],
    [23, "Paneer Naan"],
    [24, "Papadam"],
    [25, "Mix Naan"],
    [26, "Cheese Naan"],
    [27, "Peshwari Naan"],
    [28, "Keema Naan"],
    [29, "Keema Naan"],
  ],
  Kinderteller: [
    [150, "Chicken Korma"],
    [151, "Sabzi Curry"],
  ],
  Salate: [
    [30, "Gemischter Salat"],
    [31, "Chicken Salat"],
    [32, "Paneer Salat"],
    [33, "Jhinga Salat"],
    [34, "Raita"],
  ],
  "Vegetarische Gerichte": [
    [35, "Sabzi Makhni"],
    [36, "Sabzi Curry"],
    [37, "Matter Paneer"],
    [38, "Palak Paneer"],
    [39, "Alu Saag"],
    [40, "Alu Chana Masala"],
    [41, "Karahi Paneer"],
    [42, "Shahi Paneer"],
    [43, "Malai Kofta"],
    [44, "Paneer Kashmiri"],
    [45, "Dal Tarka"],
    [46, "Sabzi Jhalfrezi"],
    [47, "Paneer Butter Masala"],
    [48, "Bengen Ka Bharta"],
    [49, "Bhindi Masala"],
    [50, "Dal Palak"],
    [51, "Alu Bengen"],
    [52, "Dal Makhni"],
    [53, "Kola Puri"],
  ],
  "Vegane Gerichte mit Bio-Tofu": [
    [54, "Palak Tofu"],
    [55, "Shahi Tofu"],
    [56, "Mango Tofu"],
    [57, "Karahi Tofu"],
    [58, "Tikka Masala Tofu"],
    [59, "Chili Tofu"],
    [60, "Madrasi Tofu"],
  ],
  "Reis Gerichte": [
    [61, "Sabzi Biryani"],
    [62, "Chicken Biryani"],
    [63, "Lamm Biryani"],
    [64, "Jhinga Biryani"],
    [65, "Matter Paneer Pulao"],
    [66, "Rangla Chicken Pulao"],
    [67, "Rangla Lamm Pulao"],
  ],
  "Hähnchen Gerichte": [
    [68, "Chicken Curry"],
    [69, "Chicken Sabzi"],
    [70, "Chicken Saag"],
    [71, "Chicken Vindaloo"],
    [72, "Chicken Korma"],
    [73, "Chicken Mango"],
    [74, "Chicken Kashmiri"],
    [75, "Chicken Karahi"],
    [76, "Chicken Madrasi"],
    [77, "Chicken Jhalfrezi"],
    [78, "Chicken Dopiaza"],
    [79, "Butter Chicken"],
    [80, "Chicken Tikka Masala"],
    [81, "Chili Chicken"],
    [82, "Nawabi Chicken"],
    [83, "Chicken Chana Masala"],
    [84, "Chicken Hyderabadi"],
    [85, "Gulabi Chicken"],
    [86, "Sookha Chicken"],
  ],
  "Tandoori Spezialitäten": [
    [87, "Peshawari Seekh Kabab"],
    [88, "Hariyali Tikka"],
    [89, "Chicken Tikka"],
    [90, "Lahori King Prawn"],
    [91, "Garlic Chicken Tikka"],
    [92, "Lamm Boti Tikka"],
    [93, "Tandoori Chicken"],
    [94, "Paneer Tikka"],
    [95, "Afghani Tandoori Chicken"],
    [96, "Mix Grill-Teller"],
    [97, "Jambo Grill-Teller"],
    [98, "Fisch Tikka"],
    [99, "Fisch Garlic"],
  ],
  "Lamm Gerichte": [
    [100, "Lamm Curry"],
    [101, "Lamm Saag"],
    [102, "Lamm Makhani Wala"],
    [103, "Lamm Sabzi Curry"],
    [104, "Lamm Vindaloo"],
    [105, "Lamm Madrasi"],
    [106, "Lamm Korma"],
    [107, "Lamm Dal"],
    [108, "Kashmiri Kofta"],
    [109, "Lamm Karahi"],
    [110, "Lamm Kashmiri"],
    [111, "Peshawari Seek Masala"],
    [112, "Lamm Bindi Masala"],
  ],
  "Gerichte mit Fisch oder Meeresfrüchten": [
    [113, "Fisch Curry"],
    [114, "Fisch Masala"],
    [115, "Fisch Madrasi"],
    [116, "Jhinga Masala"],
    [117, "Jhinga Curry"],
    [118, "Jhinga Kashmiri"],
    [119, "Jhinga Dal"],
  ],
  Desserts: [
    [120, "Indisches Halwa"],
    [121, "Indisches Vermicelles"],
    [122, "Indisches Kulfi"],
    [123, "Gulab Jamun"],
    [124, "Kheer"],
  ],
};

/** "9 Extra Reis", "7.  Gemischte Tikkas", "12) Chaat" → the bare name. */
export function stripNumber(name: string): string {
  return name.replace(/^\s*\d{1,3}\s*[.)]?\s+/, "").trim();
}

/** Loose comparison for the safety check: case, accents of spacing, dashes. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
}

export interface Rename {
  id: string;
  category: string;
  from: string;
  to: string;
}

/**
 * The renames for one category, or the reason it does not match the
 * printed menu. `items` are the category's live dishes in menu order.
 */
export function planCategory(
  category: string,
  items: { id: string; name: string }[],
): { ok: true; renames: Rename[] } | { ok: false; problem: string } {
  const printed = PRINTED[category];
  if (!printed) return { ok: true, renames: [] };
  if (items.length !== printed.length) {
    return {
      ok: false,
      problem: `${category}: the printed menu lists ${printed.length} dishes, the website has ${items.length}`,
    };
  }
  const renames: Rename[] = [];
  for (let i = 0; i < printed.length; i++) {
    const [number, expected] = printed[i]!;
    const item = items[i]!;
    const bare = stripNumber(item.name);
    if (!norm(bare).startsWith(norm(expected))) {
      return {
        ok: false,
        problem: `${category}: position ${i + 1} is "${item.name}" on the website but "${number}. ${expected}" in print`,
      };
    }
    const to = `${number}. ${bare}`;
    if (to !== item.name) renames.push({ id: item.id, category, from: item.name, to });
  }
  return { ok: true, renames };
}

async function main(): Promise<void> {
  const slug = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
  const apply = process.env.APPLY === "1";
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const venue = await prisma.venue.findUnique({ where: { slug }, select: { id: true } });
    if (!venue) throw new Error(`no venue with slug "${slug}"`);
    const draft = await prisma.menuVersion.findFirst({
      where: { status: "draft", menu: { venueId: venue.id, deletedAt: null } },
      orderBy: { createdAt: "desc" },
      select: {
        categories: {
          orderBy: { orderIndex: "asc" },
          select: {
            name: true,
            items: {
              where: { deletedAt: null },
              orderBy: { orderIndex: "asc" },
              select: { id: true, name: true },
            },
          },
        },
      },
    });
    if (!draft) throw new Error("this restaurant has no draft menu");

    const renames: Rename[] = [];
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const category of draft.categories) {
      seen.add(category.name);
      const plan = planCategory(category.name, category.items);
      if (plan.ok) renames.push(...plan.renames);
      else problems.push(plan.problem);
    }
    for (const name of Object.keys(PRINTED)) {
      if (!seen.has(name)) problems.push(`${name}: category not found on the website`);
    }

    for (const r of renames) console.log(`  ${r.category}:  ${r.from}  →  ${r.to}`);
    console.log(`\n${renames.length} dish name(s) to change.`);
    if (problems.length > 0) {
      console.log("\n✗ Not changing anything — the website does not match the printed menu:");
      for (const p of problems) console.log(`  - ${p}`);
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log("Dry run — nothing was changed. Re-run with APPLY=1 to rename.");
      return;
    }

    let translations = 0;
    await prisma.$transaction(async (tx) => {
      for (const r of renames) {
        await tx.item.update({ where: { id: r.id }, data: { name: r.to } });
        const number = r.to.slice(0, r.to.indexOf(". "));
        const rows = await tx.translation.findMany({
          where: { entityType: "item", entityId: r.id, field: "name" },
          select: { id: true, value: true },
        });
        for (const row of rows) {
          const next = `${number}. ${stripNumber(row.value)}`;
          if (next === row.value) continue;
          await tx.translation.update({ where: { id: row.id }, data: { value: next } });
          translations += 1;
        }
      }
    });
    console.log(
      `✓ Renamed ${renames.length} dish(es) and ${translations} translation(s) in the draft menu.\n` +
        "  Open the dashboard and press PUBLISH to put the numbers on the live menu.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Run only as a script; the functions above are imported by the test.
if (process.argv[1]?.endsWith("number-dishes.ts")) {
  main().catch((err) => {
    console.error(`✗ number-dishes failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
