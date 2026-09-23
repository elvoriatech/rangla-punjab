import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { isLocaleCode } from "./locales";
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

/** Where the food goes — the exact shape `Order.deliveryAddress` stores,
 *  so checkout can round-trip one into the other without a mapper. */
export interface CustomerAddress {
  street?: string;
  zip?: string;
  city?: string;
  note?: string;
}

/**
 * Everything checkout needs to prefill: who they are, how to reach them,
 * and where they last had food delivered. One shape for `GET/PATCH
 * /api/v1/me`, the Google sign-in response and the device-code flow, so
 * the app treats every sign-in route identically.
 */
export interface CustomerProfile {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  lastDeliveryAddress: CustomerAddress | null;
  /** The guest's chosen UI language (a `LOCALE_CODES` value), or null
   *  when they never picked one. Lives on the ACCOUNT so it follows them
   *  to a second device and survives a reinstall — the app's local
   *  AsyncStorage key is a cache of this, not the source of truth. */
  locale: string | null;
}

/** The columns a profile is made of — one definition, every query. */
export const customerProfileSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  lastDeliveryAddress: true,
  locale: true,
} as const;

interface CustomerProfileRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  lastDeliveryAddress: unknown;
  locale?: string | null;
}

/** Prisma hands `Json?` back as `unknown`; narrow it to the four string
 *  fields we store and drop anything else a hand-edited row may hold. */
export function toCustomerProfile(row: CustomerProfileRow): CustomerProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    lastDeliveryAddress: parseCustomerAddress(row.lastDeliveryAddress),
    // Guard the column against a hand-edited row holding a code this
    // build no longer knows: an unusable locale must read as "unset",
    // not push the app to a catalogue it cannot resolve.
    locale: isLocaleCode(row.locale) ? row.locale : null,
  };
}

function parseCustomerAddress(value: unknown): CustomerAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const address: CustomerAddress = {
    street: str(raw.street),
    zip: str(raw.zip),
    city: str(raw.city),
    note: str(raw.note),
  };
  const kept = Object.fromEntries(
    Object.entries(address).filter(([, v]) => v !== undefined),
  ) as CustomerAddress;
  return Object.keys(kept).length ? kept : null;
}

export interface SignedInCustomer {
  customerId: string;
  email: string;
  name: string | null;
  token: string;
  /** The same row as a full profile — what the app prefills checkout from. */
  customer: CustomerProfile;
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
      // `phone` and `lastDeliveryAddress` are NOT touched: the IdP doesn't
      // know them, and the guest's own checkout data must survive a login.
      //
      // A provider may omit the email or name on a later sign-in (Apple
      // sends the name only on the very first one), so an absent value
      // leaves the stored one alone instead of wiping it.
      update: {
        email: identity.email || undefined,
        name: identity.name ?? undefined,
        deletedAt: null,
      },
      select: customerProfileSelect,
    });
    const signedIn = await mintCustomerToken(tx, tenantId, customer);
    log.info("customer_auth.signed_in", { customerId: customer.id, provider });
    return signedIn;
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
  customer: CustomerProfileRow,
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
  return {
    customerId: customer.id,
    email: customer.email,
    name: customer.name,
    token,
    customer: toCustomerProfile(customer),
  };
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
      select: customerProfileSelect,
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
      select: { ...customerProfileSelect, passwordHash: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt || !customer.passwordHash) {
      return { ok: false as const, error: "invalid_credentials" as const };
    }
    const valid = await verifyPassword(customer.passwordHash, password);
    if (!valid) return { ok: false as const, error: "invalid_credentials" as const };
    const signedIn = await mintCustomerToken(tx, tenantId, customer);
    log.info("customer_auth.signed_in", { customerId: customer.id, provider: PASSWORD_PROVIDER });
    return { ok: true as const, value: signedIn };
  });
}

/** Historic alias — the verifier has always returned the customer row;
 *  it now carries the checkout fields too. */
export type VerifiedCustomer = CustomerProfile;

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
      select: { customer: { select: customerProfileSelect } },
    });
    return row ? toCustomerProfile(row.customer) : null;
  });
}

/* ------------------------------------------------------------------ */
/* Profile edits (PATCH /api/v1/me + the post-order back-fill)         */
/* ------------------------------------------------------------------ */

export interface CustomerProfilePatch {
  name?: string | null;
  phone?: string | null;
  lastDeliveryAddress?: CustomerAddress | null;
  locale?: string | null;
}

