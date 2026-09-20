import { describe, expect, it } from "vitest";
import { buildPlan, normaliseName } from "./apply-menu-update";

/**
 * The matcher is the only interesting part of the script: everything else is
 * Prisma writes. What these cover is the property the script lives or dies on
 * — running it twice must be a no-op, because a second pairing that drifts
 * would re-create dishes and drop their photos.
 */

type DraftArgs = Parameters<typeof buildPlan>[1];

function item(
  name: string,
  over: Partial<DraftArgs[0]["items"][0]> = {},
): DraftArgs[0]["items"][0] {
  return {
    id: `id-${name}`,
    name,
    description: null,
    priceCents: 100,
    orderIndex: 100,
    isAvailable: true,
    allergens: [],
    traces: [],
    dietary: [],
    spice: 0,
    photoMediaId: `photo-${name}`,
    offerPriceCents: null,
    deletedAt: null,
    ...over,
  };
}

function category(name: string, items: DraftArgs[0]["items"], orderIndex = 100): DraftArgs[0] {
  return { id: `cat-${name}`, name, orderIndex, items };
}

describe("normaliseName", () => {
  it("ignores case, umlauts, ß and punctuation", () => {
    expect(normaliseName("Mix Pakora-Groß (für 2-3 Personen)")).toBe(
      normaliseName("mix pakora groß, für 2–3 personen"),
    );
    expect(normaliseName("Hähnchen Gerichte")).toBe(normaliseName("HAEHNCHEN GERICHTE"));
  });
});

describe("buildPlan", () => {
  const menu = {
    categories: [
      {
        id: "bier-alkoholfrei",
        name: "Bier alkoholfrei",
        matchNames: ["Bier"],
        items: [
          {
            id: "i1",
            number: null,
            name: "Fürstenberg Pils alkoholfrei 0,5l",
            description: null,
            priceCents: 400,
            allergens: ["gluten"],
            traces: [],
            dietary: [],
            spice: 0,
          },
        ],
      },
      {
        id: "bier",
        name: "Bier",
        items: [
          {
            id: "i2",
            number: null,
            name: "Hefeweizen 0,5l",
            description: null,
            priceCents: 510,
            allergens: ["gluten"],
            traces: [],
            dietary: [],
            spice: 0,
          },
        ],
      },
    ],
  };

  it("lets a renamed category claim its predecessor before a new namesake does", () => {
    const draft = [category("Bier", [item("Fürstenberg Pils alkoholfrei 0,5l")])];
    const plan = buildPlan(menu, draft, "union");

    const renamed = plan.categories.find((c) => c.newCategory.id === "bier-alkoholfrei");
    expect(renamed?.kind).toBe("update");
    expect(renamed?.renamedFrom).toBe("Bier");
    expect(plan.categories.find((c) => c.newCategory.id === "bier")?.kind).toBe("create");
    // the existing beer keeps its row (and therefore its photo)
    expect(plan.items.filter((i) => i.kind === "create")).toHaveLength(1);
    expect(plan.softDeletes).toHaveLength(0);
  });

  it("is a no-op on the state its own first run produces", () => {
    const draft = [
      category(
        "Bier alkoholfrei",
        [item("Fürstenberg Pils alkoholfrei 0,5l", { priceCents: 400, allergens: ["gluten"] })],
        100,
      ),
      category("Bier", [item("Hefeweizen 0,5l", { priceCents: 510, allergens: ["gluten"] })], 200),
    ];
    const plan = buildPlan(menu, draft, "union");

    expect(plan.items).toHaveLength(0);
    expect(plan.softDeletes).toHaveLength(0);
    expect(plan.categories.every((c) => c.kind === "update" && !c.renamedFrom)).toBe(true);
  });

  it("revives a soft-deleted row rather than creating a twin", () => {
    const draft = [
      category("Bier alkoholfrei", [
        item("Fürstenberg Pils alkoholfrei 0,5l", {
          priceCents: 400,
          allergens: ["gluten"],
          deletedAt: new Date(),
        }),
      ]),
    ];
    const plan = buildPlan(menu, draft, "union");
    const revived = plan.items.find((i) => i.newItem.id === "i1");
    expect(revived?.kind).toBe("revive");
    expect(revived?.draft?.photoMediaId).toBe("photo-Fürstenberg Pils alkoholfrei 0,5l");
  });

  it("union keeps an allergen the printed card omits, replace drops it", () => {
    const draft = [
      category("Bier alkoholfrei", [
        item("Fürstenberg Pils alkoholfrei 0,5l", {
          priceCents: 400,
          allergens: ["gluten", "milk"],
        }),
      ]),
    ];
    expect(
      buildPlan(menu, draft, "union").items.find((i) => i.newItem.id === "i1"),
    ).toBeUndefined();
    const replaced = buildPlan(menu, draft, "replace").items.find((i) => i.newItem.id === "i1");
    expect(replaced?.data.allergens).toEqual(["gluten"]);
  });

  it("warns when a running offer would no longer sit below the new price", () => {
    const draft = [
      category("Bier alkoholfrei", [
        item("Fürstenberg Pils alkoholfrei 0,5l", {
          priceCents: 400,
          allergens: ["gluten"],
          offerPriceCents: 450,
        }),
      ]),
    ];
    expect(buildPlan(menu, draft, "union").warnings).toHaveLength(1);
  });
});
