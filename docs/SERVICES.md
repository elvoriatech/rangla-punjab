# Guesto — Complete Service Documentation

> **Purpose of this document:** the single source of truth for marketing content and
> the owner-facing website (elvoria.com — the site that sells to restaurants, not the
> guest menu). Every claim here is implemented and verified in the product. The
> "What not to claim" section at the end lists things that are gated or not yet live —
> copy must never promise those as available today.

---

## 1. What Guesto is

**One-liner:** EU-hosted QR menus and guest ordering for restaurants — update prices in
seconds, cover the 14 EU allergens, and load before the water arrives.

**Elevator pitch:** Guesto turns a restaurant's paper menu into a fast, beautiful
digital menu guests open by scanning a QR code — no app to install, nothing to log
into. Owners manage everything from one dashboard: dishes and prices, photos, opening
hours, delivery areas, and orders coming in live to the kitchen. Built for the German
and EU market first: German-language starter menus, EU-14 allergen labelling, EU
hosting, and per-ZIP delivery pricing the way local restaurants actually work.

**Who it's for:** independent restaurants, pizzerias, kebab and döner houses, sushi
bars, cafés and bakeries — especially owners who are **not technical** and don't have
time to build a menu from scratch.

---

## 2. The owner journey (how it works)

1. **Sign up** — email + password. No credit card. The 30-day trial starts with
   *every* feature unlocked (trial = the top plan).
2. **Get a menu in minutes, three ways:**
   - 📷 **Snap your menu** — photograph the existing paper menu; AI extracts every
     dish, price, and category into a draft the owner reviews.
   - 🍽 **Start from a template** — pick a cuisine (Indian/Pakistani, Pizzeria,
     Sushi, Kebab/Döner, Burger, Café & Bakery — curated by Guesto, in German, with
     realistic prices, dietary tags, and allergens) and a complete menu fills in.
   - ✍️ **Start blank** — build dish by dish in the editor.
3. **Make it theirs** — logo, top banner, theme + paper texture, category icons,
   top-bar or side-rail navigation, opening hours, delivery areas, payment badges.
4. **Publish** — guests see only what's published; drafts stay private. Every edit
   goes live globally within moments (CDN purge on publish).
5. **Print the QR codes** — generated in the dashboard; guests scan and order.

**Nothing goes live without the owner pressing Publish.** Draft and published menus
are fully separate.

---

## 3. Pricing & plans

| | **Starter** | **Growth** ⭐ | **Scale** |
|---|---|---|---|
| **Price** | €39 / month | €69 / month | €149 / month |
| **Annual** | €390 (2 months free) | €690 (2 months free) | €1,490 (2 months free) |
| **Pitch** | Perfect for small restaurants and cafés | For restaurants growing their digital ordering business | For restaurant groups and multi-location businesses |
| QR menu + full branding | ✓ | ✓ | ✓ |
| Dine-in ordering (table) | ✓ | ✓ | ✓ |
| Pickup ordering | ✓ | ✓ | ✓ |
| Customer order notifications | ✓ | ✓ | ✓ |
| Menu & item management | ✓ | ✓ | ✓ |
| Multiple menus (lunch, dinner, drinks, seasonal) | — (1 main menu) | ✓ | ✓ (unlimited) |
| Delivery ordering (per-ZIP zones & pricing) | — | ✓ | ✓ |
| Kitchen display system (KDS) + sound notifications | — | ✓ | ✓ (multiple workflows) |
| Sales & order statistics | — | ✓ | ✓ (advanced analytics & reports) |
| Multi-location management + central menu control | — | — | ✓ |
| Staff roles & permissions | — | — | ✓ |
| API access & integrations | — | — | ✓ |
| Dedicated hardware (tablet + printer) | — | — | ✓ |
| Online payments (Stripe) | — | — | ✓ *(launching soon)* |
| Support | Basic | Priority | Dedicated |
| Locations | 1 | 2 | Multi-location |
| Dishes | 200 | 500 | 5,000 |
| **Best for** | Small restaurants starting online ordering | Restaurants with delivery and growing order volume | Restaurant groups, franchises, and chains |

**Trial:** 30 days, full power (everything the Scale plan has), **no credit card
required**. This is a "reverse trial": the owner experiences everything, then picks
the plan that fits.