/**
 * Write the guest's own profile fields. Caller must already have proved
 * the customer id belongs to this tenant (token verification, or an
 * order it just wrote); the update still runs under RLS, so a stray id
 * from another tenant updates nothing.
 *
 * `undefined` leaves a field alone; an explicit `null` clears it.
 */
export async function updateCustomerProfile(
  tenantId: string,
  customerId: string,
  patch: CustomerProfilePatch,
): Promise<CustomerProfile | null> {
  const data = customerProfileUpdateData(patch);
  return asTenant(tenantId, async (tx) => {
    const updated = await tx.customer.updateMany({
      where: { id: customerId, deletedAt: null },
      data,
    });
    if (!updated.count) return null;
    const row = await tx.customer.findFirst({
      where: { id: customerId },
      select: customerProfileSelect,
    });
    return row ? toCustomerProfile(row) : null;
  });
}

export interface CustomerProfileUpdateData {
  name?: string | null;
  phone?: string | null;
  locale?: string | null;
  lastDeliveryAddress?: Prisma.CustomerUpdateManyMutationInput["lastDeliveryAddress"];
}

/** Patch → Prisma `data`. Shared with the in-transaction back-fill in
 *  order-service, which must not open a second connection. */
export function customerProfileUpdateData(patch: CustomerProfilePatch): CustomerProfileUpdateData {
  const data: CustomerProfileUpdateData = {};
  if (patch.name !== undefined) data.name = patch.name?.trim() || null;
  if (patch.phone !== undefined) data.phone = patch.phone?.trim() || null;
  // Only a code this build actually ships; anything else clears the
  // field rather than storing something no client can resolve.
  if (patch.locale !== undefined) {
    const next = patch.locale?.trim().toLowerCase() ?? null;
    data.locale = isLocaleCode(next) ? next : null;
  }
  if (patch.lastDeliveryAddress !== undefined) {
    // Prisma needs the DbNull sentinel to write SQL NULL into a Json
    // column — a plain `null` would store the JSON value `null`. The
    // spread is what turns our named shape into the index-signature'd
    // object Prisma's Json input type wants.
    data.lastDeliveryAddress = patch.lastDeliveryAddress
      ? { ...patch.lastDeliveryAddress }
      : Prisma.DbNull;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Native Google sign-in — ID token straight from the device           */
/* ------------------------------------------------------------------ */

/**
 * The browser flow above hops to Google and back; a native app already
 * holds a signed ID token from the Google SDK and just needs it checked.
 * Verification is the full JWT check against Google's published keys —
 * signature, issuer, audience (one of OUR OAuth client ids: web, iOS,
 * Android), expiry — plus `email_verified`. Never `tokeninfo`: that
 * endpoint is a network round-trip per sign-in and trusts whatever the
 * device's DNS resolves to.
 *
 * The identity it returns feeds the same `signInCustomer()` upsert as
 * the browser flow, and `sub` is the same Google subject, so a guest who
 * first signed in on the web lands on the SAME customer row.
 */
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

interface GoogleIdTokenConfig {
  audiences: string[];
  keys: JWTVerifyGetKey;
}

/** Test seam: a local key set + client ids, so suites sign their own
 *  tokens and CI never reaches googleapis.com. Refused in production. */
let googleOverride: GoogleIdTokenConfig | null = null;
export function setGoogleIdTokenConfigForTests(config: GoogleIdTokenConfig | null): void {
  if (env.NODE_ENV === "production") throw new Error("google id-token test seam is dev-only");
  googleOverride = config;
}

/** Every OAuth client id an ID token may be addressed to: the web client
 *  (shared with the browser flow) plus the app's native client ids. */
export function googleIdTokenAudiences(): string[] {
  if (googleOverride) return googleOverride.audiences;
  const ids = [env.GOOGLE_CLIENT_ID ?? "", ...(env.GOOGLE_MOBILE_CLIENT_IDS ?? "").split(",")]
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

let remoteJwks: JWTVerifyGetKey | null = null;
function googleKeys(): JWTVerifyGetKey {
  if (googleOverride) return googleOverride.keys;
  // Cached + rotated by jose itself — one key fetch per process, not per
  // sign-in.
  remoteJwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return remoteJwks;
}

export async function verifyGoogleIdToken(idToken: string): Promise<CustomerIdentity | null> {
  const audience = googleIdTokenAudiences();
  if (!audience.length) return null;
  try {
    const { payload } = await jwtVerify(idToken, googleKeys(), {
      issuer: GOOGLE_ISSUERS,
      audience,
    });
    const claims = payload as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
    };
    if (!claims.sub || !claims.email) return null;
    // Google sends a boolean; some older tokens send the string. An
    // unverified address must never take over an existing account.
    if (claims.email_verified !== true && claims.email_verified !== "true") {
      log.warn("customer_auth.google_id_token_unverified_email", { sub: claims.sub });
      return null;
    }
    return { sub: claims.sub, email: claims.email, name: claims.name ?? null };
  } catch (error) {
    log.warn("customer_auth.google_id_token_rejected", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Sign in with Apple — ID token straight from the iPhone             */
/* ------------------------------------------------------------------ */

/**
 * The iOS twin of {@link verifyGoogleIdToken}: the app's native Apple
 * sheet hands back a signed identity token, checked here against Apple's
 * published keys — signature, issuer, audience (our bundle id), expiry.
 * App Store guideline 4.8 is why this exists: an app that offers Google
 * sign-in must also offer a login that lets the guest hide their email.
 *
 * `email` can be an Apple relay address (…@privaterelay.appleid.com) and
 * may be absent on a later sign-in; `sub` is stable per app, so the same
 * Apple ID always lands on the same customer row. The name is never in
 * the token — the app forwards it from the first sign-in only.
 */
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
/** The store build's bundle id — the audience when the env names none. */
const APPLE_DEFAULT_CLIENT_ID = "de.ranglapunjabrestaurant.app";

let appleOverride: GoogleIdTokenConfig | null = null;
export function setAppleIdTokenConfigForTests(config: GoogleIdTokenConfig | null): void {
  if (env.NODE_ENV === "production") throw new Error("apple id-token test seam is dev-only");
  appleOverride = config;
}

export function appleIdTokenAudiences(): string[] {
  if (appleOverride) return appleOverride.audiences;
  const ids = (env.APPLE_SIGNIN_CLIENT_IDS ?? APPLE_DEFAULT_CLIENT_ID)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

let appleRemoteJwks: JWTVerifyGetKey | null = null;
function appleKeys(): JWTVerifyGetKey {
  if (appleOverride) return appleOverride.keys;
  appleRemoteJwks ??= createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return appleRemoteJwks;
}

export async function verifyAppleIdToken(
  idToken: string,
  name?: string | null,
): Promise<CustomerIdentity | null> {
  const audience = appleIdTokenAudiences();
  if (!audience.length) return null;
  try {
    const { payload } = await jwtVerify(idToken, appleKeys(), {
      issuer: APPLE_ISSUER,
      audience,
    });
    const claims = payload as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
    };
    if (!claims.sub) return null;
    // Apple only ever issues verified (or relay) addresses, but a token
    // that says otherwise must not carry an email onto an account.
    const verified = claims.email_verified === true || claims.email_verified === "true";
    return {
      sub: claims.sub,
      email: claims.email && verified ? claims.email : "",
      name: name?.trim() ? name.trim().slice(0, 120) : null,
    };
  } catch (error) {
    log.warn("customer_auth.apple_id_token_rejected", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
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

/**
 * Kill every live session of ONE customer — web cookie, phone, tablet,
 * the lot. This is what a password reset owes the guest: whoever knew the
 * old password (and may be the reason it is being reset) must not keep a
 * signed-in device.
 *
 * The `tx` flavour exists because the reset path already runs inside
 * `asTenant`'s transaction and must revoke in the SAME transaction as the
 * password write — a half-applied reset that changed the hash but left
 * the attacker's token alive is the one outcome worth ruling out.
 */
export function revokeCustomerTokensIn(
  tx: Parameters<Parameters<typeof asTenant>[1]>[0],
  customerId: string,
): Promise<{ count: number }> {
  return tx.customerToken.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Stand-alone twin of {@link revokeCustomerTokensIn}. */
export async function revokeAllCustomerTokens(
  tenantId: string,
  customerId: string,
): Promise<number> {
  const result = await asTenant(tenantId, (tx) => revokeCustomerTokensIn(tx, customerId));
  return result.count;
}

/** The provider string every email/password guest account carries. */
export const CUSTOMER_PASSWORD_PROVIDER = PASSWORD_PROVIDER;

/** Minimum length of a guest password — the register route's policy, and
 *  the one the reset flow has to keep (a reset must never be a downgrade). */
export const CUSTOMER_PASSWORD_MIN_LENGTH = 8;
