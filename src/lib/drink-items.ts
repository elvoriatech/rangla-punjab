import type { Prisma } from "@prisma/client";

/**
 * Which order lines are drinks (owner, 2026-10-11: "box only on drinks" on
 * the order receipt — the counter pours them, the kitchen cooks the rest).
 *
 * An order line keeps only a plain reference to its menu item, so the
 * answer comes from that item's CATEGORY name. Matching names rather than a
 * flag means no menu work for the restaurant: every drinks section on this
 * menu (Getränke, Bier, Weißwein, Lassi, Kaffee und Tee …) already says so.
 */
export const DRINK_CATEGORY =
  /getr[äa]nk|drink|bier|beer|wein|wine|ros[ée]|lassi|limo|cocktail|kaffee|coffee|\btee\b|\btea\b|aperitif|saft|juice|wasser|water|spirituose|softdrink|sekt|prosecco/i;

export function isDrinkCategory(name: string | null | undefined): boolean {
  return !!name && DRINK_CATEGORY.test(name);
}

/** The ids among `itemIds` whose menu category is a drinks category. */
export async function drinkItemIds(
  tx: Prisma.TransactionClient,
  itemIds: readonly (string | null)[],
): Promise<Set<string>> {
  const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Set();
  const rows = await tx.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, category: { select: { name: true } } },
  });
  return new Set(rows.filter((r) => isDrinkCategory(r.category.name)).map((r) => r.id));
}
