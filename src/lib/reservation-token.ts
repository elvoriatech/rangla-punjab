import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Signed reservation tokens — the receipt-token pattern (`receipt-token.ts`),
 * pointed at a table request instead of an order.
 *
 * A reservation can be made without an account, so possession of this
 * token IS the permission to read one reservation's status. Own HMAC
 * domain-separation tag, so a receipt token can never be replayed as a
 * reservation token or the other way round.
 *
 * Payload: { r: reservationId, t: tenantId, iat, exp }. The tenantId rides
 * along so the status route can set the RLS GUC without a cross-tenant
 * lookup. TTL 90 days — long enough that a table booked two months out is
 * still trackable the morning after, and it matches the customer session
 * TTL so a signed-in guest's links never outlive their sign-in by much.
 */

const RESERVATION_TAG = "elv.rv1";
const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60;

interface Payload {
  r: string;
  t: string;
  iat: number;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET)
    .update(`${RESERVATION_TAG}.${payload}`)
    .digest("base64url");
}

export function signReservationToken(
  reservationId: string,
  tenantId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { r: reservationId, t: tenantId, iat: now, exp: now + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyReservationToken(
  token: string,
): { reservationId: string; tenantId: string } | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Payload;
    if (typeof payload.r !== "string" || typeof payload.t !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { reservationId: payload.r, tenantId: payload.t };
  } catch {
    return null;
  }
}
