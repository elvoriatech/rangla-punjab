import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { asTenant } from "./tenant";
import { hashPassword, verifyPassword } from "./password";
import { siteUrl } from "./site-url";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * Customer sign-in — Google + Microsoft (Hotmail/Outlook personal
 * accounts), hand-rolled OIDC authorization-code flow, matching the
 * repo's no-auth-library decision. Identity = the provider's stable
 * `sub`; we store email/name for display, nothing more.
 *
 * Sessions are OPAQUE TOKENS (32 random bytes, stored SHA-256-hashed,
 * TTL + revocable — the P1-1 pattern, never JWTs). The web cookie and
 * the app's device storage carry the same kind of token, so one
 * verifier serves both surfaces.
 *
 * A `dev` provider (non-production only) fakes the IdP with a local
 * form so the entire flow is clickable in dev/CI without any Google or
 * Microsoft credentials — the Stripe/PayPal fake-provider posture.
 */

export const CUSTOMER_COOKIE = "rangla_customer";
export const CUSTOMER_TOKEN_TTL_DAYS = 90;
const STATE_TTL_MS = 10 * 60 * 1000;

export interface CustomerProviderConfig {
  id: "google" | "microsoft" | "dev";
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export function customerProviders(): CustomerProviderConfig[] {
  const providers: CustomerProviderConfig[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push({
      id: "google",
      label: "Google",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      scope: "openid email profile",
    });
  }
  // Deliberately no further OAuth vendors: the sign-in surface is Google
  // or the email/password account below (registerCustomerWithPassword).
  if (env.NODE_ENV !== "production") {
    providers.push({
      id: "dev",
      label: "Dev-Login (nur lokal)",
      authorizeUrl: `${siteUrl()}/auth/dev-login`,
      tokenUrl: "",
      userinfoUrl: "",
      clientId: "dev",
      clientSecret: "dev",
      scope: "openid",
    });
  }
  return providers;
}

export function customerCallbackUrl(): string {
  return `${siteUrl()}/api/auth/customer/callback`;
}

/* ------------------------------------------------------------------ */
/* Signed state — CSRF + flow context (which provider, device code)    */
/* ------------------------------------------------------------------ */

export interface AuthState {
  p: "google" | "microsoft" | "dev";
  /** Device-login code the app is polling, when the flow started there. */
  d?: string;
  exp: number;
  n: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signState(state: Omit<AuthState, "exp" | "n">): string {
  const full: AuthState = { ...state, exp: Date.now() + STATE_TTL_MS, n: b64url(randomBytes(8)) };
  const payload = b64url(Buffer.from(JSON.stringify(full)));
  const sig = b64url(createHmac("sha256", env.SESSION_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(raw: string): AuthState | null {
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = b64url(createHmac("sha256", env.SESSION_SECRET).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString()) as AuthState;
    if (typeof state.exp !== "number" || Date.now() > state.exp) return null;
    return state;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(provider: CustomerProviderConfig, state: string): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", customerCallbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scope);
  url.searchParams.set("state", state);
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Code exchange + userinfo                                            */
/* ------------------------------------------------------------------ */

export interface CustomerIdentity {
  sub: string;
  email: string;
  name: string | null;
}

/** Exchange the authorization code and read the OIDC userinfo. The dev
 *  provider short-circuits: its "code" IS the identity, base64url JSON. */
export async function exchangeCode(
  provider: CustomerProviderConfig,
  code: string,
): Promise<CustomerIdentity | null> {
  if (provider.id === "dev") {
    try {
      const parsed = JSON.parse(Buffer.from(code, "base64url").toString()) as {
        email?: string;
        name?: string;
      };
      if (!parsed.email) return null;
      return {
        sub: `dev:${parsed.email.toLowerCase()}`,
        email: parsed.email,
        name: parsed.name ?? null,
      };
    } catch {
      return null;
    }
  }

  const tokenRes = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: customerCallbackUrl(),
    }),
  });
  if (!tokenRes.ok) {
    log.warn("customer_auth.token_exchange_failed", {
      provider: provider.id,
      status: tokenRes.status,
    });
    return null;
  }
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) return null;

