import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { asTenant } from "./tenant";
import { sendVerificationEmail } from "./verification-service";
import { captureException } from "./observability";

/**
 * Auth service — the shape that route handlers, server actions, and tests
 * all share. No HTTP or cookie concerns leak in here; those live in the
 * route handler that wraps this. Errors are enum-shaped so callers can map
 * them to status codes without string matching.
 */

export type SignupResult =
  { ok: true; userId: string; tenantId: string } | { ok: false; error: "email_taken" | "invalid" };

export type LoginResult =
  { ok: true; userId: string } | { ok: false; error: "invalid_credentials" };

export interface SignupInput {
  email: string;
  password: string;
  tenantName: string;
}

/**
 * Signup: create the user (cross-tenant, no RLS), then atomically create the
 * new tenant + owner membership under that tenant's GUC. `WITH CHECK` on
 * RLS proves both writes belong to the tenant being provisioned.
 */
export async function signupUser(input: SignupInput): Promise<SignupResult> {
  const email = input.email.trim();
  const passwordHash = await hashPassword(input.password);
  const tenantId = randomUUID();

  try {
    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: { id: true },
    });

    await asTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: input.tenantName } });
      await tx.membership.create({
        data: { userId: user.id, tenantId, role: "owner" },
      });
    });

    // Fire-and-forget the verification email so signup latency is bounded
    // by the DB writes above. A dropped email is far less bad than a hung
    // signup response — the user can request a new one from the settings
    // page (P1-4) via `POST /api/auth/verify/request`.
    void sendVerificationEmail(user.id, email).catch((err) => {
      captureException(err, { path: "signup/sendVerificationEmail", userId: user.id });
    });

    return { ok: true, userId: user.id, tenantId };
  } catch (err) {
    // P2002 = unique constraint (email). Distinct from generic invalid so
    // the UI can surface "email already in use" without leaking timing.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "email_taken" };
    }
    throw err;
  }
}

/**
 * Login: look up user by email, verify Argon2id. Always runs the verify
 * step even when the user is missing (against a dummy hash produced with
 * our own params) so response time doesn't leak email existence.
 */
export async function loginUser(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim(), deletedAt: null },
    select: { id: true, passwordHash: true },
  });

  const hashToCheck = user?.passwordHash ?? (await getDummyHash());
  const ok = await verifyPassword(hashToCheck, password);

  if (!user || !ok) return { ok: false, error: "invalid_credentials" };
  return { ok: true, userId: user.id };
}

/**
 * Minimum length for an OWNER password — the one this deploy's dashboard
 * and the app's restaurant mode share.
 *
 * 12, not 8, because that is already the policy every other place an owner
 * password is CHOSEN enforces: `POST /api/auth/reset/[token]` and the
 * no-JS `resetPasswordAction` both carry `z.string().min(12)`. A change
 * form that accepted 8 would be a back door around the reset form's own
 * rule. (Guests are a different account family with their own, lower,
 * `CUSTOMER_PASSWORD_MIN_LENGTH` — see `customer-auth.ts`.)
 */
export const OWNER_PASSWORD_MIN_LENGTH = 12;
/** Argon2id costs the same at any length; the cap just bounds the body. */
export const OWNER_PASSWORD_MAX_LENGTH = 1024;

export type ChangePasswordError = "wrong_password" | "too_short" | "same_as_current" | "mismatch";

export type ChangePasswordResult =
  | {
      ok: true;
      /** The new session cutoff. Every credential issued before this
       *  instant is dead — callers that want to keep the CURRENT device
       *  signed in must mint a fresh one AFTER this returns. */
      sessionsValidFrom: Date;
    }
  | { ok: false; error: ChangePasswordError };

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  /** The "confirm new password" box, when the caller has one. Omitted
   *  (API clients that only send two fields) means "nothing to compare",
   *  never "mismatch". */
  confirmPassword?: string;
}

/**
 * Change a signed-in owner's own password.
 *
 * The current password is required and checked FIRST: a dashboard left
 * open on a counter tablet, or an app handed over the pass, must not let
 * the next person set a new one. It is also why a wrong current password
 * short-circuits before the policy checks — an attacker who cannot get
 * past it learns nothing about what we would have accepted.
 *
 * On success `sessions_valid_from` is bumped in the SAME write as the new
 * hash, which is this codebase's one mechanism for "sign every other
 * device out" (see the column's comment in `prisma/schema.prisma` and
 * `verifySessionValue`). It is indiscriminate — the cookie or staff token
 * the caller arrived with dies too — so both surfaces re-issue afterwards:
 * the dashboard rewrites its cookie, the API answers with a fresh staff
 * token. Changing your password on the device in your hand should not log
 * you out of the device in your hand.
 */
export async function changeUserPassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, passwordHash: true },
  });

  // Same dummy-hash trick as `loginUser`: a deleted or vanished user costs
  // the same ~40 ms as a real one, and answers the same way.
  const hashToCheck = user?.passwordHash ?? (await getDummyHash());
  const currentOk = await verifyPassword(hashToCheck, input.currentPassword);
  if (!user || !currentOk) return { ok: false, error: "wrong_password" };

  if (input.confirmPassword !== undefined && input.confirmPassword !== input.newPassword) {
    return { ok: false, error: "mismatch" };
  }
  if (
    input.newPassword.length < OWNER_PASSWORD_MIN_LENGTH ||
    input.newPassword.length > OWNER_PASSWORD_MAX_LENGTH
  ) {
    return { ok: false, error: "too_short" };
  }
  // Re-saving the same password would bump the cutoff and sign every other
  // device out for no change at all — almost always a mis-typed form.
  if (input.newPassword === input.currentPassword) {
    return { ok: false, error: "same_as_current" };
  }

  const passwordHash = await hashPassword(input.newPassword);
  const sessionsValidFrom = new Date();
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, sessionsValidFrom },
  });
  return { ok: true, sessionsValidFrom };
}

// Real Argon2id hash produced lazily with our params, so an unknown-email
// login incurs the same ~40 ms verify cost as a real one and its envelope
// is always compatible with the current PARAMS.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("__guesto_dummy_hash_never_a_real_password__");
  return dummyHashPromise;
}