**After the trial (if no plan chosen):** 14-day grace period — the menu stays
visible to guests but ordering switches off, so a restaurant is never punished
mid-service. After grace, the public menu goes offline until a plan is chosen.
Nothing is deleted; picking a plan brings everything back instantly.

**Marketing angles:** "Try everything free for 30 days — no card." / "Your menu
never goes dark mid-shift." / "Two months free when you pay yearly."

---

## 4. Feature catalogue

### 4.1 The guest menu (what diners see)

- **Instant, no app.** Scan the QR → menu opens in the browser. The guest page is
  engineered to a strict weight budget (measured in CI: the ordering bundle is ~168 KB
  gzipped against a 220 KB budget; a 400-dish menu renders under 150 KB gzipped HTML).
  Marketing-safe phrasing: *"loads before the water arrives."*
- **Installable like an app (PWA).** Guests can add the menu to their home screen;
  it opens full-screen under the restaurant's own name and icon. The dashboard and
  kitchen screens are installable the same way for staff tablets.
- **The restaurant's identity, not ours:**
  - **Hero banner** — owner-uploaded wide image at the very top, with the logo,
    restaurant name, and live Open/Closed status overlaid (Wolt/Lieferando-style).
  - **Browser-tab icon** — the guest's tab shows the *restaurant's* logo as favicon;
    Guesto's brand appears only on Guesto's own pages.
  - **Themes & paper textures** — curated design themes plus texture backdrops,
    switchable live from the dashboard; guests see the change on next load.
  - **Category navigation choice** — classic top bar, or a sticky side rail for long
    menus on large screens (phones always keep the compact top bar).
  - **Category icons** — optional: each category shows its photo or an automatically
    chosen icon (🥟 starters, 🍲 soups…).
- **Live Open/Closed badge** — computed from the venue's own opening hours and
  timezone, including split shifts (lunch + dinner) and past-midnight hours. Shows
  "Open · until 22:00" or "Closed · opens Fri 11:00".
- **Dietary & allergen coverage** — every dish can carry: the **14 EU allergens**
  (Anlage II LMIV), traces, vegetarian / vegan / gluten-free / dairy-free / halal /
  kosher flags, and a spice level (🌶 up to 3). Guests filter the menu by diet with
  one tap; an optional Halal filter + badge is owner-controlled.
- **Languages** — the menu displays in the restaurant's chosen language; 10 menu
  locales supported (DE, EN, FR, IT, ES, NL, PL, PT, TR, AR) with a language switcher
  in the footer, per-language URLs, and correct hreflang for search engines.
- **Currencies** — 12 European currencies (EUR, CHF, GBP, DKK, SEK, NOK, PLN, CZK,
  HUF, RON, TRY, USD), formatted natively.
- **Payment badges** — footer shows which payment methods the restaurant accepts
  (cash, Girocard/EC, Visa, Mastercard, Amex, Apple Pay, Google Pay, PayPal) as icon
  chips — configurable per restaurant, German-typical defaults.
- **Subtle motion** — cards rise in as the guest scrolls; fails open (content always
  visible even if scripts are blocked).

### 4.2 Building the menu (owner tools)

- **Menu editor** — categories and dishes with names, descriptions, prices, photos,
  variants, availability toggles, ordering by drag-equivalent controls. Plain forms;
  works without JavaScript.
- **AI menu import** — photograph the paper menu; dishes, prices, and categories are
  extracted into a reviewable draft. The owner confirms before anything is applied.
- **Starter templates** — six professionally curated cuisine menus (~70 dishes total,
  German-language, realistic prices, dietary + allergen tags, and template photos
  where provided). Applying a template fills the draft in one click; everything is
  editable afterwards. Guesto curates the template catalogue centrally.
- **Photos made safe and fast** — uploads accept JPEG/PNG/WebP up to 10 MB. Every
  image is verified by its actual bytes (not its file name), stripped of EXIF/GPS
  metadata (privacy), resized to a maximum edge of 2048px, and served resized and
  cached per use. Dishes without photos automatically get one of five styled
  placeholder images, so a menu never looks broken or empty.
