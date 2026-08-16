import { z } from "zod";

/**
 * Typed environment contract. Parsed once at module load so a missing or
 * malformed variable fails fast at boot with a clear message, rather than
 * surfacing as an undefined deep in a request. See .env.example for the contract.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // App runtime DB connection. Single restaurant, RLS disabled: the
  // app connects DIRECTLY to the (remote, in prod) Postgres as the
  // owner role — no connection pooler in between.
  APP_DATABASE_URL: z.string().url(),
  // Migrations/admin URL. Prisma migrate + advisory locks + shadow DB
  // read this (via prisma.config.ts). Points at the same Postgres as
  // APP_DATABASE_URL; optional at app runtime.
  DATABASE_URL: z.string().url().optional(),
  // Optional read-replica URL (P2-12). When set, `readDb` in db.ts
  // becomes a distinct PrismaClient pointing here; when unset, it is
  // a reference-equal alias for the primary so dev + CI need only
  // one Postgres. Public-menu + sitemap loaders read through this.
  DATABASE_URL_READ: z.string().url().optional(),

  REDIS_URL: z.string().url(),

  // Error tracking — optional at boot; when unset, `captureException`
  // still emits a structured stderr line but no upstream SDK call fires.
  // Provisioned in P0-11 (Terraform).
  SENTRY_DSN: z.string().url().optional(),

  // HMAC key for signed httpOnly session cookies. 32 bytes minimum so the
  // effective search space matches SHA-256's output. Rotate by re-signing
  // (all sessions invalidated) or by adding key-id support later.
  SESSION_SECRET: z.string().min(32),

  // Public origin of the app — every absolute URL the product shows or
  // encodes (QR codes, receipts, structured data, emails) derives from
  // this. Dev default is localhost; production IaC sets the real domain.
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Email adapter (P1-3). `mailhog` = local SMTP sink, `resend` = prod HTTPS
  // API (needs RESEND_API_KEY), `console` = stdout for CI smoke.
  EMAIL_TRANSPORT: z.enum(["mailhog", "resend", "console"]).default("mailhog"),
  EMAIL_FROM: z.string().min(3).default("Resto <dev@example.local>"),
  MAILHOG_SMTP_HOST: z.string().default("localhost"),
  MAILHOG_SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAILHOG_API_URL: z.string().url().default("http://localhost:8025"),
  RESEND_API_KEY: z.string().min(1).optional(),

  // Stripe (P1-19). Both optional so dev + test run on the fake provider;
  // the real SDK wrapper boots only when *both* are set. Webhook secret
  // doubles as the HMAC input for the fake so tests can sign payloads.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Production registers TWO Dashboard webhook endpoints (your account +
  // connected accounts) and each gets its OWN signing secret. Dev's
  // `stripe listen` shares one secret for both, so this stays unset there.
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().min(1).optional(),

  // PayPal (restaurant's OWN business account — single-merchant checkout).
  // Both optional so dev + test run on the fake provider; the real REST
  // wrapper boots only when *both* are set. PAYPAL_ENV picks the endpoint.
  PAYPAL_CLIENT_ID: z.string().min(1).optional(),
  PAYPAL_CLIENT_SECRET: z.string().min(1).optional(),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),

  // Customer sign-in (guest accounts). Each pair optional — a provider
  // only shows on the login surfaces when BOTH its values are set. The
  // dev fake provider covers local testing with no credentials at all.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export type Env = z.infer<typeof envSchema>;
export const env: Env = loadEnv();
