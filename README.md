# resto — white-label single-restaurant ordering (one deploy per client)

Deploy **resto** for each client: own VPS, domain, `prod.env`, and Stripe. No
tenant names or real credentials belong in git — only placeholders in
`deploy/prod.env.template` and docs.

One codebase serves three surfaces against the same database:

| Surface | What it is | Runs on |
| --- | --- | --- |
| **Web** | Guest menu + ordering, owner dashboard, kitchen screen, `/admin` console | Next.js on `:3000` |
| **iOS / Android app** | Same menu, cart, orders, reservations, account | Expo (React Native), Metro on `:8082` |
| **Kitchen / print** | 80 mm ticket, auto-print, wall screen | Web routes (`/kitchen`, `/print/order/:id`) |

---

## 1. Prerequisites

- **Node 22+** and **pnpm** (`corepack enable`)
- **Docker** — Postgres, Redis and MailHog run in containers
- For the apps: **Xcode** (iOS Simulator) and/or **Android Studio** (an AVD).
  Expo Go must be installed on the simulator/emulator — `expo start` installs
  it on first launch.

---

## 2. Start the backing services

Postgres, Redis and MailHog. Ports are the ones `.env` expects:

```bash
docker run -d --name rangla-postgres -p 5434:5432 -v rangla-punjab-resturant_pgdata:/var/lib/postgresql/data postgres:16-alpine postgres -c shared_preload_libraries=pg_stat_statements
```

```bash
docker run -d --name rangla-redis -p 6380:6379 redis:7-alpine
```

```bash
docker run -d --name rangla-mailhog -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

Already created once? Just start them again:

```bash
docker start rangla-postgres rangla-redis rangla-mailhog
```

- **MailHog UI:** <http://localhost:8025> — every outgoing email lands here in
  dev (verification, password reset, receipts). Nothing reaches real inboxes.

---

## 3. Set up the app

```bash
pnpm install
```

```bash
cp .env.example .env
```

Fill in `.env` (see §7 for the white-label values), then apply migrations and
generate the Prisma client:

```bash
pnpm exec prisma migrate deploy && pnpm exec prisma generate
```

Seed the restaurant — **in this order**, because each step builds on the last:

```bash
pnpm exec tsx --env-file=.env scripts/seed-menu-templates.ts
```

```bash
pnpm exec tsx --env-file=.env scripts/seed-restaurant.ts
```

```bash
pnpm exec tsx --env-file=.env scripts/seed-platform-admin.ts
```

Optional — publish the full 187-dish menu with its photography instead of the
18-dish starter template:

```bash
pnpm exec tsx --env-file=.env scripts/seed-rangla-menu.ts
```

> Idempotent: it no-ops when the live menu already matches. Add
> `FORCE_MENU_PUBLISH=1` to publish a fresh version anyway.

---

## 4. Run the web app

```bash
pnpm dev
```

| URL | What |
| --- | --- |
| <http://localhost:3000> | **Guest menu** — browse, order, reserve a table |
| <http://localhost:3000/dashboard> | **Owner dashboard** — orders, reservations, menu editor, appearance, QR codes, settings, payments |
| <http://localhost:3000/kitchen> | **Kitchen screen** — leave a tablet on this page |
| <http://localhost:3000/admin> | **Operator console** — restaurants, templates, backups, audit |
| <http://localhost:8025> | **MailHog** — captured emails |

**Logins** come from `.env`: `OWNER_EMAIL` / `OWNER_PASSWORD` for the
dashboard, `ADMIN_EMAIL` / `ADMIN_PASSWORD` for `/admin`. They're different
accounts — an admin has no restaurant, so `/admin` credentials can't open
`/dashboard`.

---

## 5. Run the mobile apps

The apps talk to the web app, so **keep `pnpm dev` running** in another
terminal.

The app is white-label — its name, deep-link scheme, store ids, icon, splash,
hero artwork and palette are all generated from a venue's row, so brand it
once before starting Metro (and again whenever that venue's logo or menu theme
changes):

```bash
pnpm brand:mobile --venue rangla-punjab
```

Add `--dry-run` to see the palette, its contrast table and the files it would
write without touching anything; `pnpm brand:mobile --help` lists every flag.
Details in [mobile/BUILDS.md](mobile/BUILDS.md). Then start Metro:

```bash
cd mobile && npx expo start --port 8082
```

**iOS Simulator** — boot a device in Xcode, then:

```bash
xcrun simctl openurl booted "exp://127.0.0.1:8082"
```

**Android emulator** — start an AVD, then map the port and launch. Android
can't see the Mac's `localhost`, so either the reverse tunnel below or
`10.0.2.2` is required:

```bash
adb reverse tcp:8082 tcp:8082 && adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8082"
```

**Web preview of the app** (fastest for layout checks):

```bash
cd mobile && npx expo start --web --port 8082
```

### How the app finds the API

`mobile/src/api.ts` picks the base URL in this order:

1. `EXPO_PUBLIC_API_URL` if set (baked in at **build** time — an installed
   app can't be re-pointed later)
2. `http://10.0.2.2:3000` on Android (the emulator's route to the host)
3. `http://localhost:3000` on iOS

