# Elvoria Menu — Completed Product & Technical Specification

QR-based digital menu SaaS for restaurants and hotels. This document extends the original outline
with everything required to operate at scale, worldwide, with EU compliance built in.
Sections marked **[NEW]** were added or materially changed versus the original outline.

---

## 1. Product overview

Elvoria Menu lets hospitality businesses create branded digital menus, generate permanent QR codes,
and update items instantly — with **legally compliant allergen display** and **multilingual menus**
as first-class features, not afterthoughts.

**Positioning [NEW]:** the market has many QR menu tools. Elvoria Menu differentiates on:

1. EU compliance out of the box — structured allergen declaration (Reg. 1169/2011), WCAG 2.1 AA
   accessible guest pages (European Accessibility Act), zero-cookie guest experience (no consent banner).
2. Fastest onboarding — AI menu import: photograph or upload the existing menu, get a draft in minutes.
3. Global performance — edge-cached menus load in under a second anywhere.
4. Honest, simple pricing.

---

## 2. System architecture [NEW — revised]

```
Guest (QR scan)
   ↓
CDN edge (cached static menu page — no DB hit, no cookies)
   ↓ (only on cache miss / revalidation)
Next.js (ISR / on-demand revalidation)
   ↓
API layer (Next.js route handlers)
   ↓
PostgreSQL (single cluster, tenant_id + Row-Level Security)
   +
Object storage (S3/R2) + image CDN (resizing, WebP/AVIF)
   +
Stripe (Billing + Tax) · Email provider · Error tracking
```

Key decisions:

- **Public menus are static-first.** Every menu page is rendered to static HTML and cached at the CDN
  edge. Menu edits trigger on-demand revalidation of exactly that restaurant's pages. QR traffic
  spikes (12:00, 19:00) never touch the database. Target: < 1s first load on 3G, < 100 KB critical path.
- **One database, strict tenancy.** Every tenant-owned table carries `tenant_id`; Postgres RLS
  enforces isolation at the database layer, not just in application code. Automated tests assert
  cross-tenant reads fail.
- **Images through a pipeline, never raw.** Uploads go to object storage via signed URLs with size
  and type limits; the image CDN serves resized WebP/AVIF variants. Menu photos are the #1
  page-weight risk — enforce a per-image budget.
- **EU data residency.** Primary hosting region in the EU (e.g., Frankfurt). This is both a GDPR
  simplification and a sales argument for EU customers.
- **QR indirection layer.** Printed QR codes encode `https://domain/r/{slug}`; that route is a thin,
  permanently stable redirect/render layer. Slugs are immutable once printed (renames create a new
  slug + permanent redirect from the old one). Optional `?t={table}` parameter reserved now so
  future ordering knows the table without reprinting codes.

---

## 3. User roles

### 3.1 Tenant users [NEW — extended]
- **Owner** — full control incl. billing and user management.
- **Staff** — menu editing and availability toggles only (no billing, no branding). Restaurants
  delegate daily "sold out" toggling to waiters; this role makes that safe.

Users ↔ tenants is many-to-many with a role per membership (one person can manage several venues;
one venue can have several editors).

### 3.2 Guest
- Scans QR, views menu, switches language. **No account, no cookies, no personal data.** (Future
  ordering will change this — not in MVP.)

### 3.3 Platform admin (you)
- Tenants, subscriptions, monitoring, support impersonation ("view as tenant" with audit log entry).

---

## 4. Main modules

### 4.1 Marketing site
As outlined (hero, problem, solution, features, pricing, live demo restaurant, CTA), plus **[NEW]**:
- A real **demo restaurant** anyone can open (`/r/demo`) — the product sells itself.
- Compliance page: allergen law + accessibility explained in plain language (strong SEO topic).
- Localized marketing pages per launch market (EN first; DE/ES/FR/IT as expansion).

### 4.2 Authentication [NEW — hardened]
- Email/password with verification + password reset; optional Google OAuth.
- Session-based auth (httpOnly cookies), rate-limited login, 2FA later.
- Use a proven auth library — do not hand-roll password flows.

### 4.3 Restaurant dashboard

**Menu management**
- Categories with drag-and-drop ordering.
- Items: name, description, price, image, **structured allergens (see 4.9)**, availability toggle,
  plus **[NEW]**: variants (sizes/options with price deltas), dietary labels (vegan/vegetarian/halal
  — structured, localized), spice level, "chef's pick" flag.
- **[NEW] Draft vs published.** Edits accumulate in a draft; one "Publish" action goes live and
  triggers cache revalidation. Preview-on-phone (QR to a draft preview URL) before publishing.
- **[NEW] Multiple menus per venue with schedules** — breakfast/lunch/dinner menus with time windows;
  the public page shows the active one automatically (venue-timezone aware).
- **[NEW] AI menu import (onboarding killer feature).** Upload a photo/PDF of the current menu → OCR
  + LLM produce a draft menu (categories, items, prices) for review. Cuts onboarding from an hour of
  typing to minutes. Also: manual entry and CSV import as fallbacks.

