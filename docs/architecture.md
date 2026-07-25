# Guesto — Architecture

A single-page tour of the running system. Diagrams render on GitHub, in
VS Code's Markdown preview with the Mermaid extension, and at
[mermaid.live](https://mermaid.live) if pasted.

Legend for the boxes:

- **green** — real, running, covered by tests
- **yellow** — code path is real, but it defaults to a fake provider
  until the human unblocks the live-key gate
- **grey / dashed** — planned in Phase 2, seam exists, not wired yet

---

## 1. System topology

```mermaid
graph TB
  classDef real fill:#dcfce7,stroke:#166534,color:#052e1a
  classDef fake fill:#fef3c7,stroke:#a16207,color:#3c2410
  classDef planned fill:#f3f4f6,stroke:#6b7280,color:#374151,stroke-dasharray: 5 5

  Guest[Guest browser<br/>scans a QR, reads a menu]:::real
  Operator[Operator browser<br/>signed in, edits + publishes]:::real

  subgraph Edge["Edge · Phase 2 planned"]
    CF[Cloudflare CDN + WAF<br/>Cache-Tag purge, P2-16/17]:::planned
  end

  subgraph App["Guesto Next.js 16 app · Node 22 · standalone build"]
    MW[middleware.ts<br/>x-request-id, x-pathname]:::real
    Public["/r/[slug]<br/>zero-cookie, edge-cacheable"]:::real
    Dash["/dashboard/*<br/>owner + staff UI"]:::real
    APIs["/api/*<br/>auth · items · menu-import<br/>stripe · uploads · metrics"]:::real
    OTel[OpenTelemetry SDK<br/>P2-2, OTLP env-gated]:::real
    Metrics["/api/internal/metrics<br/>Prometheus text, P2-3"]:::real
  end

  Worker[BullMQ menu-import worker<br/>pnpm worker, standalone Node]:::real

  subgraph Data["Data plane · docker-compose today, IONOS Managed later"]
    PG[(PostgreSQL 16<br/>RLS on every tenant_id table<br/>18 models · MenuImportDraft · ...)]:::real
    Redis[(Redis 7<br/>BullMQ queue + rate limits)]:::real
    S3[MinIO / IONOS S3<br/>tenant media]:::real
    IMG[imgproxy<br/>signed WebP resizer]:::real
  end

  subgraph Ext["External services · env-gated seams"]
    Stripe[Stripe Billing + Tax<br/>test-mode-ready, live keys P1-19f-ii]:::fake
    Anthropic[Anthropic Claude Vision<br/>fixture provider, live key P1-28e-ii]:::fake
    Resend[Resend transactional email<br/>MailHog sink in dev]:::fake
    Sentry[Sentry EU errors<br/>seam wired, DSN P2-31]:::planned
    Grafana[Grafana Cloud metrics + logs<br/>OTLP endpoint, key P2-31]:::planned
  end

  Guest -.->|planned CDN path| CF
  CF -.-> Public
  Guest -->|localhost:3000 today| Public
  Operator --> Dash
  Operator --> APIs
  MW --> Public
  MW --> Dash
  MW --> APIs

  Public --> PG
  Public --> IMG
  IMG --> S3
  Dash --> PG
  APIs --> PG
  APIs --> Redis
  APIs --> S3
  APIs -->|enqueue| Worker

  Worker --> Redis
  Worker --> PG
  Worker --> Anthropic

  APIs --> Stripe
  APIs --> Resend

  OTel -.-> Grafana
  APIs -.-> Sentry
  Metrics -.-> Grafana
```

---

## 2. Guest reads a menu — the hot path

The single most important flow: someone scans a table QR and gets
their menu. Zero cookies, zero JavaScript required, edge-cacheable
for >99% hit-ratio at scale.

```mermaid
sequenceDiagram
  autonumber
  participant G as Guest phone
  participant CF as Cloudflare (planned)
  participant MW as Next middleware
  participant Route as /r/[slug]
  participant Loader as loadPublicMenu()
  participant DB as Postgres (RLS)
  participant Img as imgproxy
  participant S3 as MinIO / IONOS S3

  G->>CF: GET /r/demo
  Note over CF: cache HIT for 99%+ of requests<br/>(P2-16/17 wires purge tags)
  CF->>MW: cache MISS - forward to origin
  MW->>MW: mint x-request-id, x-pathname
  MW->>Route: forward with headers
  Route->>Loader: resolvePreviewContext + loadPublicMenu
  Loader->>DB: asTenant(tenantId) → SELECT ...
  Note over DB: RLS filters to venue's tenant<br/>even with explicit cross-tenant WHERE
  DB-->>Loader: menu tree (4 cats, 18 items)
  Loader-->>Route: PublicMenu shape
  Route-->>MW: HTML + JSON-LD, zero JS, no cookies
  MW-->>CF: cache-control: public, s-maxage=…
  CF-->>G: cached HTML at edge

  G->>Img: GET /img/... signed WebP URL
  Img->>S3: GetObject
  S3-->>Img: bytes
  Img-->>G: resized WebP
```

---

## 3. AI menu import — job path

Operator uploads a photo, the AI extracts a structured payload, the
operator reviews + confirms, and the extraction lands in the tenant's
draft menu. Dev + CI run against a committed fixture; the live
Anthropic path is gated by `P1-28e-ii` until the human provisions a
key and counsel signs off on the PII draft in `/legal/dpa` §12.

```mermaid
sequenceDiagram
  autonumber
  participant Op as Operator
  participant API as POST /api/menu-import
  participant Draft as createDraft()
  participant DB as Postgres
  participant Q as BullMQ (Redis)
  participant W as menu-import worker
  participant AI as AnthropicAiImportProvider<br/>(FAKE in dev)
  participant Rev as /dashboard/menu-import/[id]/review
  participant Cf as confirmImportDraft()

  Op->>API: upload photo → POST body
  API->>Draft: createDraft(venueId, sourceMediaId)
  Draft->>DB: INSERT MenuImportDraft status=queued
  API->>Q: enqueueMenuImport({draftId, tenantId})
  API-->>Op: 202 {id, status: queued}

  W->>Q: BRPOP job
  W->>DB: asTenant → SET status=extracting
  W->>AI: extract(mediaKey)
  Note over AI: dev = pizzeria-di-mario.json fixture<br/>prod = Claude Vision + JSON-schema tool
  AI-->>W: ExtractedPayload (validated)
  W->>DB: SET status=ready, extractedPayload=…

  Op->>Rev: GET the review page
  Rev-->>Op: side-by-side photo + extracted tree
  Op->>Cf: click "Confirm & save as draft"
  Cf->>DB: INSERT categories + items + variants<br/>into tenant's draft MenuVersion
  Cf->>DB: SET MenuImportDraft.status=confirmed
  Cf-->>Op: redirect to /dashboard/categories
```

---

## 4. Entity model — every restaurant in one database

Twenty tables, one database. Every table that stores restaurant-owned
data carries a `tenant_id` stamp — that column is the isolation
boundary (see §5). Only `users` and the login-token tables are
platform-global: an account exists before it joins a restaurant.
`audit_events` and `scan_stats` (tenant-stamped, partitioned by month)
are omitted from the picture for legibility.

```mermaid
erDiagram
    TENANT ||--o{ MEMBERSHIP : "has members"
    USER ||--o{ MEMBERSHIP : "belongs via"
    TENANT ||--|| SUBSCRIPTION : "pays via"
    TENANT ||--o{ VENUE : owns
    VENUE ||--o{ SLUG_REDIRECT : "old names"
    VENUE ||--o{ MENU : has
    MENU ||--o{ MENU_VERSION : "draft + published"
    MENU_VERSION ||--o{ CATEGORY : contains
    CATEGORY ||--o{ ITEM : contains
    ITEM ||--o{ ITEM_VARIANT : "sizes / options"
    TENANT ||--o{ TRANSLATION : "menu text, 10 locales"
    TENANT ||--o{ MEDIA : "uploads (logos, photos)"
    TENANT ||--o{ MENU_IMPORT_DRAFT : "AI imports"
    VENUE ||--o{ ORDER : receives
    ORDER ||--o{ ORDER_ITEM : "price-snapshot lines"

    TENANT {
        string id PK
        string plan "admin override; NULL = follow subscription"
        json entitlement_overrides
        string status "active | suspended"
    }
    USER {
        string id PK
        citext email UK
        bool is_platform_admin
    }
    SUBSCRIPTION {
        string tenant_id FK
        string plan_code "starter | growth | scale"
        string status "trialing | active | past_due | canceled"
    }
    VENUE {
        string id PK
        string tenant_id FK
        string slug UK "public /r/slug — immutable"
        json branding "theme, texture, logo"
        json ordering "owner switches, delivery zones"
    }
    ITEM {
        string tenant_id FK
        int price_cents
        string_array dietary
        string_array allergens
    }
    ORDER {
        string id PK "global cuid — receipt tokens, URLs"
        string tenant_id FK
        int order_number "unique per venue"
        string order_type "dine_in | takeaway | delivery"
        json delivery_address
    }
    ORDER_ITEM {
        string tenant_id FK
        string name "snapshot at order time"
        int price_cents "snapshot at order time"
    }
```

---

## 5. Tenant isolation — the life of a dashboard request

Separation is enforced by PostgreSQL Row-Level Security (`FORCE` on
every tenant table), not by application code remembering to filter.
The policy on every table is
`tenant_id = current_setting('app.current_tenant_id')`; the app
declares the tenant per transaction through the `asUser` / `asTenant`
wrappers in `src/lib/tenant.ts` and never queries outside them.

```mermaid
sequenceDiagram
  autonumber
  participant O as Owner (Restaurant A)
  participant App as Next.js route
  participant W as asUser() wrapper
  participant PG as Postgres (RLS FORCE)

  O->>App: GET /restaurant/a/orders (session cookie)
  App->>W: asUser(userId, query)
  W->>PG: BEGIN transaction, resolve membership → tenant A
  W->>PG: SET app.current_tenant_id = 'A'
  App->>PG: SELECT * FROM orders — no WHERE clause
  Note over PG: policy filters every row:<br/>tenant_id = current_setting(...)
  PG-->>App: only Restaurant A's rows
  Note over PG: without the SET → 0 rows.<br/>Bugs fail CLOSED, never leak.
```

The deliberate doors through the wall are four hand-written
`SECURITY DEFINER` functions, each a narrow projection:
`resolve_public_venue(slug)` (guest QR scan), `list_public_venues()`
(sitemap), `admin_list_tenants()` / `admin_set_tenant_plan()`
(platform console, gated by `users.is_platform_admin`). Beyond the
database: S3 keys are prefixed `{tenantId}/uploads/…`, dashboard URLs
404 unless the slug belongs to the session's venue, and receipt links
carry HMAC tokens bound to the tenant.

---

## 6. Per-restaurant business logic — plan, trial, and feature gates

What one restaurant can do is derived — never stored as a flat flag —
by `resolveTenantAccess()` in `src/lib/plan-state.ts`, the single
derivation used by the order API, the public menu, the dashboard, and
the platform console:

```mermaid
flowchart TB
  classDef state fill:#dcfce7,stroke:#166534,color:#052e1a
  classDef gate fill:#fef3c7,stroke:#a16207,color:#3c2410
  classDef off fill:#fee2e2,stroke:#991b1b,color:#450a0a

  Start([Request for tenant T]) --> OV{admin override set?<br/>tenants.plan}
  OV -- yes --> P1[Use override plan]:::state
  OV -- no --> SUB{subscription?}
  SUB -- "active" --> P2[Use its plan_code<br/>starter / growth / scale]:::state
  SUB -- "trialing, not expired" --> P3[Trial: full access<br/>30 days, no card]:::state
  SUB -- "none yet" --> AGE{tenant younger<br/>than 30 days?}
  AGE -- yes --> P3
  AGE -- no --> L1[Lapsed: ordering OFF immediately]:::off
  SUB -- "past_due / canceled /<br/>trial expired" --> L1
  L1 --> GR{within 14-day grace?}
  GR -- yes --> L2[Menu stays public<br/>guests never punished mid-service]:::gate
  GR -- no --> L3[Menu stops resolving — 404]:::off

  P1 --> ENT
  P2 --> ENT
  P3 --> ENT
  ENT[Entitlements matrix<br/>Starter: dine-in + takeaway<br/>Growth: + kitchen display, stats, delivery<br/>Scale: + online payments, future]:::state
  ENT --> OWN[∧ owner's own switches<br/>venues.ordering JSON:<br/>modes on/off, delivery ZIPs, fee, minimum]:::gate
  OWN --> OUT([Effective capability — rendered by the<br/>guest drawer, re-checked inside placeOrder])
```

Two properties worth keeping true forever:

- **The server re-derives everything.** The guest drawer renders only
  the allowed modes, but `placeOrder` re-runs the same derivation
  inside its transaction — a forged POST for an unentitled feature
  gets `type_not_available`, the same trust model as recomputing every
  price from the database.
- **Effective capability = plan entitlement ∧ owner switch.** The plan
  is the ceiling Guesto sells; the switches are the owner's own
  on/off beneath it ("driver is sick tonight"). Neither alone grants
  anything.

---

## 7. Where things live (file map)

Files a new engineer would open first, grouped by concern.

| Concern | Key files |
|---|---|
| **Product spec** (what to build) | `ELVORIA_MENU_SPEC.md` |
| **Roadmap** (phased delivery plan) | `ELVORIA_ROADMAP.md` |
| **Task queue** (loop works through this) | `BACKLOG.md` |
| **Architectural decisions** | `CLAUDE.md` — "Decisions log" section |
| **Data model** | `prisma/schema.prisma` (18 models + enums) |
| **Migrations** | `prisma/migrations/*/migration.sql` (12 folders) |
| **RLS policies** | `prisma/migrations/20260711215814_rls_policies/migration.sql` + inline blocks in later migrations |
| **App runtime** | `src/app/**` — App Router routes, page + route handlers |
| **Middleware** | `src/middleware.ts` — request-id + pathname injection |
| **Instrumentation hook** | `instrumentation.ts` — Sentry stub + OTel boot |
| **Domain services** | `src/lib/**` — one file per concern (`auth-service.ts`, `items-service.ts`, `billing-service.ts`, `menu-import/*`, …) |
| **BullMQ worker** | `src/workers/menu-import.ts` |
| **Public menu view** | `src/app/r/[slug]/page.tsx` + `menu-view.tsx` |
| **Owner admin surface** | `src/app/dashboard/admin/{runbooks,backups}/page.tsx` |
| **Legal MDX** | `src/content/legal/*.mdx` (5 files, `TODO: legal review` markers until counsel signs) |
| **Operator runbooks** | `src/content/runbooks/*.mdx` (6 files, on-call playbooks) |
| **Infra as code** | `infra/terraform/*.tf` (validates locally, `apply` gated by P0-11-ii) |
| **CI workflow** | `.github/workflows/ci.yml` — lint, tsc, vitest, RLS test, axe, LHCI, image build |
| **Env contract** | `src/lib/env.ts` (parsed at boot, fail-fast) + `.env.example` |
| **Local dev stack** | `docker-compose.yml` (postgres, redis, minio, mailhog, imgproxy) |

---

## 8. Live status (regenerate before you cite it)

These numbers were pulled at the P2-7 commit. They drift with every
merge; run the commands in the rightmost column to refresh.

| Metric | Current | How to re-check |
|---|---|---|
| Prisma models | 18 | `grep -c '^model ' prisma/schema.prisma` |
| Migrations | 12 | `ls prisma/migrations \| grep -v migration_lock \| wc -l` |
| Phase 1 tasks (code) | 30/30 done | `grep -c '^- \[x\] (P1-' BACKLOG.md` |
| Phase 2 tasks | 7/37 done | `grep -c '^- \[x\] (P2-' BACKLOG.md` |
| ⛔ human-gated tasks open | 4 | `grep -c '⛔ needs-human' BACKLOG.md` (filter unchecked) |
| Vitest cases | 364 passing | `pnpm test` |
| Playwright axe on `/r/demo` | 2/2 passing | `pnpm test:axe` |
| Lighthouse mobile perf | 97-98 | `pnpm test:lhci` |
| Lighthouse mobile a11y | 100 | (same) |
| LCP on `/r/demo` (Slow 4G) | ~2.3-2.5 s | (same) |
| Public menu transfer | ~240 KB total | (same, `resource-summary`) |
| Restore-drill golden | 5 items, checksum `709ab42a…` | `pnpm restore-drill` |

---

## 9. Open human gates (what stops "URL a customer can visit")

Everything else runs. These four steps need a person:

| Task | Blocking action | Estimate |
|---|---|---|
| **P1-19f-ii** | Log into Stripe test-mode dashboard, create 3 products, paste 5 keys into `.env` | ~15 min |
| **P1-22c-ii** | Counsel reviews `src/content/legal/*.mdx` + `/legal/dpa` §12, edits in place, removes `TODO: legal review` markers | counsel-dependent |
| **P1-28e-ii** | Provision Anthropic workspace API key with EU data-residency addendum, paste as `ANTHROPIC_API_KEY`, counsel confirms PII draft | ~1 h + counsel |
| **P0-11-ii** | First real `terraform apply` against IONOS + Cloudflare accounts (bills money) | ~3 h first-time |

The **free-tier deploy path** (Vercel + Neon + Upstash + Cloudflare R2 +
Resend) bypasses `P0-11-ii` entirely for a demo/staging cut at €0/mo.
Only Anthropic still needs the $5 minimum credit for the AI import to
work with real photos.

---

## 10. Maintenance

This file is checked in as-is. The numbers in §5 drift — treat them
as "the state at the last commit that edited this file", not as
authoritative. Regenerate when you need to cite them.

Diagrams update by hand when a new subsystem lands. Rule of thumb:
if a task adds a new arrow in section 1 (a new external service, a
new worker, a new data store), amend `docs/architecture.md` in the
same commit.
