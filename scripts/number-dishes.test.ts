import { describe, expect, it } from "vitest";
import { planCategory, PRINTED, stripNumber } from "./number-dishes";

const items = (names: string[]): { id: string; name: string }[] =>
  names.map((name, i) => ({ id: `i${i}`, name }));

describe("number-dishes", () => {
  it("covers the printed numbers 1–124 plus the children's 150 and 151, once each", () => {
    const numbers = Object.values(PRINTED)
      .flat()
      .map(([n]) => n)
      .sort((a, b) => a - b);
    expect(numbers).toEqual([...Array.from({ length: 124 }, (_, i) => i + 1), 150, 151]);
  });

  it("strips a number the owner already typed, however it was typed", () => {
    expect(stripNumber("9 Extra Reis")).toBe("Extra Reis");
    expect(stripNumber("7.  Gemischte Tikkas")).toBe("Gemischte Tikkas");
    expect(stripNumber("12) Chaat Papri")).toBe("Chaat Papri");
    expect(stripNumber("Dal")).toBe("Dal");
    // A size is not a dish number.
    expect(stripNumber("Sprite 0,33l")).toBe("Sprite 0,33l");
  });

  it("numbers a category in printed order and keeps the website's own wording", () => {
    const plan = planCategory(
      "Tagessuppen",
      items(["Dal", "14. Sabzi", "15 Hühnersuppe", "Tomatensuppe"]),
    );
    expect(plan).toEqual({
      ok: true,
      renames: [
        { id: "i0", category: "Tagessuppen", from: "Dal", to: "13. Dal" },
        { id: "i2", category: "Tagessuppen", from: "15 Hühnersuppe", to: "15. Hühnersuppe" },
        { id: "i3", category: "Tagessuppen", from: "Tomatensuppe", to: "16. Tomatensuppe" },
      ],
    });
    const kids = planCategory("Kinderteller", items(["Chicken Korma", "Sabzi Curry"]));
    expect(kids.ok && kids.renames.map((r) => r.to)).toEqual([
      "150. Chicken Korma",
      "151. Sabzi Curry",
    ]);
  });

  it("leaves unnumbered categories alone and refuses a category that does not match print", () => {
    expect(planCategory("Kalte Getränke", items(["Sprite 0,33l"]))).toEqual({
      ok: true,
      renames: [],
    });
    expect(planCategory("Tagessuppen", items(["Dal", "Sabzi"])).ok).toBe(false);
    expect(
      planCategory("Tagessuppen", items(["Sabzi", "Dal", "Hühnersuppe", "Tomatensuppe"])).ok,
    ).toBe(false);
  });
});