**Branding**
- Logo, primary color, background image, font choice.
- **[NEW] Accessibility guard:** contrast checking on chosen colors; combinations below WCAG AA are
  rejected with suggestions. Protects guests and shields owners (and you) legally.

**QR codes**
- PNG/SVG/PDF download; print-ready sheets (A4 table tents, sticker sizes) **[NEW]**; optional logo
  in QR center; per-table QR variants (`?t=n`) **[NEW]**.

**Languages**
- Enable languages, set default, per-field translations with fallback to default language.
- **[NEW] AI-assisted translation** (paid feature): one click drafts all translations; owner reviews.
  Allergen and dietary labels ship pre-translated (standard vocabulary, all supported locales).

**[NEW] Owner analytics (privacy-friendly)**
- Scans per day, per menu; language distribution; top-viewed categories. Aggregate counters only —
  no cookies, no fingerprinting, no per-guest tracking.

### 4.4 Public digital menu (the product's heart)
- Mobile-first, edge-cached, restaurant-branded, zero cookies, WCAG 2.1 AA.
- Categories, items, variants, prices formatted per venue locale/currency.
- Allergen badges with tap-to-expand localized descriptions; dietary filters (show vegan only).
- Language switcher (path-based: `/r/{slug}/de`) — cache-friendly and SEO-correct (`hreflang`).
- **[NEW] SEO:** schema.org `Restaurant` + `Menu` structured data, OpenGraph cards, sitemap of public
  menus (owner can opt out).
- **[NEW] Degrades gracefully:** works without JavaScript for the core menu content (it's mostly
  static HTML anyway).

### 4.5 Multi-tenancy [NEW — hierarchy revised]
```
Tenant (account, billing)
  └── Venue (restaurant/hotel outlet: slug, branding, timezone, currency, languages)
        └── Menus → Categories → Items (+ translations, media)
```
The Venue level is what justifies the Hotel plan: one account, several outlets (restaurant, bar,
room service), one invoice. Basic plan = 1 venue.

### 4.6 Subscriptions & billing [NEW — concretized]
- **Stripe Billing + Stripe Tax**: EU VAT (OSS scheme), reverse-charge for B2B customers with a
  validated VAT ID, correct invoices per country — Stripe handles the tax math; you register for OSS.
- Trial: 14 days, no card required (lowest friction; you already gate features by plan).
- Plan gating by limits, not feature crippling of compliance: allergens and accessibility are in
  every plan. Suggested axes: number of venues, menus, languages, AI import/translation credits,
  custom domain, analytics depth.
- Dunning (failed payment retries + emails) via Stripe; grace period → menu stays live but frozen
  (read-only) before disable. Never instantly kill a live restaurant menu over a card failure.
- Prices displayed per market; annual discount.

