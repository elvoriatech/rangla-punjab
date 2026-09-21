# Guesto — Production Deployment Runbook

Everything needed to take Guesto from this repository to a live deployment,
in order, with the exact commands. Written against the state of the codebase
as of 2026-07-18 (all 496 tests green, full E2E sweep passing).

---

## 0. How QR codes and the domain relate (read first)

**Every restaurant's QR code points at that restaurant's own menu, never the
bare domain.** The QR page encodes:

```
https://<APP_URL domain>/r/<restaurant-slug>        e.g. https://guesto.app/r/taj-palace-konstanz-a71434ac
```

- `APP_URL` supplies only the *domain half*. The venue's unique slug is baked
  into every QR, so scanning always opens exactly that restaurant's published
  menu — with its own theme, language, favicon, and ordering settings.
- **Consequence: set `APP_URL` to the final production domain BEFORE any
  restaurant prints a QR code.** The printed code contains the full URL;
  changing the domain later breaks every laminated table tent in the field.
- Renaming a restaurant is safe: slugs are stable, and the `SlugRedirect`
  table forwards old slugs if one is ever regenerated.
- Multi-location later: each venue gets its own slug → its own QR. One
  restaurant = one QR design, printable from Dashboard → QR codes.

---

## 1. Topology — what you are deploying

| Component | Dev (docker-compose) | Production |
|---|---|---|
| Next.js app | `pnpm dev` | Docker image (`Dockerfile`, Next standalone output, node:22-alpine) |
| PostgreSQL 16 | `elvoria-postgres` | **Remote managed Postgres** — app connects directly, no pooler |
| Redis | `elvoria-redis` | Managed Redis (rate limits, webhook idempotency, queues) |
| Menu photos | local disk (`public/uploads`) | Local disk on a **mounted `uploads` volume** — resized by the `/img` route (sharp). No object store, no imgproxy. Back the volume up. |
| Resized variants | `.image-cache/` | **`image_cache` volume** — read-through cache of every `/img` render, so each width+format is encoded once. Derived data: **do not back up**, safe to delete (costs one re-encode). |
| Email | MailHog | **Resend** (`EMAIL_TRANSPORT=resend`) |
| Stripe | test keys + `stripe listen` | live keys + two Dashboard webhook endpoints |
| CDN (optional) | — | Cloudflare in front of the app; purge-on-write supported |

No background worker or cron process is required — webhooks, queues, and
publish flows all run inside the app process.

**Ready-made deploy kit** (two-VPS topology: app in Docker, Postgres native on
its own server): see [`deploy/`](../deploy) —
`docker-compose.prod.yml` (caddy + app + redis — the DB is remote, images
are on a local `uploads` volume), `prod.env.template` (every variable with
generation commands), `db-server-setup.md` (managed/native Postgres 16:
network binding, pg_hba, firewall, owner role, backups), `Caddyfile`, and
`deploy.sh` (`build | migrate | up | seed | release`).

---

## 2. Database

### 2.1 Create the database and the owner role

Single restaurant, one tenant, **RLS disabled**: there is nothing to isolate,
so the app connects directly as the DB owner. No separate least-privilege
runtime role is needed.

```sql
-- as the cluster superuser / master user
CREATE DATABASE rangla_database;
CREATE ROLE rangla_user LOGIN PASSWORD '<strong-owner-password>';   -- app + migrations
ALTER DATABASE rangla_database OWNER TO rangla_user;
```

### 2.2 Run migrations (owner role, direct connection)

```bash
# Gate: refuses destructive migration shapes without expand-contract markers
pnpm exec tsx scripts/check-migrations.ts

DATABASE_URL="postgresql://rangla_user:<owner-pw>@<db-host>:5432/rangla_database?schema=public" \
  pnpm prisma migrate deploy
```

### 2.3 Wire the app to the remote DB (direct, no pooler)

- `APP_DATABASE_URL` → `postgresql://rangla_user:<owner-pw>@<db-host>:5432/rangla_database?schema=public`
- `DATABASE_URL` → the same URL (migrations/admin)
- `DATABASE_URL_READ` (optional) → a read replica for public-menu/sitemap reads

---

## 3. Menu photos (local disk)

There is no object store and no imgproxy. Uploaded photos are normalized
(EXIF stripped, ≤2048px) and written to the app's own disk under
`public/uploads/`; the `/img/[key]?w=…` route resizes them on the fly with
sharp and negotiates AVIF/WebP with 1-year immutable caching.

The only operational requirement: **mount `public/uploads` as a volume so
images survive redeploys, and include it in your backups** (the prod
compose declares the `uploads` volume for this). Nothing to configure in
`prod.env`.

