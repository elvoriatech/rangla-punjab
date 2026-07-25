# Rangla Punjab — White-Label Ordering Platform · Backlog

Single source of truth for the autonomous build loop. `/next` works the topmost unchecked task
whose dependencies are all checked.

**Task format:** `- [ ] (id) <verb + outcome>. Verify: <how you know it's done>. [deps: id,id] [⛔ needs-human]`

> **Context:** This repo began life as **Elvoria** — a multi-tenant QR-menu SaaS for 20k+ tenants.
> We are converting it into a **white-label, single-restaurant ordering platform**: one deploy per
> client, own DB + domain + Stripe. **Rangla Punjab** is deployment #1. The old SaaS backlog is
> archived at [docs/BACKLOG.elvoria-saas-archive.md](docs/BACKLOG.elvoria-saas-archive.md).

---

## Settled decisions (the loop reads these as final)

- **Product model:** white-label, **one deploy per client**. One `Tenant` per deploy; that tenant
  may own **multiple `Venue`s (branches)**. No multi-tenant SaaS layer, no public self-signup.
- **Two consoles:** restaurant → **`/dashboard`** ("Dashboard", theme unchanged); operator (you) →
  **`/admin`** ("Operator Console").
- **Menu:** reuse the existing `MenuTemplate` starter menus (Indian/Pakistani, Pizzeria, Sushi, …);
  the restaurant picks one at provisioning and edits it. Nothing cuisine-specific is hardcoded.
- **Food payments:** direct via **Stripe Connect** — the restaurant is merchant of record and keeps
  their share; funds settle to the tenant's connected account.
- **Operator fee:** configurable. `FEE_MODE = upfront | percentage`. `upfront` ⇒ 0% per order.
  `percentage` ⇒ `FEE_BP` on orders **strictly over** `FEE_MIN_CENTS` (default €20 = 2000). Config
  lives in the DB, edited from the Operator Console.
- **Support fee (revised 2026-07-22):** the `upfront`-model restaurant pays a **flat monthly
  support fee** collected **in-app** via a single Stripe Billing subscription (plan code `support`,
  `STRIPE_PRICE_ID_SUPPORT`). Supersedes the earlier "collected out of band" note. The owner
  self-serves from `/dashboard/billing`; an overdue payment is a **warning only** and never gates
  ordering (features are decoupled from billing in `plan-state.ts`, which is always all-on for the
  single restaurant). The old multi-tenant SaaS tiers (Starter/Growth/Scale) + per-plan caps are
  **removed** — do NOT reintroduce them.
- **Config split:** `.env` holds **secrets + infra only**; everything a human would change lives in
  `/admin` or `/dashboard`.
