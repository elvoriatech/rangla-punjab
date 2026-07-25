# White-label: selling resto to a client

**resto** is one codebase, **many deploys**. Each restaurant customer gets:

- Their own VPS (or host) + `prod.env` (never committed)
- Their domain, brand, menu, and Stripe
- Your operator access via `/admin` (fee mode, templates, support tools)

Git holds **placeholders only** (`operator@example.com`, `resto_user`, `demo-restaurant`). Real names and passwords live on the server in `prod.env`.

## New client workflow

1. Clone `zwebapps/resto` on the app VPS (or your CI builds the image).
2. Copy `deploy/prod.env.template` → `prod.env` and set:
   - `NEXT_PUBLIC_APP_BRAND_NAME` — product name in UI/emails (can match restaurant or your agency)
   - `RESTAURANT_NAME`, `RESTAURANT_SLUG`, `OWNER_*` — the client's business
   - `ADMIN_*` — your platform login for this deploy
   - `APP_URL` / `APP_DOMAIN` — client's menu URL
3. Provision Postgres (`resto_database`, `resto_user`) on DB VPS — [`deploy/db-server-setup.md`](../deploy/db-server-setup.md).
4. `./deploy/deploy.sh release`
5. Hand off: owner logs in at `/login` with `OWNER_EMAIL` / `OWNER_PASSWORD`; they use `/dashboard`. You use `/admin`.

## What stays the same in every sale

- Codebase and Docker image
- Menu template catalogue (edited from `/admin/templates`)
- Operator fee model (upfront vs % in `/admin/settings`)

## What changes per client

| Item | Where |
|------|--------|
| Restaurant name, dishes, logo | DB + `/dashboard` |
| Domain & TLS | DNS + `APP_DOMAIN` |
| Guest-facing brand in shell | `NEXT_PUBLIC_APP_BRAND_NAME` |
| Client's Stripe Connect | `/dashboard/billing` |
| Your platform Stripe / commission | `/admin/settings` |

## Local dev defaults

Seeds use **Demo Restaurant** / `demo-restaurant` / `owner@example.com` unless env overrides — safe for demos, not a real client.

See also: [DEPLOY-IONOS-VPS.md](DEPLOY-IONOS-VPS.md).