---

## 4. Email (Resend)

1. Create a Resend account, add and DNS-verify your sending domain.
2. Env:

```
EMAIL_TRANSPORT=resend
RESEND_API_KEY=re_…
EMAIL_FROM="Guesto <no-reply@guesto.app>"
```

Email is **not optional** in production: signup verification (which gates the
dashboard), password reset, and order notifications all depend on it.

---

## 5. Stripe (live mode)

> ⚠️ **Out of date — this section describes the old multi-tenant subscription
> setup** (Guesto-billed plans + Connect onboarding), not what the code does
> today. The current handler `src/lib/stripe/webhook-handler.ts` only handles
> `checkout.session.completed`, `payment_intent.succeeded`,
> `payment_intent.payment_failed` and `account.updated` — the subscription and
> invoice events listed below are never processed, and the price-setup script
> is no longer part of the deploy. For the payment configuration that actually
> applies, follow §4 of `deploy/prod.env.template` and the "Payments" section
> of the README instead. The text below is kept only for reference.

### 5.1 One-time Dashboard setup
1. Activate the live account (business details + bank account).
2. Complete the **Connect** questionnaire in live mode — the answers that
   match this integration: industry *Business management software*; sellers
   collect payments **directly**; onboarding **hosted by Stripe**; sellers
   manage their account in the **Express Dashboard**.

### 5.2 Create the subscription packages via API

```bash
STRIPE_SECRET_KEY=sk_live_… pnpm exec tsx scripts/setup-stripe-prices.ts
```

Idempotent; prints the six `STRIPE_PRICE_ID_*` values (monthly + yearly at
2-months-free for Starter/Growth/Scale). Re-run after any price change in
`src/lib/plans.ts` — it retires stale prices and creates the new ones.

### 5.3 Register TWO webhook endpoints (Dashboard → Developers → Webhooks)

Both point at the same route; Stripe treats them as separate endpoints:

| Endpoint | Listens to | Events |
|---|---|---|
| `https://<domain>/api/stripe/webhook` | **Your account** | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.trial_will_end` |
| `https://<domain>/api/stripe/webhook` | **Connected accounts** | `checkout.session.completed`, `account.updated` |

Each endpoint gets its **own signing secret** — set both:

```
STRIPE_WEBHOOK_SECRET=whsec_…            # the "your account" endpoint
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_…    # the "connected accounts" endpoint
```

The webhook route verifies against whichever secret matches. (Local dev's
`stripe listen` shares one secret for both, so only the first is set there.)

### 5.4 What flows through Stripe
- **Subscriptions** (platform account): restaurants pay Guesto €39/€69/€149.
  No Stripe-side trial — the 30-day in-app trial precedes checkout; cards are
  charged immediately.
- **Guest payments** (Connect, direct charges): guests pay the restaurant's
  Express account; Guesto's 1.5% rides as `application_fee_amount`. Money
  never touches Guesto. `account.updated` webhooks flip guest payments on
  automatically the moment a restaurant passes KYC.

---

## 6. Environment contract (complete)

Required in production:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | Public origin — **QR codes, receipts, verification links, sitemaps all derive from it.** Set before anything is printed. |
| `APP_DATABASE_URL` | Runtime DB URL (owner role, direct to remote Postgres) |
| `DATABASE_URL` | Same Postgres (migrations/admin) |
| `REDIS_URL` | Rate limiting, webhook idempotency |
| _(none — images are on local disk)_ | Mount `public/uploads` as a volume; back it up |
| `SESSION_SECRET` | ≥32 chars; `openssl rand -base64 48`; never the dev value |
| `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | Guest payments (Connect) + support-fee billing |
| `STRIPE_PRICE_ID_SUPPORT` | Recurring price for the monthly operator support fee (in-app billing only) |

Optional (recommended):

| Variable | Purpose |
|---|---|
| `DATABASE_URL_READ` | Read replica for guest-menu reads |
| `SENTRY_DSN` | Error tracking |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Traces/metrics to Grafana Cloud or a collector |
| `INTERNAL_METRICS_TOKEN` | Enables `/api/internal/metrics` for Prometheus (Bearer token) |
| `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` | CDN purge-on-publish (unset = no-op; s-maxage still bounds staleness) |
| `ANTHROPIC_API_KEY` | Real AI menu-photo import. **Leave unset until the PII/data-residency sign-off** — the fake provider serves a fixture otherwise. |

The app validates all of this at boot (`src/lib/env.ts`) and refuses to start
with a clear message if something required is missing.

---

## 7. Build and run

```bash
# Image build (Next standalone output; runtime image contains only
# .next/standalone + .next/static + public)
docker build -t elvoria-app .

