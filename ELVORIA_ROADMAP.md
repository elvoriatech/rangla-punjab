# Elvoria Menu — Production Roadmap (scale target: 20,000+ tenants)

Companion to [`ELVORIA_MENU_SPEC.md`](ELVORIA_MENU_SPEC.md). This document turns
the spec into a phased, production-grade delivery plan for a multi-tenant SaaS
that serves **20,000+ restaurant/hotel tenants** on **IONOS (EU) hosting**, with
guest menu traffic far exceeding tenant count.

> Verify current IONOS product names, limits, and pricing before committing — the
> capabilities referenced here (Managed Kubernetes, Managed Database for
> PostgreSQL, S3 Object Storage, Cloud CDN, load balancers, EU regions) are
> stable, but SKUs change. Where IONOS lacks a managed piece, this plan names a
> self-hosted or third-party alternative.

---

## 1. What "20,000 tenants" actually means for scale

The load is asymmetric, and the architecture must reflect that:

| Dimension | Rough magnitude | Where it lands |
|---|---|---|
| Tenants (accounts) | 20,000+ | Postgres rows; light |
| Venues | ~30,000–60,000 (multi-venue) | Postgres rows; light |
| Dashboard writes (menu edits, publishes) | thousands/day | Postgres primary; modest, bursty on publish |
| **Guest menu reads (QR scans)** | **millions/day, spiky at 12:00 & 19:00 local** | **CDN edge — must not hit the DB** |
| Images | hundreds of GB → TB | Object storage + image CDN |
| Background jobs (AI import, translation, revalidation, emails) | continuous | Queue + workers |

**Core principle (from spec §2): public menus are static-first and edge-cached.**
At 20k tenants the guest read path is the scaling problem, and it is solved by
serving pre-rendered HTML from a CDN so that meal-time spikes never reach
Postgres. The database only needs to scale for dashboard writes, background jobs,
and cache-miss revalidations — a much smaller, more predictable load.

**Target SLOs**

- Public menu p95 < 1s on 4G, < 1.5s on 3G; Lighthouse mobile ≥ 90 (spec §9).
- Public menu availability 99.95%+ — survives origin/DB incidents via
  `stale-if-error` at the CDN (a restaurant's dinner service never depends on
  your deploy).
- Dashboard availability 99.9%.
- Publish → live at the edge < 30s.

---

## 2. Architecture adapted to IONOS

IONOS does not offer Vercel-style native edge ISR, so the static-first design is
achieved with an explicit CDN in front of a containerized Next.js origin:

```
Guest (QR scan)  ──►  CDN edge (global)         ← cached HTML/JSON, no cookies
                        │  (Cloudflare in front of IONOS origin, OR IONOS Cloud CDN)
                        ▼  (cache miss / revalidate only)
                     Load balancer (IONOS ALB)
                        ▼
                     Next.js (standalone, Docker) ── N replicas on IONOS
                        │      Managed Kubernetes (or Compute Engine + autoscaling)
        ┌───────────────┼───────────────────────────┐
        ▼               ▼                             ▼
  PostgreSQL       Redis (cache,               Object storage (IONOS S3)
  (IONOS Managed   rate-limit, queue)          + image resize service
   DB: primary            │                     (imgproxy/Thumbor, or
   + read replicas)       ▼                      Cloudflare Images)
                     Background workers (BullMQ):
                     AI import, translations, revalidation, emails, dunning
        External: Stripe (Billing + Tax) · Email (Resend/Postmark) · Sentry
```

Key decisions:

