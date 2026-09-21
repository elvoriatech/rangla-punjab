import { z } from "zod";

/**
 * The restaurant's own ways of being reached — the "Contact" card in
 * Dashboard → Settings (and its twin in the app), stored in `venues.contact`
 * JSONB.
 *
 * Four slots, no more: a LANDLINE (the number on the door), a MOBILE (the
 * one someone actually carries during service), a WHATSAPP number and an
 * E-MAIL address. Four because that is what a guest can act on from a menu —
 * ring the restaurant, ring the manager, message them, write to them — and
 * because a list of arbitrary length turns a settings card into an editor
 * nobody asked for.
 *
 * Numbers are stored NORMALISED, in E.164 (`+497531123456`). That is the one
 * spelling every surface can build from: `tel:` wants the plus, `wa.me` wants
 * the digits without it, and the human-readable grouping is derived on read.
 * Storing what the owner typed would mean every surface guessing at spaces,
 * slashes and a leading zero — and a `wa.me/0 7531 …` link that silently goes
 * nowhere.
 *
 * Same tolerant posture as `loyalty-config.ts` / `ordering-config.ts`: a
 * half-filled or hand-edited blob must never fail the whole parse, because a
 * venue whose contact JSON throws would lose its menu, not just its phone
 * numbers. Anything unreadable in a slot reads back as `null` — "no number
 * published" — which every surface already renders as nothing at all.
 */

/** The four slots, in the order every surface renders them. */
export const CONTACT_FIELDS = ["landline", "mobile", "whatsapp", "email"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

/** The slots that hold a phone number — everything `normalizePhone` owns.
 *  `email` is the one slot that does not, so anything walking the fields to
 *  validate a number asks here rather than assuming all of them. */
export const CONTACT_PHONE_FIELDS = ["landline", "mobile", "whatsapp"] as const;
export type ContactPhoneField = (typeof CONTACT_PHONE_FIELDS)[number];

export function isContactPhoneField(field: ContactField): field is ContactPhoneField {
  return field !== "email";
}

/**
 * Country dial codes for the trunk-prefix rule below. Deliberately small:
 * it only has to cover the markets this product sells into, and an unknown
 * `defaultCountry` falls back to Germany rather than refusing the number.
 */
const DIAL_CODES: Record<string, string> = {
  DE: "49",
  AT: "43",
  CH: "41",
  FR: "33",
  IT: "39",
  ES: "34",
  NL: "31",
  BE: "32",
  LU: "352",
  PL: "48",
  CZ: "420",
  DK: "45",
  SE: "46",
  NO: "47",
  GB: "44",
  IE: "353",
  PT: "351",
  TR: "90",
  HU: "36",
  RO: "40",
};

/** Longest string `normalizePhone` will ever return (`+` + 15 digits is
 *  E.164's own ceiling; 20 leaves room and bounds the column). */
export const MAX_PHONE_LENGTH = 20;

/**
 * Fewest digits an accepted number may carry IN TOTAL, country code
 * included. Below this it is a typo — half a number, a house number, an
 * extension someone typed on its own. Eight is under every dialable
 * landline in the markets `DIAL_CODES` covers (Denmark's +45 plus eight
 * digits is the shortest of them, at ten) and well over a fat-fingered
 * fragment, which is the only judgement this needs to make.
 */
const MIN_TOTAL_DIGITS = 8;

/**
 * Whatever the owner typed → E.164, or null when it is not a phone number.
 *
 * Accepts the four spellings a European restaurant actually writes on its
 * own door, and nothing else:
 *
 *   `+49 7531 123456`  → +497531123456   (already international)
 *   `0049 7531-123456` → +497531123456   (IDD prefix)
 *   `0 7531 / 123 456` → +497531123456   (national, trunk 0 → country code)
 *   `7531 123456`      → +497531123456   (national, trunk 0 omitted)
 *
 * Spaces (including non-breaking), dashes, dots, slashes and parentheses are
 * separators and are stripped. Anything else — a letter, a word, an extension
 * marker — makes the whole value null rather than a number with a character
 * quietly deleted out of the middle of it.
 */
export function normalizePhone(raw: unknown, defaultCountry = "DE"): string | null {
  if (typeof raw !== "string") return null;
  // Strip the separators a human uses, then insist on what is left.
  const cleaned = raw.replace(/[\s  ().\-/\\]/g, "").trim();
  if (cleaned.length === 0) return null;
  // A stray separator run could leave a bare sign; and the plus is only
  // ever legal at the very front.
  if (!/^\+?\d+$/.test(cleaned)) return null;

  const cc = DIAL_CODES[defaultCountry.toUpperCase()] ?? DIAL_CODES.DE!;

  let digits: string;
  if (cleaned.startsWith("+")) {
    digits = cleaned.slice(1);
  } else if (cleaned.startsWith("00")) {
    // IDD prefix — "0049 …" is the same number as "+49 …".
    digits = cleaned.slice(2);
  } else if (cleaned.startsWith("0")) {
    // National trunk prefix: exactly one leading zero is replaced by the
    // country code. "007531…" is neither, and drops out below.
    digits = cc + cleaned.slice(1);
  } else {
    // Bare national digits, trunk zero omitted (how a number is often
    // printed on a card): assume the venue's own country.
    digits = cc + cleaned;
  }

  if (!/^[1-9]\d*$/.test(digits)) return null; // no country code starts at 0
  if (digits.length > 15) return null; // E.164's own ceiling
  if (digits.length < MIN_TOTAL_DIGITS) return null;

  const e164 = `+${digits}`;
  return e164.length <= MAX_PHONE_LENGTH ? e164 : null;
}

/**
 * Longest address the e-mail slot will store. 120 is the same ceiling the
 * guest-facing order form uses, comfortably over every real mailbox and
 * short enough that the footer row cannot become a paragraph.
 */
export const MAX_EMAIL_LENGTH = 120;

/** One address, validated the same way everywhere. Trimmed and lower-cased
 *  first, because `Info@Restaurant.DE ` and `info@restaurant.de` are the
 *  same mailbox and only one of them should ever reach the JSONB. */
const emailSchema = z.string().trim().toLowerCase().email().max(MAX_EMAIL_LENGTH);

/**
 * Whatever the owner typed → a stored address, or null when it is not one.
 *
 * Same contract as `normalizePhone`: an empty (or whitespace-only) box is
 * "not published", and anything that is not an address is refused outright
 * rather than stored as a `mailto:` link that bounces.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** `mailto:` link for a stored address. Nothing is escaped because the
 *  address has already been through `normalizeEmail`, which admits no
 *  character that would need it. */
export function emailHref(address: string): string {
  return `mailto:${address}`;
}

/** `tel:` link for an E.164 number. The plus stays: it is what makes the
 *  number dialable from a phone roaming in another country. */
export function telHref(e164: string): string {
  return `tel:${e164}`;
}

/** WhatsApp's own click-to-chat link. `wa.me` takes the international
 *  number WITHOUT the plus and without any separator — a `+` there is the
 *  classic reason a WhatsApp link opens an empty chat. */
export function whatsappHref(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}

/**
 * E.164 → something a human can read back over the phone: the country code,
 * then the number in two simple groups (`+49 7531 123456`).
 *
 * Deliberately NOT real national formatting: getting Germany's variable area
 * codes (let alone every market's) right needs a metadata library we are not
 * shipping to a guest's phone, and a wrong "official" grouping reads worse
 * than an honest plain one. Country-code length follows E.164's zones — 1 and
 * 7 are single-digit, everything else is taken as two — which is right for
 * every market in `DIAL_CODES`.
 */
export function displayPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 0) return e164;
  const ccLength = digits.startsWith("1") || digits.startsWith("7") ? 1 : 2;
  const cc = digits.slice(0, ccLength);
  const rest = digits.slice(ccLength);
  if (rest.length <= 4) return `+${cc} ${rest}`.trim();
  return `+${cc} ${rest.slice(0, 4)} ${rest.slice(4)}`;
}