# Run (behind your TLS-terminating proxy / load balancer)
docker run -d --env-file /path/to/prod.env -p 3000:3000 elvoria-app
```

Order of operations on every release:
1. `pnpm exec tsx scripts/check-migrations.ts` (CI gate)
2. `prisma migrate deploy` (owner URL)
3. Roll the new image
4. `pnpm check:bundle` runs at build time in CI — guest page budget 220 KB gz,
   marketing 240 KB, image budgets; a regression fails the pipeline.

---

## 8. First-run seeding (once, against the production DB)

```bash
# 1. Platform-admin account — dev defaults are refused in production
ADMIN_EMAIL="you@guesto.app" ADMIN_PASSWORD="<strong>" NODE_ENV=production \
  pnpm exec tsx scripts/seed-platform-admin.ts

# 2. The six curated menu templates (Indian/Pakistani, Pizza, Sushi, Kebab,
#    Burger, Café — ~70 dishes each with photos). Idempotent by key.
pnpm exec tsx scripts/seed-menu-templates.ts
```

Do **not** run `seed-demo-venue.ts` / `seed-indian-restaurant.ts` in
production — they are dev fixtures.

**If you ever promote a dev database instead of starting fresh (not
recommended):** null the fake payment columns and sweep test tenants first:

```sql
UPDATE tenants SET stripe_account_id = NULL, stripe_charges_enabled = false
  WHERE stripe_account_id LIKE 'acct_fake_%';
```
then purge test tenants via Admin → Onboarding (search, delete) and the
Danger-zone "Delete permanently".

---

## 9. Post-deploy smoke test (15 minutes, in this order)

1. **Marketing** page loads over HTTPS; pricing shows €39/€69/€149.
2. **Signup** with a real mailbox → verification email arrives → gate
   auto-advances → wizard (name + colour) → dashboard.
3. **Menu**: apply a template → rail **Publish** lights up → publish.
4. **QR**: download the QR from Dashboard → QR codes, scan it with a real
   phone — it must open `https://<domain>/r/<slug>` with the venue's theme
   (Android: toolbar tinted to the menu background).
5. **Order**: place a dine-in order from the phone; it appears in Orders and
   rings the Kitchen display.
6. **Billing**: choose Growth with a real card → subscription active →
   webhook flips the plan (check Admin → restaurant detail). Refund from the
   Stripe Dashboard if this was a test.
7. **Guest payment**: complete payouts onboarding for one restaurant (real
   IBAN + ID), place an order, **pay €1 by card, verify it lands as `paid`
   with the fee, then refund it in Stripe.**
8. **Admin**: log in, check System health page (DB/Redis/image storage/
   email all green), Audit shows the day's events.

---

## 10. Operations appendix

- **Backups:** enable automated Postgres backups; verify restorability with
  `pnpm exec tsx scripts/restore-drill.ts` (spins an ephemeral scratch DB,
  proves backup → restore → serve; golden output committed).
- **Rate limits** (Redis-backed): signup 5/h/IP, login 5/min/IP + 10/h/email,
  reset 3/h, orders 10/min/IP. Clearing a lockout:
  `redis-cli --scan --pattern "rl:login*" | xargs redis-cli DEL`.
- **CDN:** if fronting with Cloudflare, set the purge token — publishing then
  purges the venue's menu URLs instantly; without it, `s-maxage` bounds
  staleness.
- **Monitoring:** Sentry (errors), OTLP (traces), `/api/internal/metrics`
  (Prometheus; Bearer token). Admin → System shows live dependency health.
- **Migration safety:** every migration passes the destructive-shape gate;
  expand-contract markers document intentional drops.
- **Session cutoff:** password resets invalidate older sessions via
  `sessions_valid_from` (second-precision floor — see `src/lib/auth.ts`).
- **Stripe key hygiene:** the vitest suite strips `STRIPE_*` keys
  (`vitest.setup.ts`) so tests can never touch real Stripe, even on a machine
  with live keys in the environment.

---

## 11. Known deferred items (safe to launch without)

- AI menu-photo import runs on the fake provider until `ANTHROPIC_API_KEY`
  is approved and set (owners can still upload photos; extraction returns the
  fixture in the meantime — keep the feature un-advertised or gate it).
- Scale plan is `available: false` (visible, not purchasable) until you flip
  it in `src/lib/plans.ts` — one-line change, now that payments work.
- Trial-ending reminder emails are one-click from the admin console (no cron);
  an automated weekly job is a later nice-to-have.
- Auto-purge of unverified accounts older than 30 days — manual via the
  funnel for now.
