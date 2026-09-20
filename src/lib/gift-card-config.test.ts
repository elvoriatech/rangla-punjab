import { describe, expect, it } from "vitest";
import {
  GIFT_CARD_DEFAULTS,
  GIFT_CARD_RECOMMENDED_EXPIRY_MONTHS,
  GIFT_CARD_RISKY_EXPIRY_BELOW_MONTHS,
  isRiskyExpiry,
  parseGiftCardConfig,
} from "./gift-card-config";

/**
 * `venues.gift_cards` is a JSONB blob an owner edits through a form and a
 * developer occasionally edits by hand. The one promise this parser makes
 * is that it NEVER throws: a settings row that threw would take a paid
 * product off sale, silently, for every guest.
 *
 * So every case below asserts a usable config came back — not that the
 * input was rejected.
 */

describe("parseGiftCardConfig", () => {
  it("defaults an absent or empty blob to enabled, three years", () => {
    // Deliberately UNLIKE loyalty, whose `enabled` defaults false: a gift
    // card is a product the owner asked for, and visibility is already
    // gated by each design's own `active` flag.
    for (const raw of [undefined, null, {}]) {
      expect(parseGiftCardConfig(raw)).toEqual({ enabled: true, expiryMonths: 36 });
    }
    expect(GIFT_CARD_DEFAULTS.enabled).toBe(true);
    expect(GIFT_CARD_RECOMMENDED_EXPIRY_MONTHS).toBe(36);
  });

  it("keeps what the owner actually chose", () => {
    expect(parseGiftCardConfig({ enabled: false, expiryMonths: 12 })).toEqual({
      enabled: false,
      expiryMonths: 12,
    });
    // Unknown keys from an older schema version ride along harmlessly.
    expect(parseGiftCardConfig({ enabled: true, expiryMonths: 24, legacyField: "x" })).toEqual({
      enabled: true,
      expiryMonths: 24,
    });
  });

  it("reads a number the form stored as a string, comma decimal included", () => {
    expect(parseGiftCardConfig({ expiryMonths: "18" }).expiryMonths).toBe(18);
    expect(parseGiftCardConfig({ expiryMonths: " 24 " }).expiryMonths).toBe(24);
    expect(parseGiftCardConfig({ expiryMonths: "11,6" }).expiryMonths).toBe(12);
    // Whole months only — the expiry is a calendar date, not a duration.
    expect(parseGiftCardConfig({ expiryMonths: 11.6 }).expiryMonths).toBe(12);
  });

  it("falls back to the default for a term nobody can have meant", () => {
    // 0 reads as "never chose" (the shape a legacy row holds), negatives
    // and anything past the 120-month ceiling as a typo.
    for (const months of [0, -6, 121, 999, NaN, Infinity, "", "abc", null, {}]) {
      expect(parseGiftCardConfig({ expiryMonths: months }).expiryMonths).toBe(36);
    }
    // The boundaries themselves are legal values, not typos.
    expect(parseGiftCardConfig({ expiryMonths: 1 }).expiryMonths).toBe(1);
    expect(parseGiftCardConfig({ expiryMonths: 120 }).expiryMonths).toBe(120);
  });

  it("survives a blob that is not an object at all", () => {
    for (const raw of ["garbage", 7, [1, 2], true]) {
      expect(parseGiftCardConfig(raw)).toEqual({ enabled: true, expiryMonths: 36 });
    }
  });

  it("falls back to the WHOLE default set when `enabled` is not a boolean", () => {
    // Known posture, shared with `loyalty-config.ts`: `enabled` is the one
    // field with no `.catch()`, so a non-boolean fails the object parse and
    // the sibling `expiryMonths` resets with it. That costs an owner a
    // hand-edited term; it does not cost anyone a thrown settings read,
    // which is the guarantee this parser exists to make. If that trade is
    // ever revisited, this test is the one to change.
    expect(parseGiftCardConfig({ enabled: "yes", expiryMonths: 24 })).toEqual({
      enabled: true,
      expiryMonths: 36,
    });
    expect(parseGiftCardConfig({ enabled: 1, expiryMonths: 24 })).toEqual({
      enabled: true,
      expiryMonths: 36,
    });
  });
});

describe("isRiskyExpiry", () => {
  it("warns below a year and stays quiet at or above it", () => {
    // § 195 BGB gives a paid voucher three years; anything under a year is
    // the range a court is most likely to strike out, so the settings form
    // has to have shown the hint.
    expect(GIFT_CARD_RISKY_EXPIRY_BELOW_MONTHS).toBe(12);
    expect(isRiskyExpiry(1)).toBe(true);
    expect(isRiskyExpiry(11)).toBe(true);
    expect(isRiskyExpiry(12)).toBe(false);
    expect(isRiskyExpiry(36)).toBe(false);
    // The recommended value must never be one the form warns about.
    expect(isRiskyExpiry(GIFT_CARD_RECOMMENDED_EXPIRY_MONTHS)).toBe(false);
  });
});
