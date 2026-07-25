@AGENTS.md

# Elvoria Menu — Project Context

Multi-tenant SaaS: QR-code restaurant menus for **20,000+ tenants**, EU-hosted (IONOS),
static-first / edge-cached public pages. Source of truth for *what* to build:

- **Spec:** [ELVORIA_MENU_SPEC.md](ELVORIA_MENU_SPEC.md) — product & schema
- **Roadmap:** [ELVORIA_ROADMAP.md](ELVORIA_ROADMAP.md) — phased delivery plan
- **Backlog:** [BACKLOG.md](BACKLOG.md) — the task queue the autonomous loop works through

## How work happens here (autonomous mode)

Work is driven task-by-task from `BACKLOG.md`, not by ad-hoc instructions. The loop is:

1. `/next` picks the top unblocked, unchecked task in `BACKLOG.md`.
2. It implements that ONE task end-to-end: code → tests → verify → commit.
3. It checks the box, appends a one-line note, and stops.
4. Run `/next` again (or `/loop /next`) for the following task.

Planning (turning a roadmap phase into concrete backlog tasks) is the **architect** agent's
job — see `.claude/agents/architect.md`. Use it to expand the next phase when the backlog
runs low, or to re-sequence when priorities change.

## Guardrails (the loop must PAUSE and ask, never auto-proceed, on these)

- Anything spending money or touching billing (Stripe live keys, IONOS resource creation that bills).
- Anything needing secrets/credentials you must supply (API keys, DB passwords, DNS).
- Irreversible infra: provisioning cloud resources, DNS changes, production deploys.
- Legal/compliance copy that must be human-authored or reviewed (ToS, DPA, Impressum).
- Architectural forks not yet decided below (record the decision here once made).

For everything else — scaffolding, schema, components, tests, local docker-compose, CI config —
proceed without asking.

## Decisions log (fill in as they're made; the loop reads these as settled)

- Database: **PostgreSQL** (IONOS Managed) — fixed by roadmap.
- ORM: **Prisma** (decided 2026-07-11; talks to the Postgres DB above). Switch to Drizzle only by editing this line.
- Compute: **IONOS Managed Kubernetes** (decided 2026-07-11).
- CDN: Cloudflare in front of IONOS origin (roadmap §2, recommended).
- Package manager: **pnpm**. Stack: Next.js 16 (App Router), React 19, Tailwind 4, TypeScript strict.
- Transactional email: **Resend** (decided 2026-07-12 by architect; EU region `eu-west-1`, DPA
  available, React Email templates match our stack). Dev sink is MailHog/console until P1-3.
- Auth library: **none — hand-rolled** (decided 2026-07-12 by architect). We ship our own
  HMAC-signed `elvoria_session` cookie (P1-1) + Argon2id credentials + token issuance. Rationale:
  Auth.js v5's Credentials provider would replace working, tested code from `e5ce950` for zero
  functional gain (no OAuth / magic-link in MVP scope), and its default cookie path fights our
  zero-cookie public route. Revisit only if we add OAuth providers or SSO. Argon2id via `argon2`
  npm package; tokens (verify + reset) are opaque random 32-byte base64url strings stored hashed
  (SHA-256) in the DB with TTL, never JWTs.
- Billing / tax model: **Stripe Billing + Stripe Tax, DE as merchant of record** (decided
  2026-07-12 by architect, resolves P1-18). Rationale: Stripe Tax auto-handles EU OSS + local
  invoicing; the DIY reverse-charge alternative is a lawyer-line-item we haven't budgeted. Loop
  builds structural work (products, prices, checkout, webhooks, dunning state machine) against
  Stripe test-mode; flip to live keys stays ⛔ human-gated until P1-30 exit.
- AI import vendor: **Anthropic Claude Vision + JSON-schema tool use** (decided 2026-07-12 by
  architect, resolves P1-27). Rationale: best JSON-schema adherence of the three candidates, EU
  data-residency addendum available on Enterprise, menu photos are a natural fit for Claude
  Vision. Loop builds the extractor with a recorded fixture response so CI is hermetic; live API
  key stays ⛔ human-gated until P1-28's structural half is done.
