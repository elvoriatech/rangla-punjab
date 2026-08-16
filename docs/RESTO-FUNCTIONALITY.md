# Rangla Punjab — Functionality inventory (web + mobile)

Status as of 2026-08-16, after the branding/lifecycle/mobile build.
✅ built & tested · ⛔ human go-live step · ☐ open

## Guest — web (`/`)
- ✅ Branded menu at the domain root: Rangla Royal theme (red/cream/gold), logo header,
  full-page background artwork, readable split-surface cards, heading pill
- ✅ Categories + diet filter tabs (URL-driven, works without JS), allergen dialog, spice/dietary badges
- ✅ Locale routes `/{locale}` with translation overlay; per-venue PWA manifest; JSON-LD
- ✅ Cart (localStorage island) → dine-in / pickup / delivery with per-type fields, ZIP areas, fees
- ✅ Order placement (server re-priced, rate-limited, kill-switch aware) + receipt PDF
- ✅ **Order tracking page** `/order-status/{id}?token=` — Bestätigt → Zubereitung → Fertig
  (→ Unterwegs) → Serviert/Geliefert, auto-refresh, zero JS
- ✅ Online payment rails (Stripe Connect / own-keys) — code complete; ⛔ live keys + Connect KYC
- ✅ Legal pages (MDX), sitemap, image resizing, zero-cookie public surface

## Guest — mobile app (`mobile/`, Expo)
- ✅ Start: brand header, artwork hero, Lieferung/Abholung entry, category medallions, popular dishes
- ✅ Kategorien browser with chips; add-to-cart everywhere
- ✅ Warenkorb + Kasse: qty steppers, order-type chips, per-type fields, totals, friendly errors
- ✅ Bestellung verfolgen: live step tracker (10 s poll of `/api/v1/orders/{id}/status`), receipt PDF
- ✅ Bestellungen: device-local history (receipt tokens in storage — no accounts, by design)
- ✅ Info: hours, brand hero, web/legal links
- ☐ Pay-online button in-app (opens hosted checkout in browser sheet) — blocked only by ⛔ live Stripe
- ☐ Push notifications; EAS builds + store submission (client's Apple/Google accounts) ⛔
- Deliberately absent: login/accounts, loyalty points (needs a customer-identity backend that
  contradicts the shipped no-account design — separate decision if ever wanted)

## Staff / owner
- ✅ Orders dashboard + kitchen board with **lifecycle buttons** (Start preparing → Ready →
  Out for delivery → Done), status chips, auto-print, chime, wake lock
- ✅ Menu editor (draft → publish), templates, appearance page with **13 themes incl. Rangla Royal,
  4 textures, 5 background artworks, heading-color picker**
- ✅ Settings, delivery areas, QR pack, billing (support plan + Connect + own keys)
- ✅ Operator `/admin`: fee knobs, kill switch, encrypted Stripe keys, provisioning, templates,
  announcements, audit, runbooks

## APIs (mobile contract, versioned)
- ✅ `GET /api/v1/menu` — menu + ordering config, absolute image URLs, integer cents, CORS
- ✅ `GET /api/v1/orders/{id}/status` — token-authorized tracking, tolerant-client rules, CORS
- ✅ `POST /api/orders` (+ CORS) — placement; `POST /api/orders/{id}/pay` — hosted checkout

## Quality gates (this machine)
- ✅ 448/448 vitest (serial; the suite is parallel-flaky on many-core machines — pre-existing),
  incl. new `order-status` lifecycle tests and extended WCAG theme guards
- ✅ `tsc --noEmit` web + mobile · ✅ eslint (mobile excluded — own toolchain)
- ✅ E2E verified in browser: web order → kitchen advance → live tracker; mobile order #0002 →
  DB advance → tracker updated on poll

## Go-live (unchanged, human)
- ⛔ P6-2 VPS + DNS · ⛔ P6-3 live Stripe keys + Connect onboarding + €0.50 smoke
- ⛔ ROTATE the live Stripe key that was sitting in `.env` (preserved in `.env.cloud.bak-20260815`)