- **Draft → Publish** — edits accumulate privately in the draft; Publish snapshots it
  for guests. Prices on receipts are always the price at order time.

### 4.3 Guest ordering

- **Three modes, owner-switchable:** dine-in (table number), pickup, delivery.
  Plan entitlements and owner switches combine: the guest only ever sees what's
  actually available.
- **Cart** — floating cart with badge count, bottom-sheet checkout, quantity
  steppers, live totals. Scroll-safe on phones.
- **Delivery areas, the Lieferando way** — one ZIP per row, each with its **own
  delivery fee, minimum order, and optional free-delivery threshold**. At checkout,
  the guest *selects* their ZIP from a dropdown (no typing, no "do you deliver
  here?" surprises) and the city/community name fills in automatically from the
  restaurant's own area definition.
- **Scheduled orders** — "As soon as possible" by default, or a time later today:
  30-minute slots starting one hour out, only within opening hours (split shifts and
  gaps respected). The kitchen sees "⏰ Planned for 18:00" first on every surface.
- **Server-authoritative pricing** — the guest's device sends only *what* they
  ordered; every price, fee, minimum, and total is recomputed on the server. A
  tampered request can change what is ordered, never what it costs.
- **Order confirmation** — order number, live total, and a downloadable PDF receipt
  (German or English).
- **Per-venue order numbers** — simple incrementing numbers per restaurant, the way
  kitchens expect.

### 4.4 Kitchen & operations

- **Kitchen display** — live board of incoming orders for a tablet in the kitchen;
  status flow placed → preparing → ready → done; shows order type, table/customer,
  address for delivery, planned time for scheduled orders, and payment status.
- **New-order chime** — audible alert with selectable sounds (three synthesized tones
  plus two bell recordings), capped at 5 seconds, new order interrupts the previous
  ring. Works after a single tap to enable sound (browser rule).
- **Orders list** — paginated tables with selectable page size, aligned columns,
  full order detail.
- **80 mm ticket printing** — print-formatted order tickets for thermal printers.
- **PDF receipts** — branded, line-itemised (including delivery fee as its own
  line), bilingual.
- **Statistics** (Growth+) — scans and orders over time per venue.

### 4.5 Online payments (Scale plan — launching soon)

- Stripe-powered: each restaurant connects its **own Stripe account** (Stripe
  Connect); guest payments go directly to the restaurant, with an Guesto platform
  fee of **1.5%** per transaction.
- Guest flow: order → secure payment page → kitchen sees PAID on the ticket.
- Double-gated: requires both the Scale plan and completed Stripe onboarding.
- **Until launch, market as "coming soon" only.**

### 4.6 Trust, privacy & engineering (the "why us" proof points)

- **EU-hosted.** Data and images stay in the EU.
- **Hard tenant isolation.** Every restaurant's data is separated at the database
  level with PostgreSQL Row-Level Security — enforced by the database itself, not
  just application code. One restaurant can never read another's data; queries are
  scoped per tenant by design (verified with query plans, not promises).
- **Guests never download admin code.** The guest menu bundle is verified in CI to
  contain zero dashboard/admin code.
- **Speed as a budget, not a hope.** Bundle-size and HTML-weight budgets run in CI
  on every change; the CDN caches menus at the edge with instant purge on publish.
- **Upload security.** File type verified from bytes; EXIF/GPS location data
  stripped from every uploaded photo before storage.
- **Privacy-lean guest experience.** No guest account, no app install, no tracking
  wall to see a menu.

---

## 5. Numbers marketing may use (verified)

| Claim | Verified value |
|---|---|
| Guest ordering bundle | ~168 KB gzipped (budget-enforced < 220 KB) |
| 400-dish menu HTML | < 150 KB gzipped (CI-tested) |
| EU allergens covered | all 14 (Anlage II LMIV) + traces |
| Menu languages | 10 |
| Currencies | 12 |
| Starter templates | 6 cuisines, ~70 curated dishes |
| Trial | 30 days, full features, no card |
| Grace after trial | 14 days menu-visible |
| Platform fee on online payments | 1.5% |
| Delivery areas per venue | up to 200 ZIP rows |
| Image cap | 10 MB upload, auto-optimised |

---

## 6. Website FAQ (raw answers to shape into copy)

**Do guests need an app?** No. Scan the QR code, the menu opens in the browser.
They can optionally add it to their home screen like an app.

**Do I need a card for the trial?** No. 30 days, everything unlocked, no card.

**What happens when my trial ends?** Your menu stays visible for another 14 days
(ordering pauses). Pick a plan any time and everything switches back on instantly.
Nothing is deleted.

**I'm not technical — how do I get my menu in?** Photograph your paper menu and our
AI builds it for you, or pick a ready-made cuisine template and just adjust prices.
You can always edit everything by hand.

**Can I change prices during service?** Yes — edit, press Publish, and guests see
the new price on their next scan, worldwide, within moments.

**How does delivery pricing work?** Per ZIP code: each area you deliver to has its
own fee, minimum order, and optional "free delivery from €X". Guests pick their ZIP
from your list, so wrong-area orders can't happen.

**Can guests order for later?** Yes — pickup and delivery orders can be scheduled
for later the same day, only within your opening hours.

**Where is my data?** In the EU, isolated per restaurant at the database level.

**What does it cost to take online payments?** Online payments arrive with the
Scale plan (€149/month) and carry a 1.5% platform fee per transaction; money goes to
your own Stripe account. *(Launching soon.)*

**Can I use my own branding?** Yes — logo, wide top banner, theme, texture, and the
browser tab even shows *your* icon, not ours.

---

## 7. Voice & terminology glossary

Use these exact terms everywhere (site, dashboard, support):

| Term | Meaning | Avoid |
|---|---|---|
| **Starter / Growth / Scale** | the three plans | "Basic/Pro/Premium" |
| **Dine-in / Pickup / Delivery** | the three order modes | "Takeout" (use Pickup) |
| **Publish** | make the draft live for guests | "Save" (saving ≠ live) |
| **Menu** | what guests see | "Catalogue" |
| **Delivery area** | one ZIP row with fee/minimum | "Zone" |
| **Planned for HH:MM** | scheduled order time | "Requested" |
| **Open/Closed badge** | live hours status on the menu | — |
| **Kitchen display** | the live order board | "KDS" (too jargony for site) |

Tone: plain, confident, restaurant-first. Speak to the owner ("your menu", "your
guests"). German market first — every example should feel at home in Konstanz, not
California.

---

## 8. What NOT to claim (honesty guardrails)

- ❌ **Online payments are live.** They are built and tested behind a feature gate,
  but until Stripe Connect is enabled in production, the website must say
  **"launching soon"** on the Scale plan.
- ❌ **Automatic menu translation.** The menu *displays* in the restaurant's chosen
  language and guests can switch between the venue's *enabled* languages, but dish
  text is not auto-translated. (Browsers offer their own translation; don't market
  it as ours.)
- ❌ **Multi-day pre-orders.** Scheduling is same-day only.
- ❌ **Marketplace/discovery.** Guesto is each restaurant's own menu, not a portal
  guests browse. Don't imply guest traffic comes from us.
- ❌ **POS integration, table reservations, loyalty programs** — not built.
- ❌ Uptime/SLA percentages — no public SLA yet.
- ⚠️ Payment brand logos (Visa etc.) appear as standard acceptance marks on guest
  menus; on our own marketing site follow each brand's usage guidelines.

---

## 9. Suggested homepage structure (from the above)

1. **Hero:** "Your menu, scanned in seconds." — QR menu mock + Open badge. CTA:
   *Start free — 30 days, no card.*
2. **Speed proof:** loads-before-the-water claim + the budget numbers.
3. **Three ways to get your menu in** (photo AI / template / by hand) — this is the
   strongest differentiator for non-technical owners.
4. **Ordering** — dine-in, pickup, delivery with per-ZIP pricing; scheduled orders;
   kitchen display with chime.
5. **Make it yours** — banner hero, themes, side rail, your icon in the guest's
   browser tab.
6. **Compliance & trust** — EU-14 allergens, EU hosting, database-level isolation.
7. **Pricing table** (Section 3) with the reverse-trial explainer.
8. **FAQ** (Section 6).

---

*Maintained alongside the codebase — update this file whenever a feature ships or a
number changes. Last verified against the product on 2026-07-17.*