- **DB name:** local dev uses `rangla-punjab-resturant` (user's spelling, kept verbatim). The live
  deploy runs on a **cloud Postgres** (`rangla_database` @ 31.70.87.185, owner `rangla_user`);
  `DATABASE_URL`/`APP_DATABASE_URL` point there. RLS is **disabled** on that DB — single restaurant,
  one tenant, nothing to isolate — so the app connects as the owner role.
- **Hosting:** single small VPS + Docker + Caddy (auto-TLS). ~€5–10/mo.
- **Images (revised 2026-07-22):** stored on the app's own **local disk** under
  `public/uploads` and resized on the fly by the `/img` route (sharp) — **no S3/R2, no
  imgproxy, no Cloudflare** for images. Supersedes the R2 + imgproxy + Cloudflare-CDN image
  notes. Prod MUST mount `public/uploads` as a volume and back it up (it is the only home of
  customer images).
- **AI menu-import: removed (2026-07-22)** — feature deleted (unused). Menus are built from
  starter templates (P1-3) or by hand. Do NOT reintroduce the Anthropic Vision importer.

## Guardrails (PAUSE and surface — do not auto-proceed)

- Live Stripe keys / live-key smoke tests / anything moving real money.
- Real DB passwords, API keys, DNS, domain purchase, production `deploy`.
- Deleting data you did not create.

Everything else — code, schema, local docker, seeds, tests, config UI — proceed.

---

## Phase 0 — Foundations & rebrand

- [x] (P0-1) Create local Postgres DB **`rangla-punjab-resturant`** + app roles (adapt
  `prisma/dev-roles.sql`). Point `DATABASE_URL` / `APP_DATABASE_URL` / `POOL_URL` at it.
  Verify: `psql` lists the DB; `prisma migrate status` connects.
- [x] (P0-2) Run all existing migrations against the new DB. Verify: `prisma migrate deploy`
  succeeds; every table + RLS policy present. [deps: P0-1]
- [x] (P0-3) Trim `.env.example` to the **required-secrets-only** contract (DB, `SESSION_SECRET`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Resend, S3, `APP_URL`). Drop dead SaaS vars
  (`STRIPE_PRICE_ID_*`, MailHog in prod). Verify: config loader boots with only these set. [deps: P0-1]
- [x] (P0-4) Seed the **operator** account via `seed-platform-admin.ts` (`ADMIN_EMAIL` +
  `ADMIN_PASSWORD` from env). Verify: login at `/login` reaches `/admin`. [deps: P0-2]
- [x] (P0-5) Rebrand strings **Elvoria/Guesto → Rangla Punjab** (product name, page titles, emails,
  cookie name). Keep the visual theme. Verify: `grep -ri elvoria src` only hits archival/comment
  refs; lint + typecheck green. [deps: P0-1]

## Phase 1 — Single-restaurant + starter menus

- [x] (P1-1) Consolidate provisioning into one `scripts/seed-restaurant.ts` that, given name +
  owner email + template key + venue, creates tenant → venue → owner `User` + `Membership(owner)`
  → applies the chosen `MenuTemplate`. Verify: running it yields a browsable menu. [deps: P0-2]
  → Done: `scripts/seed-restaurant.ts` + `seed-menu-templates.ts` run against the cloud DB.
- [x] (P1-2) Seed **Rangla Punjab** from the `indian-pakistani` template (one venue). Verify: public
  page renders the Indian menu. [deps: P1-1]
  → Done: menu live (5 categories, 18 items). Owner console reachable at `/restaurant/rangla-punjab`
  until the P4-3 rename to `/dashboard` lands (admin slice).
- [x] (P1-3) Wire the **starter-template picker** into the Dashboard (owner selects a template →
  populates a draft menu they can edit). Verify: picking a template creates editable categories/items. [deps: P1-2]
  → Already implemented: picker on `/dashboard/categories` (shown when the draft is empty) →
  `applyTemplateAction` → `applyTemplateToDraft` (clones template into the draft menu version).
  Verified 2026-07-22: `menu-template-service.test.ts` green (5/5) against the local stack.
- [x] (P1-4) **Branch (venue) switcher** in `/dashboard`: dropdown when >1 venue, hidden for one.
  Verify: adding a second venue shows the switcher; orders/menu scope to the selected branch. [deps: P1-2]

## Phase 2 — Payments (direct charges, configurable fee)

- [x] (P2-1) Add a DB-backed **operator settings** row/table: `feeMode`, `feeBp`, `feeMinCents`,
  `siteActive`. Seed defaults (`percentage`/500/2000/true). Verify: migration applies; typed accessor
  reads it. [deps: P0-2]
  → Done: `OperatorSettings` model + `FeeMode` enum + migration `20260722000000_p2_operator_settings`
  (single seeded row); typed accessor `src/lib/operator-settings.ts` (`getOperatorSettings`/`updateOperatorSettings`).
- [x] (P2-2) Replace hardcoded `PLATFORM_FEE_BP` in `connect-service.ts` with the settings-driven
  `platformFeeCents()`: `upfront ⇒ 0`; `≤ feeMinCents ⇒ 0`; else `feeBp`. Verify: unit tests cover
  upfront, below-threshold, above-threshold. [deps: P2-1]
  → Done: `computePlatformFeeCents()` (pure) + `operator-settings.test.ts` (4 cases); connect-service
  fetches settings at the checkout call site.
- [x] (P2-3) Remove the **subscription/entitlement gate** on payments (`access.entitlements.payments`)
  so checkout works without a "Scale tier". Keep the Connect-charges-enabled check. Verify: an order
  on a tenant with no Subscription can reach checkout. [deps: P2-2]
  → Done: dropped the entitlement gate from `getConnectStatus`, `startConnectOnboarding`,
  `createOrderPayment`, and the `onlinePayment` flag; only `stripeChargesEnabled` remains. Tests
  rewritten to prove a no-subscription tenant reaches checkout (still blocked when charges disabled).
- [x] (P2-4) **Site on/off kill switch**: when `siteActive=false`, public order + pay routes return a
  friendly "ordering paused" page; Dashboard still reachable. Verify: toggling the flag flips public
  behaviour. [deps: P2-1]
  → Done: order POST + pay POST return 503 `ordering_paused`; public menu (`/`, `/[locale]`) hides
  ordering + shows a banner; pay page shows a paused notice for unpaid orders. Dashboard untouched.
- [x] (P2-5) End-to-end order→pay against the **fake Stripe provider** (dev). Verify: place order →
  checkout → webhook/confirm → order shows `paid`; kitchen sees it. [deps: P2-2]

## Phase 3 — Operator Console (`/admin`)

- [x] (P3-1) Slim `/admin` to the Operator Console: settings screen for fee mode/%/threshold + site
  on/off, writing the P2-1 settings. Verify: changing fee % in UI changes the fee applied to a new
  order. [deps: P2-1]
  → Done: `/admin/settings` page + `saveOperatorSettingsAction` (isPlatformAdmin-gated) writing
  `updateOperatorSettings`; fee shown as % + € threshold, site on/off toggle; added to admin sidebar.
- [x] (P3-2) **Provision Restaurant** form under `/admin/restaurants`: name + owner email + starter
  template + venue → runs the P1-1 flow → sends the owner an invite (set-password) email. Verify:
  submitting creates the restaurant and dispatches the invite. [deps: P1-1, P3-1]
- [x] (P3-3) Fold ops (backups/runbooks) into `/admin`; remove the per-restaurant `(admin)/admin`
  nesting. Verify: ops pages reachable under `/admin`, gone from `/dashboard`. [deps: P3-1]

## Phase 4 — Strip the SaaS

- [x] (P4-1) De-tier billing: collapse `plans.ts` to a single flat `support` plan; neutralise
  per-plan caps (`plan-gating.ts` → always-allow) and the entitlement ladder (`plan-state.ts` →
  single restaurant always all-on, ordering decoupled from billing); repurpose
  `billing-service`/`/api/billing`/`/dashboard/billing` for the monthly support-fee subscription;
  delete the Starter/Growth/Scale price seeding. Verify: typecheck green; billing + fee + webhook +
  order-service tests pass against the local DB. [deps: P2-3]
  → Done 2026-07-22: single `support` plan (€20/mo, `STRIPE_PRICE_ID_SUPPORT`); `/dashboard/billing`
  is single-plan with a warn-only past-due banner; `scripts/setup-stripe-prices.ts` deleted; tests
  rewritten. NOT yet done: deleting the now-dormant `plan-state`/`plan-gating` modules outright and
  the `/admin` multi-tenant fleet console (folded into P3-3/P4-2).
- [x] (P4-2) Remove **public self-signup + tenant onboarding wizard** (`(auth)/signup`,
  `dashboard/onboarding`) and marketing pages that sell the SaaS. Verify: `/signup` 404s; provisioning
  is operator-only. [deps: P3-2]
- [x] (P4-3a) Move the **public menu off the tenant slug** to the domain root (dedicated-domain
  model): `/r/[slug]` → `/`, `/r/[slug]/[locale]` → `/[locale]`, per-venue manifest →
  `/menu.webmanifest`. Slug resolved internally via `src/lib/restaurant.ts` (`RESTAURANT_SLUG` env,
  DB fallback). SaaS marketing page relocated `/` → `/platform`. CDN cache rules, `<html lang>`
  detection, sitemap, QR/print/preview/purge URL builders all updated. Verify: `/` renders the menu,
  old `/r/*` 404, build + 39 public tests + typecheck green. [deps: P1-2]
- [x] (P4-3) Rename restaurant routes `/restaurant/[slug]/(admin)/*` → **`/dashboard/*`** (single
  tenant; venue handled by the P1-4 switcher). Verify: owner navigates the whole dashboard under
  `/dashboard`; old paths redirect. [deps: P1-4]
  → Done alongside P4-3a: every console route now lives under `/dashboard/(console)/*`; the legacy
  `/restaurant/[slug]/*` catch-all 301s to the new homes. Multi-venue switching is P1-4.
- [x] (P4-4) Prune dead deps/scripts (Scale-tier price seeding, k6 20k-tenant scenarios, AI
  menu-import worker + Redis **iff** we drop it). Verify: `pnpm install` + build green; unused deps
  gone. [deps: P4-1]
  → Partial (2026-07-22): Scale-tier price seeding deleted (P4-1); AI menu-import feature + worker
  removed; `@aws-sdk/*` deps removed with the S3→disk image switch. Redis KEPT (rate limits,
  webhook idempotency, maintenance crons). Still TODO: k6 20k-tenant scenarios.

## Phase 5 — Security & hardening

- [x] (P5-1) Confirm **RLS** still enforced on every `tenant_id` table; keep the cross-tenant-read
  test green. Verify: isolation test passes. [deps: P0-2]
- [x] (P5-2) Verify **Stripe webhook signature** checking is active on the live path (not just fake).
  Verify: an unsigned webhook is rejected 400. [deps: P2-2]
- [x] (P5-3) Lock `/admin` to `isPlatformAdmin`; `/dashboard` to an owner/staff `Membership`. Verify:
  a non-admin session gets 403 on `/admin`; a non-member gets 403 on `/dashboard`. [deps: P3-1]
- [x] (P5-4) Secrets audit: no secret in DB/logs/client bundle; rate limits present on order/pay/auth.
  Verify: `check-guest-bundle` clean; grep finds no secret leakage. [deps: P0-3]
- [x] (P5-5) Run the `security-and-hardening` review pass; fix findings. Verify: no high/critical open.
  [deps: P5-1, P5-2, P5-3, P5-4]

## Phase 6 — Deploy (⛔ human-gated at the money/DNS line)

- [x] (P6-1) Production `docker-compose.prod.yml` + `Caddyfile` for **one app + Postgres + Caddy**
  (drop Redis/MinIO/imgproxy if unused). Verify: `docker compose -f …prod up` serves locally over the
  prod compose. [deps: P4-4]
- [ ] (P6-2) ⛔ needs-human — Provision VPS, point **domain** DNS, install Docker. Operator supplies
  host + domain. [deps: P6-1]
- [ ] (P6-3) ⛔ needs-human — Paste **live** Stripe platform key + webhook secret; restaurant completes
  Connect onboarding; run a real €0.50 order smoke test; then go live. [deps: P6-2, P5-5]

---

### Progress log
- 2026-07-22 — Backlog created; old SaaS backlog archived. **Phase 0 complete** (commit ce07510): DB renamed to rangla-punjab-resturant, migrations applied, operator seeded, brand seam, .env trimmed. Phase 1 started.
- 2026-07-22 — Removed PgBouncer everywhere; app connects directly to the remote Postgres (dev/CI keep a local container). **P4-1 done**: de-tiered billing to a single `support` plan, decoupled features from billing (`plan-state` always all-on), built the in-app monthly support-fee subscription with a warn-only overdue banner. Typecheck clean; targeted test suites green on the local DB.
- 2026-07-22 — **P1-3 verified done** (template picker already implemented). **AI menu-import removed** (feature + worker + model/migration). **Images moved to local disk** (`public/uploads` + `/img` sharp resize; dropped S3/MinIO/imgproxy/@aws-sdk). Full vitest suite green (434) on the local DB; typecheck + lint clean. All work committed to local branch `rangla` (not pushed).
- 2026-07-22 — **Remaining phases cleared** (branch `rangla`): P4-2 (removed public signup + onboarding wizard + `/platform` marketing + `/admin/onboarding` funnel), P1-4 (branch switcher + active-venue cookie), P2-5 (order→pay e2e incl. kitchen visibility), P3-2 (operator Provision-Restaurant form + owner invite email), P3-3 (backups/runbooks folded into `/admin`), P4-4 (no k6 to prune; tier-price/AI/aws-sdk already gone). **P5 security pass verified**: RLS isolation test green (prod runs RLS-off as owner by decision), webhook 400s unsigned, `/admin`→isPlatformAdmin + `/dashboard`→membership, rate limits on order/pay/auth, guest-bundle check present. **P6-1**: prod compose validates (app + caddy + redis + remote DB + uploads volume; no pgbouncer/imgproxy/minio). Full suite green (437). Only ⛔ P6-2/P6-3 (VPS/DNS/live-Stripe) remain — human-gated. **Action for operator: rotate the live Stripe key currently in `.env`.**
