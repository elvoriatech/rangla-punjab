# Plan — Spanish / Italian / Arabic for guests + one-tap Google on mobile

Date: 2026-09-18. Architecture by the reviewing agent; implementation split across
five parallel Opus agents with disjoint file ownership; review + commit by the architect.

## What we found (survey summary)

- `src/lib/venue-service.ts` already lists `es`, `it`, `ar` as venue locales; routing,
  hreflang, sitemap and CDN purge all work for them. The gap is **guest copy**, **RTL**,
  **content translations**, and **mobile**.
- Guest UI chrome on the website has **no message catalogue** — ~180 strings hardcoded as
  English, German, or `de ? … : …` ternaries across `src/app/(public)/**`, `order-status`,
  `pay`, `src/emails/**`, `src/lib/receipt-pdf.ts`. The locale list exists in **four**
  hand-maintained copies (`venue-service.ts`, `app/layout.tsx`, `next.config.ts`,
  `menu-view.tsx LOCALE_META`) plus a **divergent** two-locale list in `allergens.ts`.
- **RTL does not exist** (no `dir=`, no `I18nManager`), despite the CLAUDE.md decision.
- Owners **cannot enter dish translations** (no dashboard UI writes `Translation`), and
  `publishDraft` (`menu-versions-service.ts`) re-creates rows with new ids **without
  copying `Translation` rows** — translations are orphaned on every publish.
- Mobile `i18n.tsx` is a hand-rolled `de|en` dictionary; German is forced regardless of
  device locale; persistence guard rejects unknown codes; allergen labels live in a
  second dictionary in `dish-sheet.tsx`; no RTL.
- Google sign-in exists only as a **browser-hop + 3s poll** device-code flow and is
  **off in prod** (no `GOOGLE_CLIENT_ID/SECRET`). Registration is already an upsert in
  `signInCustomer()`. Nothing flows from the profile to checkout: `Customer.phone` is
  dead, there is no address storage, `/api/v1/me` returns `{email,name}` only, no
  `PATCH /api/v1/me`, and neither `CartScreen.tsx` nor `cart-drawer.tsx` prefills.

## Decisions (architect)

1. **One locale registry**: `src/lib/locales.ts` (dependency-free). `LOCALES` with
   `{code,label,flag,dir,ui}`; `UiLocale = en|de|es|it|ar` = locales with a full
   guest-copy catalogue; `uiLocale(code)` collapses region tags and falls back to `en`;
   `dirFor/isRtl`; `LOCALE_PATH_PATTERN` for `next.config.ts`. `venue-service.ts`
   re-exports `SUPPORTED_LOCALES` from it so existing imports keep working.
2. **Catalogue shape**: no i18n runtime (CLAUDE.md). Per-namespace modules under
   `src/lib/i18n/`: `menu.ts` (menu chrome, diet labels, open/closed badge, allergen +
   reservation dialogs, metadata), `checkout.ts` (cart drawer + add button),
   `post-order.ts` (order-status + pay pages), `emails.ts` (receipt + new-order),
   `pdf.ts` (receipt PDF). Each exports `const X: Record<UiLocale, Shape>` where
   `Shape = typeof X.en` so TypeScript enforces completeness, and a `xCopy(locale)`
   accessor. Interpolation = small functions `(n) => string`, never template strings
   with positional markers.
3. **RTL on web**: `<html dir={dirFor(lang)}>` in `app/layout.tsx`; guest surfaces
   sweep physical → logical Tailwind utilities (`ms-/me-/ps-/pe-/start-/end-/text-start/
   text-end`, `rounded-s/e`); icons that imply direction (chevrons, "›") mirror via
   `rtl:` variant. Public pages stay zero-JS for this.
4. **Arabic receipt PDF**: `pdf-lib` StandardFonts can't render Arabic and `safe()` strips
   the glyphs. Decision: for `ar` the PDF uses the **English** catalogue (`uiLocale`
   fallback inside `receipt-pdf.ts`), documented as a known limitation; Arabic dish names
   in the PDF are already broken today and out of scope.
5. **Locale resolution on post-order pages** (`/order-status`, `/pay`, receipt PDF):
   `?locale=` query param when present and valid, else `order.venue.defaultLocale`.
   Emails/notifications use the venue default locale (owner language for the kitchen
   ticket, venue language for the guest receipt — unchanged rule, wider type).
6. **`/api/v1/menu?locale=`** validates against `enabledLocales`; unknown → venue default
   (not 404 — the app must never lose the menu over a stale preference); response echoes
   the effective locale.
