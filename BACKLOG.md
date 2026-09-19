# resto — White-label ordering platform · Backlog

Single source of truth for the autonomous build loop. `/next` works the topmost unchecked task
whose dependencies are all checked.

**Task format:** `- [ ] (id) <verb + outcome>. Verify: <how you know it's done>. [deps: id,id] [⛔ needs-human]`

> **Context:** This repo began life as **Elvoria** — a multi-tenant QR-menu SaaS for 20k+ tenants.
> We are converting it into a **white-label, single-restaurant ordering platform**: one deploy per
> client, own DB + domain + Stripe. Each sale is a **separate deploy** with its own `prod.env`.
> The old SaaS backlog is archived at [docs/BACKLOG.elvoria-saas-archive.md](docs/BACKLOG.elvoria-saas-archive.md).

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
- **DB name:** local dev may use any Postgres DB name (see `docker-compose.yml`). Production uses
  `resto_database` / `resto_user` on the client's DB VPS (`DB_HOST` private IP in `prod.env`).
  RLS is **disabled** — single restaurant per deploy; app connects as the owner role.
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

## Phase 7 — Owner & guest experience in the app (started 2026-09-19)

Owner-directed work from the 2026-09-19 session. Convention for this phase: Fable
architects + reviews, **Opus agents implement** (server + app in parallel against a
written contract), every task ends green (lint · tsc · vitest · mobile tsc), commit
locally, push only when the owner says so (a push = CI + auto-deploy to prod), then
rebuild the iPhone (`mobile/BUILDS.md`) and queue the Android APK on EAS.

Done (pushed, live on prod):
- [x] (P7-1) Native Stripe PaymentSheet + in-app browser checkout; payment method chosen
  before placing; `/pay/intent`, `/pay/verify`, dashboard reconcile; kitchen ticket only
  once paid. (f544093, f16dea2, 40c2ffe)
- [x] (P7-2) Branded emails (shared shell), receipt/ticket icons, Orders cards, allergen
  badges, category icons, compact payment cards. (faa0d23 … 3ffd48a, 208084c, 33803c6)
- [x] (P7-3) Reservation party size as ± stepper (web + app). (7e1d3e3)
- [x] (P7-4) Finished launcher icon via `brand:mobile --icon` / `public/brand/<slug>-mobile-app-icon.*`. (761e606)
- [x] (P7-5) Loyalty: per-order points, vouchers, Hurra email, Rewards card + popup, redemption
  at checkout (app only), reward line on every receipt surface. Owner settings in
  Dashboard → Settings → Loyalty. (c63ad0e, 541f0c2)
- [x] (P7-6) Restaurant mode: shared sign-in returns `kind`, dashboard owner account is the
  only restaurant login (no staff accounts, no token table), `/api/v1/staff/*`, Board tab
  with status actions, call/directions, badge; collapsed cards, name|phone row. (37736c6, bcb5760)
- [x] (P7-7) Reservation status for guests (Konto + web /account), browser sign-in returns
  to the app via `/auth/app-return`, cart shows a placing panel instead of an empty cart,
  obvious Sign out button. (a80fff2, 5f8dde9)

Shipped after the phase was opened:
- [x] (P7-8) Owner management in the app: header burger → owner menu (Board, Manage menu,
  Loyalty, Open dashboard, Sign out); Menu screen shows pencil + on/off switch per dish;
  edit sheet (price, availability, offer price + until date/time); Home shows 🛍️ Pickup /
  🛵 Delivery switches opposite the open pill (on by default); Loyalty overview for the
  owner. Server: `Item.sourceItemId` so app edits update BOTH the published and the draft
  item (live, no publish) + backfill; `GET/PATCH /api/v1/staff/{menu,items/{id},ordering}`,
  `GET /api/v1/staff/loyalty`. Board status buttons become small icon-only. (b60858e)
  Note: the backfill links published↔draft items only where names match; on a
  deploy whose dashboard draft is stale, app edits stay live but report
  `mirrored: false` until the next publish — check the draft before publishing.
- [x] (P7-9) PayPal from the app opens PayPal directly (approve URL from `/pay/paypal`) in
  an in-app session and returns via `/auth/app-return?status=…`, skipping the web pay page. (b60858e)

- [x] (P7-10) Complaint thread on an order: `order_issues` + `order_issue_messages` (guest
  text + optional photo, restaurant replies, statuses open → answered → resolved); guest
  endpoints authorised by the receipt token; photo upload JPEG/PNG/WebP ≤ 5 MB served
  only through a token-gated route; owner email on new issue; dashboard badge + thread
  panel with reply / resolve; app + web tracking get "Report a problem" and the thread;
  Orders card pill stays even after completion. [Owner setting "guests can report within
  N hours", whole hours, default 3, min 1, NO ceiling; an open thread stays usable after
  the window.]
  Note: one thread per order; window = `max(placed, requestedFor) + issueWindowHours`
  (`venues.ordering.issueWindowHours`, Dashboard → Settings → Ordering, also via
  `/api/v1/staff/ordering`); guest is read-only once resolved; owner email on every guest
  message. Photos are EXIF-stripped and served only by
  `/api/v1/orders/{id}/issue/photo/{messageId}` (receipt token · X-Staff-Token · dashboard
  cookie). The zero-JS tracking page pauses its 15 s refresh only while `?compose=1`.
  App: `expo-image-picker` added → native rebuild required (see `mobile/BUILDS.md`).

