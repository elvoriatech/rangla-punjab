import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";
import { env } from "./env";

/**
 * Encrypt-at-rest for operator/restaurant-managed secrets (Stripe keys), so
 * they can be changed from the UI without a redeploy but never sit in the DB
 * in plaintext.
 *
 * The AES key is derived from the app's SESSION_SECRET via HKDF (a distinct
 * label keeps it separate from cookie signing), so no new env var is needed
 * and the root key never lives in the database. Rotating SESSION_SECRET
 * invalidates stored secrets — they must be re-entered, which is the correct,
 * safe failure mode.
 *
 * Format: base64( iv[12] || authTag[16] || ciphertext ), AES-256-GCM.
 */

function aesKey(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", env.SESSION_SECRET, Buffer.alloc(0), "rangla.secret.v1", 32),
  );
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    const raw = Buffer.from(enc, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const d = createDecipheriv("aes-256-gcm", aesKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    // Tampered ciphertext or a rotated SESSION_SECRET — treat as "not set".
    return null;
  }
}

/**
 * A safe-to-display hint: keeps the leading marker (so `sk_live_` vs
 * `sk_test_` is visible — important for spotting a live key) and the last 4
 * chars, everything else bulleted. Never reconstructs the secret.
 */
export function maskSecret(plain: string): string {
  const s = plain.trim();
  if (s.length <= 8) return "•".repeat(Math.max(4, s.length));
  return `${s.slice(0, 8)}${"•".repeat(6)}${s.slice(-4)}`;
}
