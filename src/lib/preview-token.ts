import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Signed preview tokens for the phone-preview flow. Same HMAC-SHA256
 * primitive as session cookies (see `session.ts`), but with an explicit
 * `v` (version-tag) prefix so a session token cannot be substituted for
 * a preview token and vice-versa — cheap domain separation without a
 * second secret.
 *
 * Payload: { tenantId, venueId, iat, exp }. TTL is 1 hour by default —
 * long enough to walk around and check on your phone, short enough that
 * a leaked link expires quickly.
 */

const PREVIEW_TAG = "elv.p1"; // "guesto preview v1"
const DEFAULT_TTL_SECONDS = 60 * 60; // 1 h

interface Payload {
  t: string; // tenantId
  v: string; // venueId
  iat: number;
  exp: number;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}
function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}
function sign(payload: string): string {
  // Concatenating a fixed tag into the HMAC input makes it impossible for
  // a session-token forger to slide their signed payload into the preview
  // path (or vice-versa) — every namespace has its own HMAC space.
  return createHmac("sha256", env.SESSION_SECRET)
    .update(`${PREVIEW_TAG}.${payload}`)
    .digest("base64url");
}

export function signPreviewToken(
  tenantId: string,
  venueId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { t: tenantId, v: venueId, iat: now, exp: now + ttlSeconds };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export interface VerifiedPreview {
  tenantId: string;
  venueId: string;
  expiresAt: Date;
}

export function verifyPreviewToken(token: string): VerifiedPreview | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const [encoded, sig] = [token.slice(0, dot), token.slice(dot + 1)];

  const expected = sign(encoded);
  const sigBuf = safeBuffer(sig);
  const expBuf = safeBuffer(expected);
  if (!sigBuf || !expBuf || sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  let payload: Payload;
  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Payload).t !== "string" ||
      typeof (parsed as Payload).v !== "string" ||
      typeof (parsed as Payload).iat !== "number" ||
      typeof (parsed as Payload).exp !== "number"
    ) {
      return null;
    }
    payload = parsed as Payload;
  } catch {
    return null;
  }

  if (payload.exp * 1000 <= Date.now()) return null;
  return {
    tenantId: payload.t,
    venueId: payload.v,
    expiresAt: new Date(payload.exp * 1000),
  };
}

function safeBuffer(base64url: string): Buffer | null {
  try {
    return Buffer.from(base64url, "base64url");
  } catch {
    return null;
  }
}