To test against a **real phone** on your LAN, set the Mac's IP in
`mobile/eas.json` (`preview` profile) or export it before starting Metro:

```bash
EXPO_PUBLIC_API_URL="http://192.168.1.50:3000" npx expo start --port 8082
```

### Installable builds

APK / IPA are built in the cloud with EAS (free Expo account; iOS device
installs need an Apple Developer account). Set `EXPO_PUBLIC_API_URL` in
`mobile/eas.json` **first** — see [mobile/BUILDS.md](mobile/BUILDS.md):

```bash
cd mobile && npx eas-cli build -p android --profile preview
```

### Paying in the app (card, Google Pay, PayPal)

The guest picks the payment method on the cart screen, then taps **Pay**.

| Method | What opens | Needs |
| --- | --- | --- |
| Card / Google Pay | Stripe's native payment sheet inside the app (3-D Secure handled in the sheet) | a native build + `STRIPE_PUBLISHABLE_KEY` on the server |
| PayPal | The web pay page in an in-app browser tab; PayPal hands off to its own app when installed | PayPal keys (env or Dashboard → Payments) |
| Cash | Nothing; the kitchen ticket goes out at once | `cash` in the venue's accepted payments |

The order is created first with the chosen intent, and the kitchen ticket and
receipt email for card and PayPal orders only go out once the webhook confirms
payment. Closing the app after paying is safe.

**Keys.** The server hands the app the publishable key together with the
PaymentIntent, so swapping `pk_test_` for `pk_live_` in `prod.env` (or in
Dashboard → Payments, next to the secret key) takes effect on every installed
app without a store release. Test and live use the same code path.

**Without Stripe keys** (local dev, CI) the fake provider runs and the app shows
a **Simulate payment (test)** button in place of the sheet. **In Expo Go** the
native Stripe module is not linked, so the app falls back to Stripe's hosted
checkout page in an in-app browser tab. **Apple Pay** is deliberately not wired
up yet; the human steps are listed in [mobile/BUILDS.md](mobile/BUILDS.md).

### Google sign-in in the app (one-tap)

Guests can sign in or register with one tap on **Continue with Google**
(Welcome, Account and Checkout screens). The app uses the native Google SDK
(`@react-native-google-signin/google-signin`), gets an ID token, and posts it
to `POST /api/auth/customer/google`, which verifies it against Google's keys
and upserts the customer. The first tap creates the account.

Nothing here is required to run the app. **Without credentials the button
still works** — it falls back to the browser device-code flow, and Expo Go
always uses that fallback because the native module is not linked there.
One-tap needs a **native build** (EAS or `expo run:*`) plus the setup below.

**1. Create three OAuth clients** in one Google Cloud project
(APIs & Services → Credentials → Create credentials → OAuth client ID):

