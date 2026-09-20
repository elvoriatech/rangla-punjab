import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Signed gift-card share tokens.
 *
 * The share page is the link a buyer forwards to whoever they are
 * gifting. It has no session, so possession of this token is what lets
 * the page be rendered — the same posture as receipt tokens, and the
 * same HMAC primitive with its own domain-separation tag so a receipt
 * token can never be replayed as a share token or the reverse.
 *
 * What the token protects is ENUMERATION, not the card. The code itself
 * is the bearer instrument and it is printed on the page; the token only
 * stops someone walking `/gift-cards/AAAA-AAAA-AAAA`, `AAAB…` and
 * harvesting live codes. That is why the payload carries the code it was
 * minted for: a token is good for exactly one card.
 *
 * TTL is deliberately long. A gift card lives 36 months by default and
 * the recipient may open the link the week it expires, so the token has
 * to outlive the card rather than the card outliving its own link. It is
 * capped rather than infinite so a leaked link eventually stops working.
 */

const GIFT_CARD_TAG = "elv.g1";

/** Four years — comfortably past the 36-month default expiry. */
const DEFAULT_TTL_SECONDS = 4 * 365 * 24 * 60 * 60;

interface Payload {
  /** The card's code, canonical (undashed, uppercase). */
  c: string;
  /** Tenant, so the page can set the RLS GUC without a cross-tenant scan. */
  t: string;
  iat: number;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET)
    .update(`${GIFT_CARD_TAG}.${payload}`)
    .digest("base64url");
}

export function signGiftCardToken(
  code: string,
  tenantId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { c: code, t: tenantId, iat: now, exp: now + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyGiftCardToken(token: string): { code: string; tenantId: string } | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Payload;
    if (typeof payload.c !== "string" || typeof payload.t !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { code: payload.c, tenantId: payload.t };
  } catch {
    return null;
  }
}
