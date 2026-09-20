import { randomInt } from "node:crypto";

/**
 * Gift-card codes.
 *
 * A gift card is a BEARER instrument: whoever can read the code can
 * spend it, at the counter or in the app cart. That pins both ends of
 * the design —
 *
 *   * it must be unguessable, so the code is drawn from a CSPRNG, not
 *     from a counter or a timestamp; and
 *   * it must survive being read aloud across a noisy dining room and
 *     typed by someone holding a phone in the other hand.
 *
 * Hence Crockford's base32 alphabet: the ten digits plus the twenty-two
 * consonants and vowels that are left once I, L, O and U are removed.
 * I/1, L/1 and O/0 are the confusions that actually happen on a printed
 * card; U is dropped by Crockford so a random string cannot spell
 * something the owner has to apologise for.
 *
 * 12 characters of that alphabet is 60 bits — about 1.15e18 codes. At a
 * million cards a venue would still be at a ~1e-12 chance of a single
 * collision, and the DB unique index is the backstop regardless.
 */

/** Crockford base32, minus nothing else. Order matters: index == value. */
export const GIFT_CARD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const GIFT_CARD_CODE_LENGTH = 12;

/** How many characters between the dashes in the display form. */
const GROUP_SIZE = 4;

/**
 * Characters a human writes that we accept as another character. These
 * are the substitutions Crockford defines, and nothing more — we do not
 * guess at, say, S/5, because that would make two distinct valid codes
 * collide.
 */
const CONFUSABLES: Record<string, string> = {
  I: "1",
  L: "1",
  O: "0",
};

/**
 * A fresh random code in canonical (undashed, uppercase) form.
 *
 * `randomInt` is used per character rather than slicing a random buffer
 * modulo 32 — 32 divides 256 evenly so modulo would in fact be fair
 * here, but the moment someone edits the alphabet that stops being true
 * silently. `randomInt` is unbiased for any length.
 */
export function generateGiftCardCode(length: number = GIFT_CARD_CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += GIFT_CARD_ALPHABET[randomInt(GIFT_CARD_ALPHABET.length)];
  }
  return out;
}

/**
 * Turn whatever the guest typed or scanned into the canonical form we
 * store, or null if it cannot be one of our codes.
 *
 * Accepts: lower case, spaces, dashes, the confusable letters above, and
 * a full share URL pasted by someone who copied the link instead of the
 * code. Rejects anything that is not exactly `GIFT_CARD_CODE_LENGTH`
 * alphabet characters once cleaned, so a near-miss fails loudly at the
 * counter instead of silently looking up a different card.
 */
export function normalizeGiftCardCode(input: string): string | null {
  if (typeof input !== "string") return null;

  // A scanned QR yields our share URL; the code is its last path segment
  // before any query string. Pull it out rather than making the cashier
  // retype what the camera already read.
  let raw = input.trim();
  const urlMatch = /\/gift-cards\/([^/?#]+)/i.exec(raw);
  if (urlMatch) raw = urlMatch[1];

  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .split("")
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join("");

  if (cleaned.length !== GIFT_CARD_CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!GIFT_CARD_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

/** `ABCD-EFGH-JKMN` — the form we print, email and show on screen. */
export function formatGiftCardCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += GROUP_SIZE) {
    groups.push(code.slice(i, i + GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * `····1234` — the last four, for order lines, receipts and lists where
 * printing the whole bearer code would leak it to anyone who can see the
 * kitchen screen or the accountant's CSV.
 */
export function maskGiftCardCode(code: string): string {
  return `····${code.slice(-4)}`;
}