7. **Content translations**: fix `publishDraft` to copy `Translation` rows onto the new
   snapshot ids (map old→new id per entity type); add a "Translations" section to the
   category editor (`dashboard/(console)/categories/[id]`) — per enabled non-default
   locale, name + description per item and name per category — saved via a new
   `translation-service.ts`. AI auto-translate is a follow-up, not in this change.
8. **Customer profile** (`prisma`): add `Customer.lastDeliveryAddress Json?`, wire the
   dead `phone` column, `GET /api/v1/me` returns `{id,email,name,phone,lastDeliveryAddress}`,
   add `PATCH /api/v1/me` (name, phone, lastDeliveryAddress; zod-validated, same shape as
   `Order.deliveryAddress`), and `placeOrder` back-fills name/phone/address onto the
   customer when `customerId` is set ("last used" semantics: overwrite). Migration via
   Prisma; customers table already carries `tenant_id` → RLS policy included.
9. **Google one-tap (mobile)**: `@react-native-google-signin/google-signin` behind
   `EXPO_PUBLIC_GOOGLE_{WEB,IOS,ANDROID}_CLIENT_ID`; when unset the app keeps today's
   browser flow, so nothing regresses without credentials. New backend
   `POST /api/auth/customer/google` `{ idToken }` → verify against Google JWKS
   (`iss`, `aud ∈ configured client ids`, `exp`), then `signInCustomer(tenantId,
   "google", {sub,email,name})` → `{ token, customer }`. Registration = the existing
   upsert. Token moves from AsyncStorage to `expo-secure-store`.
   ⛔ Human-gated: creating the Google Cloud OAuth clients (web/iOS/Android + Android
   SHA-1) and setting the env vars. Structural work ships with placeholders.
10. **Checkout prefill**: mobile `CartScreen` seeds empty fields from `auth.customer`
    (name, phone, email, street/zip/city/note from `lastDeliveryAddress`) and the
    server back-fills after each order. Web `cart-drawer` fetches `/api/v1/me` with
    `credentials:"include"` when the drawer opens (401 → nothing) — the public page
    stays static/edge-cached; the fetch is client-only and only when the guest opens
    the cart.
11. **Mobile locales**: `Lang = UiLocale` (5); `deviceDefault()` uses
    `expo-localization` matched against the venue's `enabledLocales` ∩ app catalogue,
    else venue default; picker is data-driven from the API's `enabledLocales`; the
    `dish-sheet.tsx` allergen dictionary folds into `i18n.tsx`; RTL via
    `I18nManager.allowRTL/forceRTL` + `expo-updates reloadAsync()` on switch, and a
    style sweep to `marginStart/End`, `paddingStart/End`, `start/end`, mirrored chevrons.

## Agent split (disjoint file ownership)

| Agent | Owns |
|---|---|
| A1 web-menu-i18n | `src/lib/i18n/menu.ts`, `src/app/(public)/**` except `order/**`, `app/layout.tsx`, `next.config.ts`, `venue-service.ts` (re-export only), `allergens.ts`, related tests, `e2e/axe-public-menu.spec.ts` |
| A2 web-checkout-i18n | `src/lib/i18n/{checkout,post-order,emails,pdf}.ts`, `src/app/(public)/order/**`, `src/app/order-status/**`, `src/app/pay/**`, `src/lib/order-status.ts`, `src/emails/{receipt,new-order}-email.tsx`, `receipt-email.ts`, `order-notification.ts`, `receipt-pdf.ts`, `api/orders/[id]/receipt/route.ts`, `api/v1/menu/route.ts`, related tests |
| B content-translations | `menu-versions-service.ts`, new `translation-service.ts`, `dashboard/(console)/categories/[id]/**`, related tests |
| C customer-profile-backend | `prisma/schema.prisma` + migration, `customer-auth.ts`, `api/v1/me/**`, new `api/auth/customer/google/route.ts`, `order-service.ts` (back-fill only), `env.ts`, `deploy/prod.env.template`, related tests |
| D mobile | `mobile/**` only |

Contracts between agents are the endpoint shapes in decisions 6, 8, 9 and the
`src/lib/locales.ts` module, which exists before any agent starts.

## Verification gates (architect)

`pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test` green at root; `cd mobile && npx tsc
--noEmit` green; render checks of `/es`, `/it`, `/ar` (dir=rtl) in the browser pane;
manual review of every diff before commit. Google credentials + a device build are
the only steps left to a human.
