#!/usr/bin/env bash
# resto — app-VPS deploy script (IONOS / Docker).
#
#   ./deploy/deploy.sh build     build the app image from the repo
#   ./deploy/deploy.sh migrate   run DB migrations (owner role, direct)
#   ./deploy/deploy.sh up        start / roll the stack
#   ./deploy/deploy.sh seed      platform admin + menu templates + default
#                                restaurant (idempotent — safe to re-run)
#   ./deploy/deploy.sh release   build → migrate → seed → up  (normal path;
#                                every deploy comes up with a default menu)
#
# Requires: prod.env next to the repo root (copy deploy/prod.env.template).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="prod.env"
COMPOSE=(docker compose -f deploy/docker-compose.prod.yml --env-file "$ENV_FILE")

[ -f "$ENV_FILE" ] || { echo "prod.env missing — copy deploy/prod.env.template and fill it in"; exit 1; }
set -a; source "$ENV_FILE"; set +a

case "${1:-}" in
  build)
    # The brand vars are build-time (Next inlines NEXT_PUBLIC_* into the
    # client bundles), so they have to be passed here rather than in the
    # container environment — change the brand and you must rebuild.
    docker build \
      --build-arg NEXT_PUBLIC_APP_BRAND_NAME="${NEXT_PUBLIC_APP_BRAND_NAME:-Rangla Punjab}" \
      --build-arg NEXT_PUBLIC_APP_BRAND_TAGLINE="${NEXT_PUBLIC_APP_BRAND_TAGLINE:-}" \
      -t "${APP_IMAGE:-resto-app:latest}" .
    ;;
  migrate)
    # Gate first: refuses destructive migration shapes.
    pnpm exec tsx scripts/check-migrations.ts
    DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
      pnpm prisma migrate deploy
    ;;
  up)
    "${COMPOSE[@]}" up -d
    "${COMPOSE[@]}" ps
    ;;
  seed)
    [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ] || {
      echo "set ADMIN_EMAIL and ADMIN_PASSWORD in the environment first"; exit 1; }
    DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
    APP_DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
      pnpm exec tsx scripts/seed-platform-admin.ts
    DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
    APP_DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
      pnpm exec tsx scripts/seed-menu-templates.ts
    # Provision the restaurant from a starter template → a PUBLISHED default
    # menu, so a fresh deploy is never a blank slate. No-op once the venue
    # (RESTAURANT_SLUG) already exists, so it is safe on every release.
    DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
    APP_DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
      pnpm exec tsx scripts/seed-restaurant.ts
    ;;
  release)
    "$0" build
    "$0" migrate
    "$0" seed
    "$0" up
    echo "Released. Now run the smoke test — docs/DEPLOY.md §9."
    ;;
  *)
    echo "usage: $0 {build|migrate|up|seed|release}"; exit 1
    ;;
esac
