import { describe, expect, it } from "vitest";
import {
  contactConfigSchema,
  contactEmpty,
  displayPhone,
  emailHref,
  normalizeEmail,
  normalizePhone,
  parseContactConfig,
  publicContact,
  telHref,
  whatsappHref,
} from "./contact-config";

/**
 * The contact card is three phone numbers and an address, and every bug it
 * can have is a normalisation bug: a number that dials nowhere, a `wa.me`
 * link that opens an empty chat, a `mailto:` that bounces, or an owner's
 * typo silently stored as "nothing published".
 */

describe("normalizePhone", () => {
  it("accepts the four spellings a German restaurant actually writes", () => {
    for (const raw of [
      "+49 7531 123456",
      "+4975311 23456",
      "0049 7531 123456",
      "0049-7531-123456",
      "07531 123456",
      "0 7531 / 123 456",
      "(07531) 123-456",
      "7531 123456",
    ]) {
      expect(normalizePhone(raw), raw).toBe("+497531123456");
    }
  });

  it("keeps a foreign number as typed rather than re-homing it", () => {
    expect(normalizePhone("+41 44 668 1800")).toBe("+41446681800");
    expect(normalizePhone("0041 44 668 1800")).toBe("+41446681800");
    // "00" wins over the trunk-zero rule: 0044… is Britain, not +49 044…
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
    // Which also means "00" is ALWAYS read as the IDD prefix — "007531…"
    // is country code 7, not a German number with a stray zero. Nothing
    // can tell those apart, and guessing would invent a country.
    expect(normalizePhone("007531123456")).toBe("+7531123456");
  });

  it("follows the venue's own country for national numbers", () => {
    expect(normalizePhone("07531 123456", "AT")).toBe("+437531123456");
    expect(normalizePhone("07531 123456", "CH")).toBe("+417531123456");
    // International input ignores the default entirely.
    expect(normalizePhone("+49 7531 123456", "CH")).toBe("+497531123456");
    // An unknown country falls back to Germany rather than refusing.
    expect(normalizePhone("07531 123456", "ZZ")).toBe("+497531123456");
  });

  it("refuses anything that is not a phone number", () => {
    for (const raw of [
      "",
      "   ",
      "call us!",
      "0170 123 456 ext 7",
      "+49 (0)7531 ABC",
      "07531-12 34 56x",
      "+",
      "00",
      "0",
      "0049",
      // Too short to dial: an extension or half a number.
      "0 12",
      "+49 123",
      // Past E.164's 15-digit ceiling.
      "+4912345678901234567",
      "00491234567890123456",
      null,
      undefined,
      49_7531,
      ["+497531123456"],
    ]) {
      expect(normalizePhone(raw), String(raw)).toBeNull();
    }
  });
});

describe("normalizeEmail", () => {
  it("stores the address trimmed and lower-cased", () => {
    expect(normalizeEmail("  Info@Restaurant.DE  ")).toBe("info@restaurant.de");
    expect(normalizeEmail("hallo+tisch@ristorante-volpe.example")).toBe(
      "hallo+tisch@ristorante-volpe.example",
    );
    expect(normalizeEmail("a@b.co")).toBe("a@b.co");
  });

  it("refuses anything that is not an address", () => {
    for (const raw of [
      "",
      "   ",
      "info",
      "info@",
      "@restaurant.de",
      "info restaurant.de",
      "info@restaurant",
      "info@@restaurant.de",
      // Past the 120-character ceiling.
      `${"a".repeat(115)}@restaurant.de`,
      null,
      undefined,
      7,
      ["info@restaurant.de"],
    ]) {
      expect(normalizeEmail(raw), String(raw)).toBeNull();
    }
  });
});

describe("link builders", () => {
  it("mailto: is the address, exactly as stored", () => {
    expect(emailHref("info@restaurant.de")).toBe("mailto:info@restaurant.de");
  });

  it("tel: keeps the plus and wa.me drops it", () => {
    expect(telHref("+497531123456")).toBe("tel:+497531123456");
    expect(whatsappHref("+497531123456")).toBe("https://wa.me/497531123456");
  });

  it("groups a number simply for reading aloud", () => {
    expect(displayPhone("+497531123456")).toBe("+49 7531 123456");
    expect(displayPhone("+41446681800")).toBe("+41 4466 81800");
    // Zone 1 and 7 carry a single-digit country code.
    expect(displayPhone("+12125550123")).toBe("+1 2125 550123");
    expect(displayPhone("+74951234567")).toBe("+7 4951 234567");
  });
});

describe("parseContactConfig", () => {
  it("reads a stored config back", () => {
    expect(
      parseContactConfig({
        landline: "+497531123456",
        mobile: "+491701234567",
        whatsapp: "+491701234567",
        email: "info@restaurant.de",
      }),
    ).toEqual({
      landline: "+497531123456",
      mobile: "+491701234567",
      whatsapp: "+491701234567",
      email: "info@restaurant.de",
    });
  });

  it("treats an empty, missing or unreadable blob as nothing published at all", () => {
    for (const raw of [undefined, null, {}, "", 7, [], { landline: "hello" }, { email: "  " }]) {
      const parsed = parseContactConfig(raw);
      expect(parsed, JSON.stringify(raw)).toEqual({
        landline: null,
        mobile: null,
        whatsapp: null,
        email: null,
      });
      expect(contactEmpty(parsed)).toBe(true);
    }
  });

  it("an address alone is a published card", () => {
    const parsed = parseContactConfig({ email: " Info@Restaurant.DE " });
    expect(parsed.email).toBe("info@restaurant.de");
    expect(contactEmpty(parsed)).toBe(false);
  });

  it("survives a hand-edited row: one bad slot never costs the others", () => {
    expect(
      parseContactConfig({
        landline: "0 7531 123456",
        mobile: "n/a",
        whatsapp: 49_1701234567,
        email: "info@",
      }),
    ).toEqual({ landline: "+497531123456", mobile: null, whatsapp: null, email: null });
  });

  it("the schema itself never throws on garbage", () => {
    expect(
      contactConfigSchema.safeParse({ landline: {}, mobile: [], whatsapp: false, email: 7 })
        .success,
    ).toBe(true);
  });
});

describe("publicContact", () => {
  it("is null when the owner has published nothing", () => {
    expect(publicContact(parseContactConfig({}))).toBeNull();
    expect(publicContact({ landline: null, mobile: null, whatsapp: null, email: null })).toBeNull();
  });

  it("projects an address as its own display string, behind a mailto:", () => {
    const projected = publicContact(parseContactConfig({ email: "Info@Restaurant.DE" }));
    expect(projected?.email).toEqual({
      number: "info@restaurant.de",
      display: "info@restaurant.de",
      href: "mailto:info@restaurant.de",
    });
    // The three phone slots stay explicitly null — never a half-built
    // entry with an empty href.
    expect(projected?.landline).toBeNull();
    expect(projected?.mobile).toBeNull();
    expect(projected?.whatsapp).toBeNull();
  });

  it("projects each filled slot with its number, display and link", () => {
    const projected = publicContact(
      parseContactConfig({ landline: "07531 123456", whatsapp: "0170 1234567" }),
    );
    expect(projected).toEqual({
      landline: {
        number: "+497531123456",
        display: "+49 7531 123456",
        href: "tel:+497531123456",
      },
      // Not published — and therefore explicitly null, never a half-built
      // entry with an empty href. WhatsApp (and mobile) are never
      // published any more, even when a number is stored.
      mobile: null,
      whatsapp: null,
      email: null,
    });
  });
});