/** One slot: an E.164 string, or null for "not published". Tolerant — a
 *  value that is not a readable number becomes null instead of failing the
 *  whole config, and a hand-edited `0 7531 …` in the JSONB still reads. */
const phoneField = z.preprocess((v) => normalizePhone(v), z.string().nullable().catch(null));

/** The e-mail slot, with the same tolerance: an empty box, a half-typed
 *  address or a hand-edited number all read back as "not published". */
const emailField = z.preprocess((v) => normalizeEmail(v), z.string().nullable().catch(null));

export const contactConfigSchema = z.object({
  landline: phoneField.default(null),
  mobile: phoneField.default(null),
  whatsapp: phoneField.default(null),
  email: emailField.default(null),
});

export type ContactConfig = z.infer<typeof contactConfigSchema>;

/** Never throws. `{}`, null, a string, a half-written object — all of them
 *  parse to "no numbers published". */
export function parseContactConfig(raw: unknown): ContactConfig {
  const parsed = contactConfigSchema.safeParse(raw ?? {});
  return parsed.success
    ? parsed.data
    : { landline: null, mobile: null, whatsapp: null, email: null };
}

/** True when nothing is published — the whole feature renders nowhere. */
export function contactEmpty(config: ContactConfig): boolean {
  return CONTACT_FIELDS.every((f) => config[f] === null);
}

/** One way in, ready to render: what to dial or write to, what to show,
 *  where to link. */
export interface ContactEntry {
  /** The stored value: E.164 for a phone slot (`+497531123456`), the
   *  address itself for e-mail (`info@restaurant.de`). */
  number: string;
  /** Grouped for reading aloud (`+49 7531 123456`); for e-mail, the
   *  address unchanged — there is nothing to group. */
  display: string;
  /** `tel:+49…` for the two phone slots, `https://wa.me/49…` for WhatsApp,
   *  `mailto:…` for e-mail. */
  href: string;
}

/**
 * The public projection every guest surface gets — the web menu footer, the
 * account page, `/api/v1/menu`.
 *
 * Each slot carries the number AND the two strings derived from it, so no
 * client (least of all the React Native app) re-implements the `tel:` /
 * `wa.me` rules and gets a link subtly wrong.
 */
export interface PublicContact {
  landline: ContactEntry | null;
  mobile: ContactEntry | null;
  whatsapp: ContactEntry | null;
  email: ContactEntry | null;
}

export function publicContact(config: ContactConfig): PublicContact | null {
  if (contactEmpty(config)) return null;
  const entry = (number: string | null, whatsapp = false): ContactEntry | null =>
    number === null
      ? null
      : {
          number,
          display: displayPhone(number),
          href: whatsapp ? whatsappHref(number) : telHref(number),
        };
  return {
    landline: entry(config.landline),
    mobile: entry(config.mobile),
    whatsapp: entry(config.whatsapp, true),
    // An address needs no grouping and no derivation — it IS its own
    // display string, which is why it does not go through `entry`.
    email:
      config.email === null
        ? null
        : { number: config.email, display: config.email, href: emailHref(config.email) },
  };
}