Next, in this order (decisions already taken in brackets):
- [ ] (P7-11) Push notifications to the owner's phone for new orders (and later issues):
  expo-notifications, `POST /api/v1/staff/devices`, send on order placement/settlement.
  ⛔ needs-human: Apple push key, Firebase project.
- [x] (P7-12) Offers as a destination: "Angebote" tab on the web menu; app Offers screen +
  Home card + Menu-tab badge while any offer is live; all hidden when none.
  Note: `PublicMenu.offerCount` (+ `/api/v1/menu`); web renders a synthetic first section
  `data-category-id="__offers"` and an Offers tab first in every rail, `?cat=offers` works
  without JS; app: Offers chip first in the Menu rail (flat list of offer dishes), Home
  offers card, Menu-tab badge. Everything disappears when no offer is active.
- [ ] (P7-13) Checkout in the style of the owner's mockup: address card with "Ändern",
  Sofort / Geplant radio with a ± time stepper (web + app), payment list with brand marks
  incl. Apple Pay / Google Pay as direct platform-pay buttons. [Keep Card as a row unless
  the owner says otherwise.] ⛔ Apple Pay merchant setup; Google Pay production approval.
- [ ] (P7-14) Google rating + review link (Places API, Place ID, daily cache, link to
  write-a-review). ⛔ needs-human: API key, Place ID, billing.
- [x] (P7-15) Guest password reset (forgot → email → reset page; app link opens it in-app).
  Note: `customer_password_reset_tokens` (hashed, 60 min, single use, password accounts
  only, neutral 200 on request); `POST /api/auth/customer/reset/request` + `/reset/{token}`;
  zero-JS pages `/account/forgot` and `/account/reset/{token}`; success revokes every live
  guest session; with `?app=` the reset page hands back to the app via
  `/auth/app-return?to=…&status=reset`. App: "Forgot password?" panel on Account, reset
  return shows "Password changed — sign in again".
- [ ] (P7-16) Ship only the active locale's guest-copy catalogue to the browser and lower the
  Lighthouse script budget back to 260 kB (raised to 275 kB in 7167674). Task chip exists.
- [x] (P7-17) "cancelled" order status in the kitchen lifecycle (loyalty reversal + voucher
  restore are already wired to it).
  Note: terminal, out-of-band status reachable from any non-terminal step; never suggested
  by `nextStatus`; `orders_status_check` widened by migration. Dashboard/kitchen get a
  de-emphasised Cancel with a confirm (posts without JS), the Board a destructive confirm;
  guest tracker/app show a cancelled banner and stop refreshing. **Decision: no automatic
  refund** — a cancelled online-paid order shows "refund it in Stripe / PayPal"; note that
  `report-service.ts` still counts it as revenue until refunded (follow-up if wanted).

Human-gated, unchanged: live Stripe keys (P6-3), legal `TODO: legal review` markers before
the stores' privacy-policy link, Google OAuth iOS/Android client ids for native one-tap.

---

### Progress log
- 2026-07-22 — Backlog created; old SaaS backlog archived. **Phase 0 complete** (commit ce07510): DB renamed to rangla-punjab-resturant, migrations applied, operator seeded, brand seam, .env trimmed. Phase 1 started.
- 2026-07-22 — Removed PgBouncer everywhere; app connects directly to the remote Postgres (dev/CI keep a local container). **P4-1 done**: de-tiered billing to a single `support` plan, decoupled features from billing (`plan-state` always all-on), built the in-app monthly support-fee subscription with a warn-only overdue banner. Typecheck clean; targeted test suites green on the local DB.
- 2026-07-22 — **P1-3 verified done** (template picker already implemented). **AI menu-import removed** (feature + worker + model/migration). **Images moved to local disk** (`public/uploads` + `/img` sharp resize; dropped S3/MinIO/imgproxy/@aws-sdk). Full vitest suite green (434) on the local DB; typecheck + lint clean. All work committed to local branch `rangla` (not pushed).
- 2026-07-22 — **Remaining phases cleared** (branch `rangla`): P4-2 (removed public signup + onboarding wizard + `/platform` marketing + `/admin/onboarding` funnel), P1-4 (branch switcher + active-venue cookie), P2-5 (order→pay e2e incl. kitchen visibility), P3-2 (operator Provision-Restaurant form + owner invite email), P3-3 (backups/runbooks folded into `/admin`), P4-4 (no k6 to prune; tier-price/AI/aws-sdk already gone). **P5 security pass verified**: RLS isolation test green (prod runs RLS-off as owner by decision), webhook 400s unsigned, `/admin`→isPlatformAdmin + `/dashboard`→membership, rate limits on order/pay/auth, guest-bundle check present. **P6-1**: prod compose validates (app + caddy + redis + remote DB + uploads volume; no pgbouncer/imgproxy/minio). Full suite green (437). Only ⛔ P6-2/P6-3 (VPS/DNS/live-Stripe) remain — human-gated. **Action for operator: rotate the live Stripe key currently in `.env`.**
- 2026-09-19 — **Phase 7 opened** (owner & guest experience in the app). P7-1…P7-7 shipped and live on prod (`5f8dde9`, `bcb5760`); P7-8/P7-9 in progress; P7-10…P7-17 queued with decisions recorded above. Working mode for this phase: Opus agents implement, Fable architects/reviews; pushes only on the owner's say-so.
