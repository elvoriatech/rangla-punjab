import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/**
 * Argon2id, tuned per OWASP 2024 minimums:
 *   memoryCost ≥ 19 MiB, timeCost ≥ 2, parallelism = 1.
 * We sit slightly above the floor so mainstream hardware feels this — a hash
 * takes ~40 ms on a modern laptop, which is negligible for a login flow and
 * expensive enough for offline guessing. `@node-rs/argon2` ships musl
 * prebuilds so alpine images don't need a native toolchain.
 *
 * `algorithm: 2` = Argon2id. The library exports `Algorithm` as a *const
 * enum*, which TypeScript's isolatedModules refuses to import — inlining
 * the numeric value with a comment is the standard workaround.
 */
const PARAMS = {
  algorithm: 2,
  memoryCost: 19 * 1024, // 19 MiB in KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, PARAMS);
}

/**
 * Constant-time verification via argon2's built-in check. Returns false on
 * any decode failure (malformed stored hash, wrong variant, tampered
 * envelope) so callers never need to distinguish.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, plain);
  } catch {
    return false;
  }
}