| Type | Fill in | Gives you |
| --- | --- | --- |
| **Web application** | Authorised redirect URI `https://<domain>/api/auth/customer/callback` | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (server) and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (app) |
| **iOS** | Bundle ID `com.elvoria.ranglapunjab` (from `mobile/brand.generated.json`) | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` |
| **Android** | Package `com.elvoria.ranglapunjab` + the release **SHA-1** from `cd mobile && npx eas-cli credentials -p android` | `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` |

Android verifies the app by package + SHA-1 and signs in with the **web**
client id, so the web client is the one that must not be skipped. For a
debug build add its debug-keystore SHA-1 to the same Android client.

**2. Put the ids in the app build** — `mobile/eas.json`, every profile that
should have one-tap (they are `""` placeholders today):

```json
"env": {
  "EXPO_PUBLIC_API_URL": "https://rangla-punjab-restaurant.de",
  "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "1234-web.apps.googleusercontent.com",
  "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID": "1234-ios.apps.googleusercontent.com",
  "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID": "1234-android.apps.googleusercontent.com"
}
```

They are baked in at build time; an installed app cannot pick them up later.
`mobile/app.config.js` registers the iOS URL scheme (the reversed client id)
only when the iOS id is set, so a build without it still compiles.

**3. Tell the server which tokens to accept** — in `prod.env` (see
[deploy/prod.env.template](deploy/prod.env.template)), then
`./deploy/deploy.sh up`:

```bash
GOOGLE_CLIENT_ID=1234-web.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_MOBILE_CLIENT_IDS=1234-ios.apps.googleusercontent.com,1234-android.apps.googleusercontent.com
```

The endpoint accepts only ID tokens whose audience is one of these ids and
answers `503` when none is set, which makes the app fall back to the browser
flow.

**4. Rebuild and install:**

```bash
cd mobile && npx eas-cli build -p android --profile preview
```

Checks: the button shows the Google account chooser instead of opening a
browser; the server log shows `POST /api/auth/customer/google 200`.
Common failures: `DEVELOPER_ERROR` on Android means the SHA-1 or package on
the Android client does not match the build that is installed; a `401` from
the server means the token's client id is missing from
`GOOGLE_MOBILE_CLIENT_IDS`. More detail in
[mobile/BUILDS.md](mobile/BUILDS.md).

---

## 6. Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Web app with hot reload |
| `pnpm build` / `pnpm start` | Production build and serve |
| `pnpm test` | Vitest (unit + integration; needs Postgres up) |
| `pnpm test:axe` | Playwright accessibility gate on the guest menu |
| `pnpm lint` · `pnpm exec tsc --noEmit` | Lint · typecheck |
| `cd mobile && npx tsc --noEmit` | Typecheck the app |
| `pnpm db:studio` | Prisma Studio — browse the database |
| `pnpm worker` | Background worker (menu imports) |
| `pnpm purge:test-tenants` | Drop `t-<hex>` fixture tenants the suite leaves behind (dry run; add `--apply`) |

> `pnpm test` runs against the real Postgres in `.env`. It cleans up its own
> fixture tenants on exit — confirm `DATABASE_URL` points at **localhost**
> before running it.

---

## 7. Rebranding for a new restaurant

Everything below is data or config — no code changes.

### `.env` values

| Variable | Effect |
| --- | --- |
| `NEXT_PUBLIC_APP_BRAND_NAME` | Product name in page titles, emails, footer |
| `NEXT_PUBLIC_APP_BRAND_TAGLINE` | Tagline under the name |
| `RESTAURANT_NAME`, `RESTAURANT_SLUG` | The venue the seed creates |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | Dashboard login |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `/admin` login |
| `APP_URL` | Public origin — **QR codes encode this**, set it before printing |
| `DATABASE_URL`, `APP_DATABASE_URL` | Postgres (migration + app roles) |
| `REDIS_URL` | Rate limits, job queue |
| `SESSION_SECRET` | Signs session and receipt tokens |
| `EMAIL_TRANSPORT` | `mailhog` (dev) · `resend` (prod, needs `RESEND_API_KEY`) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`, `PAYPAL_WEBHOOK_ID` | Deployment-wide PayPal (a restaurant can instead enter its own in the dashboard) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | The restaurant's Stripe account (guests are charged on it directly) unless keys are pasted in Dashboard → Payments; unset ⇒ the built-in fake provider, so dev never charges a card |
| `STRIPE_PUBLISHABLE_KEY` | `pk_…` for the app's native payment sheet; public, not a secret. Served to the app at runtime, so test → live needs no rebuild |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enables "Sign in with Google" for guests; unset ⇒ email sign-up only |
| `GOOGLE_MOBILE_CLIENT_IDS` | Comma-separated iOS + Android OAuth client ids the app's one-tap ID tokens may carry; unset ⇒ only `GOOGLE_CLIENT_ID` is accepted (see §5, Google sign-in in the app) |

