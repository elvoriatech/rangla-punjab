import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Signed session tokens. Format: `<payload>.<sig>` where both parts are
 * base64url. The payload is the JSON `{ u: userId, exp: unixSeconds }`. The
 * signature is HMAC-SHA256(payload, SESSION_SECRET). Verification is
 * constant-time and rejects tampered payloads and expired tokens.
 *
 * We keep the format hand-rolled (no JWT) because we do not need JWK, `alg`,
 * or nested claims — one signed opaque token is enough for httpOnly session
 * carriage, and less surface area means fewer confused-deputy bugs.
 */

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface Payload {
  u: string; // userId
  iat: number; // unix seconds — issued-at, compared to `sessions_valid_from`
  exp: number; // unix seconds
  /** Impersonation: the platform-admin user who is viewing as `u`.
   *  Only ever set by the admin "log in as owner" action. */
  imp?: string;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

export function signSession(
  userId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  impersonatorId?: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = {
    u: userId,
    iat: now,
    exp: now + ttlSeconds,
    ...(impersonatorId ? { imp: impersonatorId } : {}),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export interface VerifiedSession {
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  impersonatorId: string | null;
}

export function verifySession(token: string): VerifiedSession | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const [encoded, sig] = [token.slice(0, dot), token.slice(dot + 1)];

  const expected = sign(encoded);
  // Constant-time comparison — a fast-path early return leaks whether the
  // first byte matched, which is enough to build an oracle over many tries.
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
      typeof (parsed as Payload).u !== "string" ||
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
    userId: payload.u,
    issuedAt: new Date(payload.iat * 1000),
    expiresAt: new Date(payload.exp * 1000),
    impersonatorId: typeof payload.imp === "string" ? payload.imp : null,
  };
}

function safeBuffer(base64url: string): Buffer | null {
  try {
    return Buffer.from(base64url, "base64url");
  } catch {
    return null;
  }
}