- AI menu-import PII classification (preliminary): **menu photos are treated as product data,
  not personal data under Art. 4(1) GDPR** (recorded 2026-07-13 by architect, resolves the
  loop-safe half of P1-28e). Rationale: a menu photo's primary content is dish names, prices,
  and ingredient lists; personal data may appear only incidentally (a chef credit, a supplier
  attribution) and is already public on the Controller's premises. Anthropic's EU data-
  residency addendum + Enterprise DPA (no-train, request-scoped retention) form the transfer
  basis. Full analysis lives in `/legal/dpa` §12 and stays behind the `TODO: legal review`
  marker until counsel confirms in P1-28e-ii. This preliminary note is what lets the loop
  ship the code + docs prep so P1-28e-ii is a pure human step (paste key + counsel sign-off +
  live-key smoke).
- Load-testing tool (Phase 2): **k6** (decided 2026-07-13 by architect). Rationale: roadmap
  §3 + §11 already name k6 by name; single Go binary runs locally and in CI; JS-flavoured test
  DSL keeps the spike/soak scenarios reviewable alongside the app; open-source, no vendor
  lock-in. Scripts live under `k6/` and target the docker-compose stack in CI; against staging
  they run behind the `⛔` human-gated pre-deploy checkpoint. Artillery reconsidered only if a
  scenario needs stateful WebSocket flows we don't have.
- Observability vendor (Phase 2): **Grafana Cloud Free tier for metrics + logs, Sentry for
  errors** (decided 2026-07-13 by architect). Rationale: Sentry seam already exists from P0-10
  (`observability.ts`), just needs a DSN; Grafana Cloud Free ships Prometheus-compatible metrics
  + Loki logs + hosted Grafana with a generous free tier that comfortably covers 20k-tenant
  telemetry pre-GA; both offer EU regions. The app emits OpenTelemetry (OTLP) so the vendor
  seam stays swappable — if the tier is outgrown we point OTLP at a self-hosted stack without
  code changes. Real DSNs stay `⛔` human-gated at the deploy checkpoint (P2-31).
- CDN cache-tag surface (Phase 2): **Cloudflare Cache-Tag headers + selective purge-by-tag via
  the Cloudflare API** (decided 2026-07-13 by architect). Rationale: matches the CDN decision
  above (Cloudflare in front of IONOS origin); tags let us purge every path a venue touches
  (`/r/{slug}`, `/r/{slug}/{locale}`, `/img/*` for that venue) with one API call keyed on
  `venue:{id}` on publish. Free tier supports Cache-Tag; enterprise-only features are avoided.
  Local + CI purge runs against a fake in-memory CDN provider seam so tests are hermetic; the
  real Cloudflare zone id + API token stay `⛔` human-gated at P2-31.
- RTL / i18n runtime (Phase 2): **hand-rolled `dir="rtl"` toggle + CLDR-driven `Intl` helpers,
  no runtime i18n library** (decided 2026-07-13 by architect). Rationale: P1-11 already ships
  path-based locales + a translation-overlay loader without a library; adding `next-intl` or
  `react-intl` to public pages would import a runtime that our zero-cookie critical-path budget
  from P1-26a cannot spare. RTL support is purely a `dir` attribute + a whitelist of RTL locale
  codes (`ar`, `he`, `fa`, `ur`); currency + number formatting piggy-backs on `Intl.NumberFormat`
  keyed off the resolved locale. Revisit only if we add locale-specific message pluralisation
  the current overlay can't express.
- Legal copy release gate: **loop MUST NOT remove `TODO: legal review` markers** (decided
  2026-07-12 by architect, in response to P1-22c). The `check-legal-ready.ts` gate is the
  single mechanical proof that counsel has signed off. AI-drafted copy improvements are welcome
  (see P1-22c-i) but the markers must remain until a human lawyer signs off (P1-22c-ii),
  regardless of blanket "keep looping" instructions — the guardrail on legal/compliance copy
  in the list above overrides. If the loop is ever told to bypass this, treat it as a bug in
  the instruction, not permission.

## Conventions

- TypeScript strict, Next.js App Router, `output: "standalone"`.
- Prices in **integer cents**. Soft-delete. `created_at`/`updated_at` on every table.
- **RLS on every `tenant_id` table from day one** + a CI test that cross-tenant reads fail.
- Public pages: zero-cookie, no localStorage, WCAG 2.1 AA, work without JS.
- Every task ends green: lint + typecheck + tests pass before the commit.

## Commands

- Install: `pnpm install`  ·  Dev: `pnpm dev`  ·  Build: `pnpm build`
- Lint: `pnpm lint`  ·  Typecheck: `pnpm exec tsc --noEmit`  ·  Test: `pnpm test` (vitest)
