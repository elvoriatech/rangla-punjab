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

// Real Argon2id hash produced lazily with our params, so an unknown-email
// login incurs the same ~40 ms verify cost as a real one and its envelope
// is always compatible with the current PARAMS.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("__guesto_dummy_hash_never_a_real_password__");
  return dummyHashPromise;
}
