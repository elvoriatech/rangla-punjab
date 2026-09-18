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
terminal. Then start Metro:

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
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Deployment-wide Stripe; unset ⇒ the built-in fake provider, so dev never charges a card |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enables "Sign in with Google" for guests; unset ⇒ email sign-up only |

### Logos and images

| Asset | Where |
| --- | --- |
| Restaurant logo & banner | Dashboard → **Settings** (uploads, no deploy) |
| Category and dish photos | Dashboard → **Menu** (tap a category's photo circle; dish photos in the item editor) — **JPEG/PNG/WebP only**, iPhone HEIC is rejected |
| Menu theme, texture, colours | Dashboard → **Appearance** |
| App name, icon, splash, palette | `pnpm brand:mobile --venue <slug>` (reads the venue's logo + menu theme), then rebuild |
| Web favicon / PWA icons | `public/brand/` |

### Payments

- **Stripe** — the restaurant pastes its own secret + webhook signing key in
  Dashboard → **Payments**; money settles straight to its bank.
- **PayPal** — same page: Client ID, Secret, Webhook ID, Sandbox/Live, enable.
  Falls back to the `PAYPAL_*` env vars when unset.
- Webhook endpoints to register with the provider:
  - Stripe: `https://<domain>/api/stripe/own-webhook` (event
    `checkout.session.completed`), paste the signing secret in the dashboard.
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
