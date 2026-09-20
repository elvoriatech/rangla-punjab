import { describe, expect, it } from "vitest";
import {
  GIFT_CARD_ALPHABET,
  GIFT_CARD_CODE_LENGTH,
  formatGiftCardCode,
  generateGiftCardCode,
  maskGiftCardCode,
  normalizeGiftCardCode,
} from "./gift-card-code";

describe("gift-card alphabet", () => {
  it("is 32 unambiguous characters", () => {
    expect(GIFT_CARD_ALPHABET).toHaveLength(32);
    expect(new Set(GIFT_CARD_ALPHABET).size).toBe(32);
  });

  it("omits the characters people misread off a printed card", () => {
    for (const ch of ["I", "L", "O", "U"]) {
      expect(GIFT_CARD_ALPHABET).not.toContain(ch);
    }
  });
});

describe("generateGiftCardCode", () => {
  it("produces 12 in-alphabet characters", () => {
    const code = generateGiftCardCode();
    expect(code).toHaveLength(GIFT_CARD_CODE_LENGTH);
    for (const ch of code) expect(GIFT_CARD_ALPHABET).toContain(ch);
  });

  it("does not repeat itself across a large draw", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateGiftCardCode()));
    expect(codes.size).toBe(2000);
  });

  it("uses most of the alphabet over many draws (not a stuck RNG)", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateGiftCardCode()).join(""));
    expect(seen.size).toBe(32);
  });
});

describe("normalizeGiftCardCode", () => {
  it("accepts the canonical form unchanged", () => {
    expect(normalizeGiftCardCode("ABCD2345EFGH")).toBe("ABCD2345EFGH");
  });

  it("accepts the dashed display form", () => {
    expect(normalizeGiftCardCode("ABCD-2345-EFGH")).toBe("ABCD2345EFGH");
  });

  it("accepts lower case and stray whitespace", () => {
    expect(normalizeGiftCardCode("  abcd 2345 efgh ")).toBe("ABCD2345EFGH");
  });

  it("folds the Crockford confusables a human types", () => {
    // I and L both mean 1; O means 0.
    expect(normalizeGiftCardCode("IBCD-2345-EFGH")).toBe("1BCD2345EFGH");
    expect(normalizeGiftCardCode("LBCD-2345-EFGH")).toBe("1BCD2345EFGH");
    expect(normalizeGiftCardCode("OBCD-2345-EFGH")).toBe("0BCD2345EFGH");
  });

  it("extracts the code from a pasted or scanned share URL", () => {
    expect(normalizeGiftCardCode("https://example.com/gift-cards/ABCD2345EFGH?token=xyz")).toBe(
      "ABCD2345EFGH",
    );
    expect(normalizeGiftCardCode("https://example.com/gift-cards/ABCD-2345-EFGH")).toBe(
      "ABCD2345EFGH",
    );
  });

  it("rejects a near miss rather than resolving a different card", () => {
    expect(normalizeGiftCardCode("ABCD2345EFG")).toBeNull(); // 11 chars
    expect(normalizeGiftCardCode("ABCD2345EFGHJ")).toBeNull(); // 13 chars
    expect(normalizeGiftCardCode("")).toBeNull();
    expect(normalizeGiftCardCode("ABCD2345EFG!")).toBeNull();
    // U is not in the alphabet and has no defined substitution.
    expect(normalizeGiftCardCode("UBCD2345EFGH")).toBeNull();
  });

  it("round-trips every generated code", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateGiftCardCode();
      expect(normalizeGiftCardCode(formatGiftCardCode(code))).toBe(code);
    }
  });
});

describe("formatGiftCardCode / maskGiftCardCode", () => {
  it("groups in fours", () => {
    expect(formatGiftCardCode("ABCD2345EFGH")).toBe("ABCD-2345-EFGH");
  });

  it("masks all but the last four", () => {
    expect(maskGiftCardCode("ABCD2345EFGH")).toBe("····EFGH");
    expect(maskGiftCardCode("ABCD2345EFGH")).not.toContain("ABCD");
  });
});
