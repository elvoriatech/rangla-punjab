# resto — white-label single-restaurant ordering (one deploy per client).

Deploy **resto** for each client: own VPS, domain, `prod.env`, and Stripe. No tenant names or real credentials belong in git — only placeholders in `deploy/prod.env.template` and docs.

## Per-client checklist

| Step | What to set |
|------|-------------|
| Brand | `NEXT_PUBLIC_APP_BRAND_NAME` in `prod.env` |
| Domain | `APP_URL`, `APP_DOMAIN` (before QR codes) |
| Restaurant | `RESTAURANT_NAME`, `RESTAURANT_SLUG`, `OWNER_EMAIL`, `OWNER_PASSWORD` |
| Operator | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (your `/admin` login) |
| Database | `resto_database` / `resto_user` on DB VPS (see `deploy/db-server-setup.md`) |
| Email | Resend + `EMAIL_FROM` on client's domain |
| Payments | Stripe in `prod.env` or `/admin/settings` + owner Connect in `/dashboard/billing` |

## Docs

- **White-label / reselling:** [docs/WHITE-LABEL.md](docs/WHITE-LABEL.md)
- **IONOS VPS:** [docs/DEPLOY-IONOS-VPS.md](docs/DEPLOY-IONOS-VPS.md)
- **General prod:** [docs/DEPLOY.md](docs/DEPLOY.md)

## Local development

```bash
pnpm install
cp .env.example .env   # fill in Postgres, Redis, secrets
pnpm dev
```

See `.env.example` for the environment contract. Do not commit `.env`.

## Scripts

- `pnpm build` / `pnpm start` — production build
- `pnpm test` — Vitest
- `pnpm exec tsx scripts/seed-platform-admin.ts` — operator admin (set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in prod)
- `pnpm exec tsx scripts/seed-restaurant.ts` — restaurant + owner