### Logos and images

| Asset | Where |
| --- | --- |
| Restaurant logo & banner | Dashboard → **Settings** (uploads, no deploy) |
| Category and dish photos | Dashboard → **Menu** (tap a category's photo circle; dish photos in the item editor) — **JPEG/PNG/WebP only**, iPhone HEIC is rejected |
| Menu theme, texture, colours | Dashboard → **Appearance** |
| App name, icon, splash, palette | `pnpm brand:mobile --venue <slug>` (reads the venue's logo + menu theme), then rebuild |
| Web favicon / PWA icons | `public/brand/` |

### Payments

- **Stripe** — either set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in
  `prod.env` (then `./deploy/deploy.sh up` to restart with them), or paste
  the secret + webhook signing key in Dashboard → **Payments**. Either way the
  guest is charged on the restaurant's own account; money settles straight
  to its bank.
- **PayPal** — same page: Client ID, Secret, Webhook ID, Sandbox/Live, enable.
  Falls back to the `PAYPAL_*` env vars when unset.
- Webhook endpoints to register with the provider:
  - Stripe: `https://<domain>/api/stripe/webhook` (events
    `checkout.session.completed` for the website and `payment_intent.succeeded`
    for the app's payment sheet). Its signing secret is `STRIPE_WEBHOOK_SECRET`
    in `prod.env`, or — if you use dashboard keys — paste it in Dashboard →
    Payments and register `/api/stripe/own-webhook` instead. Both URLs settle
    orders; only the secret they are verified with differs.
  - PayPal: `https://<domain>/api/paypal/webhook` (events
    `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`), paste the Webhook
    ID in the dashboard. The guest's return to `/api/paypal/return` also
    captures, but only the webhook settles an order when the guest closes
    the tab after approving.

---

## 8. Docs

- **White-label / reselling:** [docs/WHITE-LABEL.md](docs/WHITE-LABEL.md)
- **IONOS VPS deploy:** [docs/DEPLOY-IONOS-VPS.md](docs/DEPLOY-IONOS-VPS.md)
- **General production:** [docs/DEPLOY.md](docs/DEPLOY.md)
- **Database VPS:** [deploy/db-server-setup.md](deploy/db-server-setup.md)
- **Mobile builds:** [mobile/BUILDS.md](mobile/BUILDS.md)
- **Product spec / roadmap / backlog:** [ELVORIA_MENU_SPEC.md](ELVORIA_MENU_SPEC.md) ·
  [ELVORIA_ROADMAP.md](ELVORIA_ROADMAP.md) · [BACKLOG.md](BACKLOG.md)

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Menu is empty, or 500s mentioning Prisma | Postgres container isn't running (`docker start rangla-postgres`) or the DB was never seeded — see §3 |
| Server errors right after a schema change | The dev server caches the Prisma client; restart `pnpm dev` after `prisma generate` |
| App shows "Keine Verbindung zur Küche" | `pnpm dev` isn't running, or the app can't reach the API — check §5 |
| Android app: "Cannot connect to Expo CLI" | Re-run `adb reverse tcp:8082 tcp:8082`, then relaunch |
| App still shows old data after a code change | Fast Refresh keeps state; cold-restart with `xcrun simctl terminate booted host.exp.Exponent` then re-open the `exp://` URL |
| Uploaded dish photo silently missing | It was rejected — use JPEG/PNG/WebP under 10 MB (iPhone HEIC isn't supported). The editor now shows the reason |
| `/admin` 404s while signed in as the owner | Different account — sign in with `ADMIN_EMAIL` |
