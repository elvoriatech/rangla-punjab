# resto

Single-restaurant QR menu and online ordering (Rangla Punjab). Next.js app with owner dashboard, kitchen display, and operator `/admin` console.

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
