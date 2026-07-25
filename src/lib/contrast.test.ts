import { describe, expect, it } from "vitest";
import {
  checkContrast,
  contrastRatio,
  hexToRgb,
  meetsAaNormal,
  nearestPassingColor,
} from "./contrast";

describe("contrast", () => {
  it("computes 21:1 for pure black on pure white", () => {
    // The WCAG max — a sanity check that the formula is right end-to-end.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("computes 1:1 for identical colours", () => {
    expect(contrastRatio("#333333", "#333333")).toBeCloseTo(1, 5);
  });

  it("passes AA-normal for the elvoria brand green on cream", () => {
    // The theme_two palette (P1 spike) — must clear 4.5:1.
    expect(meetsAaNormal("#1f3b2e", "#faf7f2")).toBe(true);
  });

  it("fails AA-normal for pale gold on cream (foreground too light)", () => {
    expect(meetsAaNormal("#d6b788", "#faf7f2")).toBe(false);
  });

  it("accepts 3-char shorthand hex", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it("rejects malformed hex", () => {
    expect(() => hexToRgb("#zz")).toThrow(/invalid hex/);
    expect(() => hexToRgb("nope")).toThrow(/invalid hex/);
  });
});

describe("checkContrast (P1-24 guard)", () => {
  it("accepts a known-passing pair (brand green on cream)", () => {
    const r = checkContrast("#1f3b2e", "#faf7f2");
    expect(r.ok).toBe(true);
    expect(r.ratio).toBeGreaterThanOrEqual(r.target);
    expect(r.suggestion).toBeUndefined();
  });

  it("rejects a known-failing pair and returns a passing suggestion", () => {
    const r = checkContrast("#d6b788", "#faf7f2"); // pale gold on cream
    expect(r.ok).toBe(false);
    expect(r.ratio).toBeLessThan(r.target);
    expect(r.suggestion).toBeDefined();
    // The suggestion itself must clear the same bar it was suggested for.
    expect(contrastRatio(r.suggestion!, "#faf7f2")).toBeGreaterThanOrEqual(r.target);
    // And feeding the suggestion back through the guard flips the verdict.
    expect(checkContrast(r.suggestion!, "#faf7f2").ok).toBe(true);
  });

  it("honours the AA-large threshold (3:1) when explicitly requested", () => {
    // A colour that passes AA-large but fails AA-normal.
    const foreground = "#7a8f83"; // muted sage
    const background = "#faf7f2";
    const normal = checkContrast(foreground, background, { level: "AA-normal" });
    const large = checkContrast(foreground, background, { level: "AA-large" });
    expect(normal.target).toBe(4.5);
    expect(large.target).toBe(3);
    // If AA-large accepts the pair, AA-normal must also see the same ratio.
    if (large.ok) expect(large.ratio).toBeGreaterThanOrEqual(3);
    // Regardless of which fails, ratio is consistent between calls.
    expect(normal.ratio).toBeCloseTo(large.ratio, 5);
  });
});

describe("nearestPassingColor", () => {
  it("returns the input unchanged when it already passes", () => {
    expect(nearestPassingColor("#1f3b2e", "#faf7f2")).toBe("#1f3b2e");
  });

  it("darkens a too-light foreground against a light background", () => {
    const suggestion = nearestPassingColor("#d6b788", "#faf7f2");
    expect(suggestion).not.toBeNull();
    // Darker → lower luminance → foreground digits should be lower than start.
    const [r0, g0, b0] = ["#d6b788".slice(1, 3), "#d6b788".slice(3, 5), "#d6b788".slice(5, 7)];
    const [r1, g1, b1] = [
      suggestion!.slice(1, 3),
      suggestion!.slice(3, 5),
      suggestion!.slice(5, 7),
    ];
    expect(parseInt(r1!, 16) + parseInt(g1!, 16) + parseInt(b1!, 16)).toBeLessThan(
      parseInt(r0!, 16) + parseInt(g0!, 16) + parseInt(b0!, 16),
    );
    // Suggestion actually passes AA-normal.
    expect(contrastRatio(suggestion!, "#faf7f2")).toBeGreaterThanOrEqual(4.5);
  });

  it("lightens a too-dark foreground against a dark background", () => {
    // Dark navy on near-black should be flagged and the suggestion should
    // move toward white.
    const suggestion = nearestPassingColor("#22334a", "#0a0d12");
    expect(suggestion).not.toBeNull();
    expect(contrastRatio(suggestion!, "#0a0d12")).toBeGreaterThanOrEqual(4.5);
  });
});