  const infoRes = await fetch(provider.userinfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) {
    log.warn("customer_auth.userinfo_failed", { provider: provider.id, status: infoRes.status });
    return null;
  }
  const info = (await infoRes.json()) as { sub?: string; email?: string; name?: string };
  if (!info.sub || !info.email) return null;
  return { sub: info.sub, email: info.email, name: info.name ?? null };
}

/* ------------------------------------------------------------------ */
/* Customer upsert + opaque tokens                                     */
/* ------------------------------------------------------------------ */

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SignedInCustomer {
  customerId: string;
  email: string;
  name: string | null;
  token: string;
}

/** Upsert the customer by (provider, sub) and mint a fresh opaque token. */
export async function signInCustomer(
  tenantId: string,
  provider: string,
  identity: CustomerIdentity,
): Promise<SignedInCustomer> {
  return asTenant(tenantId, async (tx) => {
    const customer = await tx.customer.upsert({
      where: {
        tenantId_provider_providerSub: { tenantId, provider, providerSub: identity.sub },
      },
      create: {
        tenantId,
        provider,
        providerSub: identity.sub,
        email: identity.email,
        name: identity.name,
      },
      // Refresh display fields on every login — people rename themselves.
      update: { email: identity.email, name: identity.name, deletedAt: null },
      select: { id: true, email: true, name: true },
    });
    const token = randomBytes(32).toString("base64url");
    await tx.customerToken.create({
      data: {
        tenantId,
        customerId: customer.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + CUSTOMER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    log.info("customer_auth.signed_in", { customerId: customer.id, provider });
    return { customerId: customer.id, email: customer.email, name: customer.name, token };
  });
}

/** Email/password accounts ride the same customer row as OAuth ones:
 *  provider "password", providerSub = the normalized email. */
const PASSWORD_PROVIDER = "password";

export type PasswordAuthResult =
  { ok: true; value: SignedInCustomer } | { ok: false; error: "exists" | "invalid_credentials" };

async function mintCustomerToken(
  tx: Parameters<Parameters<typeof asTenant>[1]>[0],
  tenantId: string,
  customer: { id: string; email: string; name: string | null },
): Promise<SignedInCustomer> {
  const token = randomBytes(32).toString("base64url");
  await tx.customerToken.create({
    data: {
      tenantId,
      customerId: customer.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + CUSTOMER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return { customerId: customer.id, email: customer.email, name: customer.name, token };
}

/** Email sign-up. Fails with "exists" when the email already has a
 *  password account — the caller should point at sign-in instead. */
export async function registerCustomerWithPassword(
  tenantId: string,
  emailRaw: string,
  password: string,
  name?: string | null,
): Promise<PasswordAuthResult> {
  const email = emailRaw.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  return asTenant(tenantId, async (tx) => {
    const existing = await tx.customer.findUnique({
      where: {
        tenantId_provider_providerSub: {
          tenantId,
          provider: PASSWORD_PROVIDER,
          providerSub: email,
        },
      },
      select: { id: true, deletedAt: true, passwordHash: true },
    });
    if (existing && !existing.deletedAt && existing.passwordHash) {
      return { ok: false as const, error: "exists" as const };
    }
    const customer = await tx.customer.upsert({
      where: {
        tenantId_provider_providerSub: {
          tenantId,
          provider: PASSWORD_PROVIDER,
          providerSub: email,
        },
      },
      create: {
        tenantId,
        provider: PASSWORD_PROVIDER,
        providerSub: email,
        email,
        name: name?.trim() || null,
        passwordHash,
      },
      update: { email, name: name?.trim() || null, passwordHash, deletedAt: null },
      select: { id: true, email: true, name: true },
    });
    const signedIn = await mintCustomerToken(tx, tenantId, customer);
    log.info("customer_auth.registered", { customerId: customer.id });
    return { ok: true as const, value: signedIn };
  });
}

/** Email sign-in. One error for every failure mode — never reveal
 *  whether an email exists. */
export async function signInCustomerWithPassword(
  tenantId: string,
  emailRaw: string,
  password: string,
): Promise<PasswordAuthResult> {
  const email = emailRaw.trim().toLowerCase();
  return asTenant(tenantId, async (tx) => {
    const customer = await tx.customer.findUnique({
      where: {
        tenantId_provider_providerSub: {
          tenantId,
          provider: PASSWORD_PROVIDER,
          providerSub: email,
        },
      },
      select: { id: true, email: true, name: true, passwordHash: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt || !customer.passwordHash) {
      return { ok: false as const, error: "invalid_credentials" as const };
    }
    const valid = await verifyPassword(customer.passwordHash, password);
    if (!valid) return { ok: false as const, error: "invalid_credentials" as const };
    const signedIn = await mintCustomerToken(tx, tenantId, {
      id: customer.id,
      email: customer.email,
      name: customer.name,
    });
    log.info("customer_auth.signed_in", { customerId: customer.id, provider: PASSWORD_PROVIDER });
    return { ok: true as const, value: signedIn };
  });
}

export interface VerifiedCustomer {
  id: string;
  email: string;
  name: string | null;
}

/** Token → customer, or null. One verifier for cookie and app bearer. */
export async function verifyCustomerToken(
  tenantId: string,
  token: string | null | undefined,
): Promise<VerifiedCustomer | null> {
  if (!token || token.length < 20 || token.length > 128) return null;
  return asTenant(tenantId, async (tx) => {
    const row = await tx.customerToken.findFirst({
      where: {
        tokenHash: hashToken(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        customer: { deletedAt: null },
      },
      select: { customer: { select: { id: true, email: true, name: true } } },
    });
    return row ? row.customer : null;
  });
}

/** Log out everywhere this token is used. */
export async function revokeCustomerToken(tenantId: string, token: string): Promise<void> {
  await asTenant(tenantId, (tx) =>
    tx.customerToken.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: new Date() },
    }),
  );
}