- **CDN in front is mandatory** (this replaces Vercel's edge). Recommended:
  **Cloudflare** in front of the IONOS origin for global POPs, `stale-while-revalidate` /
  `stale-if-error`, and cache purge API. IONOS Cloud CDN is an EU-centric
  alternative if you want a single-vendor stack; Cloudflare gives better global
  reach and a more mature purge/cache API. Data at rest still lives in the EU
  (IONOS Frankfurt/Berlin), satisfying residency.
- **Compute: IONOS Managed Kubernetes** (preferred for autoscaling and rolling
  deploys) or **Compute Engine VMs behind an IONOS load balancer** with a VM
  autoscaling group if you want to avoid k8s early. Next.js runs in `output:
  "standalone"` Docker images.
- **Database: IONOS Managed Database for PostgreSQL**, one primary + ≥1 read
  replica, with **PgBouncer** connection pooling in front (essential — serverless-
  style connection storms will exhaust Postgres otherwise). Row-Level Security on
  every `tenant_id` table (spec §5).
- **Redis** (IONOS-hosted VM or managed equivalent) for: response/data caching,
  rate limiting, the job queue (BullMQ), and short-lived idempotency keys.
- **Images through a pipeline, never raw** (spec §2): signed uploads to IONOS S3
  (size/type limits), served as resized WebP/AVIF via imgproxy/Thumbor behind the
  CDN, or via Cloudflare Images. Enforce a per-image weight budget.
- **QR indirection layer**: printed codes encode `https://domain/r/{slug}`; slugs
  immutable, renames create `slug_redirects`. Reserve `?t={table}` now (spec §2).

---

## 3. Scaling strategy (how each layer holds at 20k tenants)

**Guest reads — the hot path.**
Render each published menu (per locale) to static HTML + a small JSON payload,
cached at the CDN with a long TTL and revalidated on publish. Cache key =
`slug + locale` (+ active menu by schedule). On publish, the worker calls the CDN
purge API for exactly that venue's paths and re-primes them. Result: 99%+ of guest
requests are pure CDN hits; Postgres sees near-zero guest traffic even during the
19:00 spike. `stale-if-error` keeps menus up if the origin/DB is down.

**Database.**
Writes (edits, publishes) go to the primary; heavy read queries (analytics,
admin) go to read replicas. PgBouncer (transaction pooling) caps real connections.
Partition `scan_stats` and `audit_events` by month (they grow unboundedly).
Prices in integer cents; soft-delete tenant data; RLS enforced and asserted by
cross-tenant tests in CI (spec §5, §9).

**Images.**
Never serve originals. Enforce upload budget; generate responsive WebP/AVIF
variants on demand and cache them at the CDN. This is the #1 page-weight risk
(spec §2).

**Background work.**
A queue (BullMQ on Redis) with autoscaled workers handles AI menu import
(OCR + LLM), AI translation, cache revalidation, transactional email, and Stripe
dunning. Nothing slow happens in the request path. Jobs are idempotent and
retried with backoff; a dead-letter queue captures failures.

**Statelessness.**
App instances hold no session state (sessions in signed httpOnly cookies +
Redis), so they scale horizontally behind the load balancer and roll safely.

**Multi-region later.**
MVP is single EU region (Frankfurt/Berlin) + global CDN — enough for 20k tenants.
Reserve read replicas in a second region only if latency data later demands it.

---

## 4. Phased roadmap

### Phase 0 — Foundations (before feature work)
Establish the rails so nothing is retrofitted later.

- Monorepo, TypeScript strict, Next.js App Router, ESLint/Prettier, commit hooks.
- ORM + migrations (**Prisma** or **Drizzle**) with the spec §5 schema; **RLS
  policies from day one**, plus a test that asserts cross-tenant reads fail.
- Dockerized app (`output: "standalone"`); local dev via docker-compose
  (Postgres + Redis + MinIO as S3 stand-in).
- IONOS accounts/projects, EU region chosen, IaC (Terraform) for DB, object
  storage, k8s/compute, load balancer, DNS.
- CI/CD skeleton (lint → typecheck → test → build image → deploy to staging).
- Secrets management (IONOS secrets / Vault / sealed secrets), `.env` contract.
- Error tracking (Sentry), structured logging, uptime monitoring stubs.

### Phase 1 — MVP (spec §7 "must build first")
Ship a sellable product.

1. **Auth + onboarding wizard** — email/password (verify + reset) via a proven
   library (Auth.js/Lucia), session cookies, rate-limited login. Wizard: name →
   AI import or manual → branding → QR.
2. **Menu CRUD** — categories (drag-order), items (structured allergens, variants,
   dietary, spice, flags), **draft vs published** with one-click publish +
   revalidation, multiple menus per venue with schedules, phone preview of drafts.
3. **Public menu page** — edge-cached, branded, mobile-first, **zero-cookie**,
   WCAG 2.1 AA, path-based locales (`/r/{slug}/de`), allergen badges, dietary
   filters, schema.org `Restaurant`/`Menu`, `hreflang`, works without JS.
4. **QR generation + print pack** — PNG/SVG/PDF, A4 table tents, stickers, center
   logo, per-table `?t=n`.
5. **Stripe Billing + Tax** — 14-day trial (no card), plan gating by limits (never
   crippling compliance), dunning with read-only grace period before disable.
6. **Compliance basics** — 14 EU allergens as structured localized vocabulary,
   contrast guard on branding, legal docs (ToS, Privacy, DPA, Impressum,
   sub-processor list), accessibility statement.
7. **AI menu import** — photo/PDF → OCR + LLM → reviewable draft (human confirms;
   never auto-publish). This is the onboarding wedge (spec §7).

**Exit criteria:** a real restaurant can sign up, import + publish a menu, print
QR, and be billed — with allergens compliant and the public page passing
Lighthouse ≥ 90 and axe accessibility checks.

### Phase 2 — Production hardening & scale (before/at growth)
Make it survive 20k tenants and EU audits.

- CDN edge caching fully wired: publish → purge → re-prime; `stale-if-error`.
- PgBouncer + read replicas; query performance pass; partition `scan_stats` /
  `audit_events`; slow-query monitoring.
- Load & soak testing to meal-time spike profile (k6): validate p95 SLOs and cache
  hit ratio; capacity numbers signed off.
- Backups: automated daily + PITR; **documented restore drill** actually executed.
- Observability: SLO dashboards, alerting (error rate, p95, queue depth, DB
  connections, cache hit ratio), on-call runbooks, incident process.
- Security: CSP, signed uploads, rate limits on auth/API, dependency scanning,
  automated tenant-isolation tests, pen-test/checklist pass.
- Owner analytics (privacy-friendly aggregate counters), audit log + admin
  impersonation with audit entries, per-tenant cache purge, GDPR export/delete
  tooling.
- RTL support (Arabic/Hebrew) and `Intl` currency/number formatting in the public
  theme (cheap now, painful later — spec §9).
- Staging mirrors prod; every schema change is a reviewed migration.

### Phase 3 — Growth (post scale, spec §8 phases 2–3)
Deliberately **not** in MVP; the foundations reserve them cheaply.

- Custom domains + white-label; hotel/multi-venue enterprise plan depth.
- On-premise guest ordering (`?t=` table param already reserved) — commission-free
  as the differentiator, subscription-gated.
- API for integrations; localized marketing pages per market (DE/ES/FR/IT).
- 2FA; deeper analytics; second-region read replica if latency data warrants.

---

## 5. Environments, infra & IaC

- **Environments:** local (docker-compose) → staging (prod-like, seeded) →
  production (IONOS EU). No manual prod changes; everything via CI + Terraform.
- **IaC:** Terraform for IONOS resources (DB, object storage, k8s/compute, LB,
  DNS, firewall) + Cloudflare (zones, cache rules, WAF). State in remote backend.
- **Deploys:** immutable Docker images tagged by commit; rolling deploys on k8s
  with health checks and automatic rollback; DB migrations gated and
  backward-compatible (expand/contract pattern) so deploys don't require downtime.
- **Config/secrets:** never in the repo; injected at runtime; rotated; least
  privilege for DB and S3 credentials.

---

## 6. Data layer & multi-tenancy

- Schema per spec §5; **RLS on every `tenant_id` table** is the isolation
  boundary, not just app code. CI test proves a tenant cannot read another's rows.
- Immutable venue `slug` + `slug_redirects` so printed QR codes never break.
- Draft/publish via `menu_versions`; only published versions are rendered/cached.
- Integer cents everywhere; soft-delete; `created_at`/`updated_at` on all tables.
- Migrations reviewed, reversible, run in CI against a copy of prod schema.
- Backups: daily automated + PITR; restore drill documented and rehearsed.

---

## 7. Security & EU compliance (a first-class workstream, not a phase)

- **GDPR/residency:** EU region; DPA (you = processor, tenant = controller);
  sub-processor list; export/delete tooling; user text never logged at info level.
- **Guest privacy:** no cookies/localStorage on public pages → **no consent
  banner**; analytics as aggregate server counters only (spec §4.8).
- **Allergens (Reg. 1169/2011):** 14 allergens as structured, localized enums —
  no free text; "may contain" traces supported; owner confirms on publish.
- **Accessibility (EAA / WCAG 2.1 AA):** contrast guard on branding; automated
  axe checks on the public menu in CI; accessibility statement page.
- **App security:** CSP, signed S3 uploads with type/size limits, rate limiting
  on auth/API, dependency + image scanning, secrets hygiene, audit log,
  impersonation logged.

---

## 8. CI/CD

Pipeline per PR: install → lint → typecheck → unit + integration tests (incl.
RLS/tenant-isolation) → build image → deploy to staging → automated a11y (axe) +
smoke + Lighthouse budget checks. Merge to main → deploy staging; tagged release →
promote the **same image** to production with rolling deploy + health-gated
rollback. Nightly: dependency/vuln scan, backup verification, load-test on
staging.

---

## 9. Observability & SRE

- **Metrics/SLOs:** public-menu p95 latency, CDN cache-hit ratio, error rate,
  DB connections/replica lag, queue depth/job failure rate, publish→live time.
- **Tracing/logs:** structured JSON logs with request/tenant id (never raw user
  text); distributed tracing on the request + worker paths.
- **Alerting & on-call:** page on SLO breach, error spikes, queue backlog, DB
  saturation, backup failure; runbooks per alert; blameless postmortems.
- **Synthetic checks:** uptime probes on a sample of real public menus (the thing
  customers actually see).

---

## 10. Capacity & performance budget (sanity for 20k tenants)

- **Guest reads:** with >99% CDN hit ratio, origin sees only misses +
  revalidations — a few app replicas + one Postgres primary handle it comfortably.
  The CDN, not your servers, absorbs the meal-time spike.
- **Postgres:** 20k tenants of menu data is small (low tens of GB). Sizing is
  driven by write bursts on publish and analytics reads (→ replicas), not raw row
  count. PgBouncer keeps connection count sane.
- **Page budget:** critical path < 100 KB, images lazy + responsive under budget,
  Lighthouse ≥ 90 enforced in CI.
- **Validate, don't assume:** k6 load test to the spike profile in Phase 2 before
  declaring the SLOs met.

---

## 11. Testing strategy

- **Unit:** pricing/tax math (integer cents), allergen vocabulary, schedule/active-
  menu logic, contrast guard.
- **Integration:** auth flows, menu CRUD, draft/publish + revalidation, Stripe
  webhooks (trial, dunning, VAT), RLS/tenant isolation (must fail cross-tenant).
- **E2E:** onboarding wizard → publish → QR → guest view, on mobile viewport.
- **Accessibility:** automated axe on public menu in CI; manual AA spot checks.
- **Performance:** Lighthouse budget + k6 spike/soak tests.
- **DR:** backup restore drill executed and documented.

---

## 12. Risks (spec §11) & mitigations

- **Crowded market / price pressure** → win on compliance + onboarding speed +
  sub-second performance; make AI import the demo that closes.
- **High restaurant churn** → annual billing + printed QR + multi-venue accounts
  for stickiness; never hard-kill a live menu on a card failure (grace period).
- **AI import quality** → always human-review before publish; never auto-publish
  (also the compliant choice for allergens).
- **IONOS lacks native edge ISR** → explicit CDN (Cloudflare) in front is the
  mitigation and is designed in from Phase 1, not bolted on.
- **Connection storms / DB saturation** → PgBouncer + read replicas + caching from
  the start.

---

## 13. Indicative milestone timeline

Assumes a small team; compress with more engineers. Adjust to your capacity.

| Milestone | Scope | Rough window |
|---|---|---|
| M0 — Foundations | Phase 0 rails, IaC, CI/CD, schema + RLS | Weeks 1–3 |
| M1 — Auth + tenancy | Signup, onboarding wizard, venue model | Weeks 3–6 |
| M2 — Menu + public page | CRUD, draft/publish, edge-cached public menu | Weeks 6–11 |
| M3 — QR + billing + compliance | Print pack, Stripe Billing/Tax, allergens, legal, a11y | Weeks 11–15 |
| M4 — AI import | OCR + LLM draft import with review | Weeks 14–17 |
| **MVP launch (private beta)** | Phase 1 exit criteria met | ~Week 17 |
| M5 — Hardening & scale | CDN wiring, replicas/PgBouncer, load tests, backups+DR, SLO dashboards | Weeks 17–22 |
| M6 — Compliance/ops depth | Audit log, GDPR tooling, analytics, RTL | Weeks 22–26 |
| **GA (production-grade)** | Phase 2 complete; SLOs validated | ~Week 26 |
| Phase 3 | Custom domains, ordering, API, enterprise | Post-GA |

---

## 14. Next step

If you approve this direction, the natural first action is **Phase 0**: scaffold
the Next.js + TypeScript project with the spec §6 `app/` structure, the §5 schema
as Prisma/Drizzle models with RLS, a working `/r/[slug]` edge-cacheable public
route, and docker-compose for local Postgres/Redis/S3 — plus Terraform stubs for
IONOS. Tell me your ORM preference (Prisma or Drizzle) and whether to target IONOS
Managed Kubernetes or Compute Engine VMs, and I'll begin the scaffold.
