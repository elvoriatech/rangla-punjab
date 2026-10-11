# Rangla Punjab — handoff (state on 2026-10-11)

Start here if you are picking this project up. Everything below is the state at the end of the
2026-10-06 → 2026-10-11 working session.

## What this is

Single-restaurant ordering platform for **Rangla Punjab Restaurant, Konstanz** — web menu + ordering at
**https://rangla-punjab-restaurant.de**, owner dashboard at `/dashboard`, and an Expo (React Native) app in
`mobile/` for guests AND for the restaurant (staff/owner "restaurant mode"). Forked from the Guesto
multi-tenant SaaS (`~/Downloads/Work/elvoria-food`, repo zwebapps/guesto).

- Architecture: `docs/RESTO-ARCHITECTURE.md`, features: `docs/RESTO-FUNCTIONALITY.md`, deploy: `docs/DEPLOY-IONOS-VPS.md`.
- Commands: `pnpm install` · `pnpm dev` · `pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm test` (vitest, needs the local DB).
- Local stack: docker containers `rangla-postgres` (5434) + `rangla-redis` (6380); `docker start rangla-postgres rangla-redis elvoria-mailhog`.
- Preview configs in `.claude/launch.json`: `rangla-dev` (web, :58816) and `rangla-mobile-local` (Expo web, :8083, talks to the local server).

## Releasing

- **Push to `main` = CI + automatic production deploy** (app VPS 87.106.27.235). Commit/push per task unless the owner says "hold".
- **Android APK** (built locally, not on EAS cloud):
  `cd mobile && JAVA_HOME=$(/usr/libexec/java_home -v 23) ANDROID_HOME=~/Library/Android/sdk npx eas-cli build -p android --profile preview --local --non-interactive --output ~/Downloads/rangla-punjab-<date>-vNN.apk`
  then check (`aapt dump badging`, `apksigner verify --print-certs` → SHA-256 `e7cb6f5b…`) and publish:
  `gh release create android-vNN <apk renamed to rangla-punjab.apk> -R elvoriatech/rangla-punjab --target <full sha> --latest`.
  Stable download link: https://github.com/elvoriatech/rangla-punjab/releases/latest/download/rangla-punjab.apk
- **iOS**: archive with `xcodebuild … archive` from `mobile/ios` (set version with PlistBuddy in
  `ios/RanglaPunjabRestaurant/Info.plist`, export `APPLE_MERCHANT_ID=merchant.de.ranglapunjabrestaurant.app`),
  upload with `xcodebuild -exportArchive … -exportOptionsPlist ExportOptions.plist` (method app-store-connect,
  destination upload, team NFHFDX372C). Uploading needs the owner's explicit "upload".
  Install on the owner's iPhone 12 Pro: `xcrun devicectl device install app --device 93263F18-612C-5005-9128-529EC6C79F88 <app>`.
- **Bump the app version for every release** (`mobile/brand.generated.json` "version" + `mobile/package.json`).
  The app shows "Version x · <commit>" at the bottom of Konto and of the restaurant ☰ menu.

## Current versions

| Where | Version |
| --- | --- |
| Web / server | `main` @ `da8301b` (deployed) |
| Android | **v42 = 1.1.7** (GitHub release `android-v42`, Latest) |
| iOS | **1.1.5 (1)** uploaded to App Store Connect 2026-10-07 — owner still has to create the version, pick the build and submit. Earlier 1.1.2/1.1.3 were in review. |

## Done in this session (newest first)

- `da8301b` Team logins see only their ticked areas; each login has a home screen (board → reservations → catering → menu → settings → Konto); back arrows no longer land on a blank board.
- `3d53f7e` **Silent auto-print to a Bluetooth ESC/POS receipt printer (Android)**: local Expo module `mobile/modules/bt-printer` (SPP socket), server renders ESC/POS in `src/lib/ticket-escpos.ts` (`/api/v1/staff/orders/{id}/ticket?format=escpos&paper=58|80`), choice on the board ("Bluetooth-Drucker"). Board stays mounted behind other tabs so bell + auto-print keep running. **Not yet tested on the owner's real printer** (model unknown).
- `0bced2e` Version line in the app. `e1889ff` popups close on tap-outside. `ea1ce60` red ✕ cancel button.
- `f4915a8` Table/catering requests on the order board + calendar bubble/popup; new team box **"cancel"** (owner always may cancel; venue switch `appCancelEnabled` retired); louder bell + 4 selectable sounds + volume; keep-awake for the whole restaurant session; staff without "menu" see the menu read-only; **every dashboard menu save auto-publishes** (`src/lib/menu-autopublish.ts`, keeps 5 published versions, baskets with old item ids are mapped at checkout).
- `ee5a692` / `139216e` App: Reservations, Catering, Team, dish days + dine-in only, delete cancelled orders.
- `1d67a0e` Push with the restaurant bell (`new_order.wav`, Android channel `orders_bell`).
- `cc82aed` SEO fixes (robots sitemap URL, Restaurant JSON-LD, canonical). `e029c19` store badges.

## Open / waiting on the owner

- **Android push** needs Firebase: `mobile/google-services.json` (Android app `de.ranglapunjabrestaurant.app` in Firebase project `rangla-punjab-restaurant`) + FCM V1 key uploaded to Expo. iOS push works (APNs key R8A8545WL8 on Expo).
- **SEO** (off-site): Google Search Console + sitemap, Google Business Profile website field, old site www.rangla-punjab-konstanz.de, address in Dashboard → Settings → Contact.
- **iOS 1.1.5** submission in App Store Connect (keep the APPLE PAY section in review notes).
- Bluetooth printer: confirm on the real printer; adjust ESC/POS if characters/QR misprint.
- Uncommitted, unrelated local changes in the working tree (`.claude/*`, `CLAUDE.md`, `.gitignore`,
  `docs/architecture.md`, deleted `public/guesto-*`, `src/app/api/v1/pay/wallet-config/route.ts`,
  `docs/play-listing/`, `scripts/.mail-shot.mjs`, `scripts/send-test-email.ts`) — not part of this session's commits; leave them unless the owner says otherwise.

## Owner's next requests (2026-10-11, not started at handoff time)

1. Remove the separate sound row; put sound + auto-print together on one settings screen.
2. Orders: newest on top.
3. Owner can delete catering and table reservations.
4. Separate numbering for cash vs online (PayPal, Apple Pay, card) orders; Reports filterable by it, owner can delete entries before printing the final statement.
5. Order-total discount (e.g. 10 %), configurable by the owner in the app's settings, applied to the whole order.
6. Default 40 s accept window → auto-accept; print only after acceptance (or auto-accept); delivery/pickup time on both the customer and kitchen tickets.
