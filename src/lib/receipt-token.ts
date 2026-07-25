import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Signed receipt tokens. Orders are placed anonymously (no session), so
 * possession of this token IS the permission to read one order's receipt.
 * Same HMAC primitive + domain-separation tag pattern as preview tokens.
 *
 * Payload: { o: orderId, t: tenantId, iat, exp }. The tenantId rides
 * along so the receipt route can set the RLS GUC without a cross-tenant
 * lookup. TTL 30 days — a guest may want the receipt again next week;
 * after that the paper-trail question belongs to the venue, not the URL.
 */

const RECEIPT_TAG = "elv.r1";
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

interface Payload {
  o: string;
  t: string;
  iat: number;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET)
    .update(`${RECEIPT_TAG}.${payload}`)
    .digest("base64url");
}

export function signReceiptToken(
  orderId: string,
  tenantId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { o: orderId, t: tenantId, iat: now, exp: now + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyReceiptToken(token: string): { orderId: string; tenantId: string } | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Payload;
    if (typeof payload.o !== "string" || typeof payload.t !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { orderId: payload.o, tenantId: payload.t };
  } catch {
    return null;
  }
}
