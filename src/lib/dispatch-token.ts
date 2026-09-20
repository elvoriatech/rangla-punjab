import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Signed dispatch tokens — the credential printed into the QR on a
 * delivery ticket.
 *
 * Whoever scans that QR is holding the paper ticket, which means they are
 * standing in the kitchen with the food. That is the whole authorisation
 * model, and it is the right one: a driver should not have to log in with
 * one hand while carrying two bags with the other.
 *
 * It is safe precisely because of how little the token can do. The only
 * action it authorises is `ready → out_for_delivery` on one specific
 * order — a transition that is idempotent, that the kitchen can reverse
 * from the board, and that reveals nothing a person holding the ticket
 * cannot already read off it. It cannot cancel, refund, re-price, or
 * touch any other order.
 *
 * Same HMAC primitive as receipt tokens with its OWN domain-separation
 * tag, so a receipt link — which guests have, and forward — can never be
 * replayed to dispatch an order, and this token can never be replayed to
 * read a receipt.
 *
 * TTL is short by comparison with a receipt's 30 days: a printed ticket
 * is driven within the hour. Seven days is slack for a reprint and a
 * clock that disagrees, and still means a ticket found in a bin next
 * month does nothing.
 */

const DISPATCH_TAG = "elv.d1";

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

interface Payload {
  o: string;
  t: string;
  iat: number;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET)
    .update(`${DISPATCH_TAG}.${payload}`)
    .digest("base64url");
}

export function signDispatchToken(
  orderId: string,
  tenantId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { o: orderId, t: tenantId, iat: now, exp: now + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyDispatchToken(token: string): { orderId: string; tenantId: string } | null {
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
