import { createHash, randomBytes } from "node:crypto";

/**
 * One-shot auth tokens (verify email, reset password). The user sees the
 * plaintext token exactly once in an emailed link; the DB stores only its
 * SHA-256 hash, so a DB dump does not leak usable tokens. Rotation and
 * single-use are enforced by the row's `used_at` and `expires_at`.
 *
 * 32 bytes of entropy → 43 base64url chars. That is enough space that
 * brute-forcing a single token by guessing is intractable even without
 * rate limits (added in P1-2c).
 */

export interface IssuedToken {
  /** Shown to the user in the email link; never stored. */
  plaintext: string;
  /** Stored in the DB; compared with the hash of an incoming plaintext. */
  hash: string;
}

export function issueToken(): IssuedToken {
  const plaintext = randomBytes(32).toString("base64url");
  return { plaintext, hash: hashToken(plaintext) };
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}
