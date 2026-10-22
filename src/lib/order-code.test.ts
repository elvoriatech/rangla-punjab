import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORDER_CODE_ALPHABET, decodeOrderCode, displayOrderLabel, orderCode } from "./order-code";

describe("public order code (RP-XXXXX)", () => {
  it("has the agreed shape", () => {
    const code = orderCode("O", 12);
    expect(code).toMatch(/^RP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
    expect(ORDER_CODE_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it("is collision-free across all series for the first 100,000 orders of each", () => {
    const seen = new Set<string>();
    for (const series of [null, "B", "O"]) {
      for (let n = 1; n <= 100_000; n++) seen.add(orderCode(series, n));
    }
    expect(seen.size).toBe(300_000);
  });

  it("decodes back to exactly the order it came from", () => {
    for (const series of [null, "B", "O"] as const) {
      for (const n of [1, 2, 7, 12, 99, 1_000, 54_321, 307_000, 307_839, 307_840, 2_000_000]) {
        expect(decodeOrderCode(orderCode(series, n))).toEqual({ series, orderNumber: n });
      }
    }
  });

  it("grows by a character only past ~307k orders per series, still unique", () => {
    expect(orderCode("O", 307_000)).toHaveLength(8);
    // 31^4 / 3 = 307,840: the first order needing a 5th data character.
    expect(orderCode("O", 307_839)).toHaveLength(8);
    expect(orderCode("O", 307_840)).toHaveLength(9);
    expect(orderCode("O", 307_840)).not.toBe(orderCode("O", 307_000));
  });

  it("is stable: these codes must never change (alphabet / keys are frozen)", () => {
    // Pinned on 2026-10-22. If this fails, every code shown since then changes.
    const pinned = {
      o1: orderCode("O", 1),
      b1: orderCode("B", 1),
      o12: orderCode("O", 12),
      legacy6: orderCode(null, 6),
    };
    expect(pinned).toMatchInlineSnapshot(`
      {
        "b1": "RP-NVE9D",
        "legacy6": "RP-NS46U",
        "o1": "RP-BSGYW",
        "o12": "RP-Y8NTA",
      }
    `);
  });

  it("the check character catches every single typo and every neighbour swap", () => {
    const code = orderCode("O", 4711).slice(3);
    for (let i = 0; i < code.length; i++) {
      for (const ch of ORDER_CODE_ALPHABET) {
        if (ch === code[i]) continue;
        const typo = code.slice(0, i) + ch + code.slice(i + 1);
        expect(decodeOrderCode(typo)).toBeNull();
      }
    }
    for (let i = 0; i < code.length - 1; i++) {
      if (code[i] === code[i + 1]) continue;
      const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
      expect(decodeOrderCode(swapped)).toBeNull();
    }
  });

  it("accepts sloppy input when searching", () => {
    const code = orderCode("B", 33);
    const loose = code.toLowerCase().replace("-", " ");
    expect(decodeOrderCode(loose)).toEqual({ series: "B", orderNumber: 33 });
    expect(decodeOrderCode(code.slice(3))).toEqual({ series: "B", orderNumber: 33 });
    expect(decodeOrderCode("hello")).toBeNull();
    expect(decodeOrderCode("O-12")).toBeNull();
  });

  it("converts labels stored before the codes", () => {
    expect(displayOrderLabel("O-12")).toBe(orderCode("O", 12));
    expect(displayOrderLabel("B-3")).toBe(orderCode("B", 3));
    expect(displayOrderLabel("6")).toBe(orderCode(null, 6));
    const already = orderCode("O", 9);
    expect(displayOrderLabel(already)).toBe(already);
    expect(displayOrderLabel(null)).toBeNull();
  });

  it("the app's copy (mobile/src/order-code.ts) is identical below its header", () => {
    const body = (path: string) =>
      readFileSync(path, "utf8").split("export const ORDER_CODE_PREFIX")[1];
    expect(body("mobile/src/order-code.ts")).toBe(body("src/lib/order-code.ts"));
  });
});