### 4.7 Platform admin
As outlined, plus **[NEW]**: audit log (who changed what, incl. admin impersonation), feature flags,
per-tenant cache purge, GDPR tooling (export/delete a tenant's data on request).

### 4.8 [NEW] Compliance module (EU cornerstone)
- **Allergens:** the 14 EU-mandated allergens (gluten, crustaceans, eggs, fish, peanuts, soybeans,
  milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs) as a structured vocabulary,
  localized into all supported languages, selectable per item (incl. "may contain" traces).
  Free-text allergen entry is not offered — structure is what makes it compliant and translatable.
- **Guest privacy:** no cookies/localStorage on public pages; analytics via aggregate server counters.
  Result: no consent banner on the guest side at all.
- **Documents:** ToS, Privacy Policy, DPA template for tenants (they're controllers of their menu
  data; you're the processor), Impressum. Sub-processor list (hosting, Stripe, email, image CDN).
- **Accessibility statement** page + WCAG AA testing in CI (automated axe checks on the public menu).

---

## 5. Database structure [NEW — revised]

```
tenants        id, name, created_at, status
users          id, email, password_hash, locale, created_at
memberships    user_id, tenant_id, role (owner|staff)
venues         id, tenant_id, name, slug (unique, immutable), timezone, currency,
               default_locale, enabled_locales[], branding jsonb, status
slug_redirects old_slug → venue_id                     -- printed QR codes never die
menus          id, venue_id, name, schedule jsonb, is_default, published_version
menu_versions  id, menu_id, status (draft|published), published_at   -- draft/publish
categories     id, menu_version_id, order_index
items          id, category_id, price_cents, currency, order_index, is_available,
               allergens[] (enum), traces[] (enum), dietary[] (enum), spice int, flags
item_variants  id, item_id, price_delta_cents, order_index
translations   id, entity_type, entity_id, locale, field, value   -- names/descriptions
media          id, tenant_id, storage_key, width, height, bytes, alt_text
subscriptions  id, tenant_id, stripe_customer_id, stripe_subscription_id, plan,
               status, current_period_end
scan_stats     venue_id, date, locale, menu_id, count               -- aggregates only
audit_events   id, tenant_id, user_id, action, entity, diff jsonb, created_at
```

Notes: prices in integer cents (never floats); soft-delete on tenant-owned entities;
`created_at`/`updated_at` everywhere; RLS policies on all `tenant_id` tables; no `qr_codes` table —
QR images are derived from the venue slug on demand.

---

## 6. App structure (Next.js)

```
app/
 ├── (marketing)/            landing, pricing, demo, compliance, legal
 ├── (auth)/login, signup, verify, reset
 ├── dashboard/
 │    ├── venues/[venueId]/
 │    │    ├── menu/         categories, items, variants, draft/publish, AI import
 │    │    ├── branding/
 │    │    ├── languages/
 │    │    ├── qr/
 │    │    └── analytics/
 │    └── settings/          team, billing (Stripe portal), tenant profile
 ├── admin/                  platform admin
 └── r/[slug]/               public menu (+ /[locale], edge-cached, zero-cookie)
```

---

## 7. MVP scope [NEW — re-prioritized]

**Must build first**
1. Auth + tenant/venue onboarding (wizard: name → AI menu import or manual → branding → QR).
2. Menu CRUD with structured allergens, variants, draft/publish.
3. Public menu page: edge-cached, branded, accessible, multilingual, zero-cookie.
4. QR generation + print pack.
5. Stripe Billing + Tax with trial.
6. Compliance basics: legal docs, allergen vocabulary, contrast guard.

**Deliberately not in MVP** — ordering, payments-from-guests, loyalty, POS/hotel integrations,
custom domains, white-label. (Reserve `?t=` table parameter and venue hierarchy now; they make these
cheap later.)

**Why AI import moved INTO MVP:** onboarding friction is the #1 killer of this product category.
"Photograph your menu, review, publish, print QR — 15 minutes" is the demo that closes sales.

---

## 8. Business model & pricing sanity [NEW — annotated]

- Phase 1 subscriptions as outlined (€9–49 tiers are within market norms). Anchor value against
  print costs: "one reprint of paper menus costs more than a year of Elvoria Menu."
- Phase 2 ordering + commission: note commission models compete with Lieferando etc. only on-premise;
  keep commission-free on-premise ordering as the differentiator, subscription-gated.
- Phase 3 hotel/enterprise: white-label + custom domain + API.

**Go-to-market synergy:** the Elvoria Client Finder already discovers real restaurants worldwide with
verified websites and published emails — it is the lead engine for this product. Respect outreach
tiers (no cold email to DE/AT; those markets via phone/walk-in/LinkedIn — restaurants are also
uniquely walk-in-able).

---

## 9. Non-functional requirements [NEW]

- **Performance:** public menu p95 < 1s on 4G, < 1.5s on 3G; Lighthouse ≥ 90 mobile.
- **Availability:** menus must survive platform incidents — edge cache serves stale on origin failure
  (`stale-if-error`). A restaurant's dinner service never depends on your deploy going well.
- **Backups:** automated daily + point-in-time recovery; restore drill documented.
- **Security:** RLS everywhere, signed uploads, CSP, rate limits on auth/API, dependency scanning,
  tenant-isolation tests in CI.
- **Observability:** error tracking (client + server), uptime monitoring on a sample of public menus,
  structured logs, admin alerting.
- **I18n depth:** RTL support (Arabic/Hebrew) in the public menu theme from the start — cheap now,
  painful later; currency + number formatting via `Intl` per venue locale.
- **Staging environment** + migration discipline (every schema change is a reviewed migration).

---

## 10. Success metrics [NEW]

- Activation: % of signups that publish a menu and download QR within 48h (target > 60% — the AI
  import exists to drive this).
- Time-to-published-menu (target median < 20 min).
- Trial → paid conversion (target 15–25%).
- Monthly logo churn < 3% (restaurants churn hard; annual plans + printed QR = stickiness).
- Scans per venue per week (usage = renewal predictor).

---

## 11. Risks & honest caveats [NEW]

- **Crowded market.** QR menus are easy to start, hard to differentiate — compliance + onboarding
  speed + performance is the wedge; expect price pressure.
- **Restaurant churn is structurally high** (businesses close). Annual billing and multi-venue
  accounts dampen it.
- **"QR fatigue"**: some markets/regulars dislike QR menus — position as *complement* to paper
  (allergen-accurate, always current), not a crusade against it.
- **AI import quality** varies with menu photo quality — always human-review before publish; never
  auto-publish AI output (also the compliant choice for allergen data: the owner confirms).

---

## 12. End-to-end flow (unchanged, annotated)

```
Restaurant signs up (trial, no card)
 → AI-imports or builds menu (draft)
 → sets branding (contrast-checked)
 → publishes → edge cache primed
 → downloads print pack, puts QR on tables
 → guest scans → branded menu < 1s, no cookies, right language
 → owner toggles "sold out" from phone during service → live in seconds
 → trial ends → Stripe checkout (VAT handled) → subscription
```
