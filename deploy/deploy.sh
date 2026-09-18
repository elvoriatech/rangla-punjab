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
#   ./deploy/deploy.sh owner     make the restaurant owner's /dashboard login
#                                match OWNER_EMAIL / OWNER_PASSWORD in prod.env
#                                (seed only creates it once; this resets it)
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
    # Stamp the commit into the image so /admin/system can answer "what is
    # actually running". `|| echo unknown` because the deploy box is a
    # deployment target: git may refuse the checkout over ownership, and a
    # missing SHA must not abort a release.
    GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    IMAGE="${APP_IMAGE:-rangla-app:latest}"
    echo "→ building ${IMAGE} from ${GIT_SHA} at ${BUILD_TIME}"

    # The brand vars are build-time (Next inlines NEXT_PUBLIC_* into the
    # client bundles), so they have to be passed here rather than in the
    # container environment — change the brand and you must rebuild.
    docker build \
      --build-arg NEXT_PUBLIC_APP_BRAND_NAME="${NEXT_PUBLIC_APP_BRAND_NAME:-Rangla Punjab}" \
      --build-arg NEXT_PUBLIC_APP_BRAND_TAGLINE="${NEXT_PUBLIC_APP_BRAND_TAGLINE:-}" \
      --build-arg GIT_SHA="${GIT_SHA}" \
      --build-arg BUILD_TIME="${BUILD_TIME}" \
      -t "${IMAGE}" .

    # Second tag keyed on the commit, so `docker images` is a deploy history
    # and a rollback is `APP_IMAGE=rangla-app:<sha> ./deploy/deploy.sh up`
    # rather than a rebuild of an older checkout.
    if [ "${GIT_SHA}" != "unknown" ]; then
      docker tag "${IMAGE}" "${IMAGE%%:*}:${GIT_SHA}"
      echo "→ also tagged ${IMAGE%%:*}:${GIT_SHA}"
    fi
    ;;
  migrate)
    # Gate first: refuses destructive migration shapes.
    pnpm exec tsx scripts/check-migrations.ts
    DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
      pnpm prisma migrate deploy
    ;;
  up)
    # Live logs UI (Dozzle) is opt-in: with DOZZLE_PASSWORD_SHA256 in
    # prod.env we materialise its users file (gitignored) and switch the
    # `logs` compose profile on. Password hash, never the password:
    #   printf '%s' 'the-password' | shasum -a 256 | cut -d' ' -f1
    # Default login = the /admin credentials (user "admin", ADMIN_PASSWORD),
    # so the logs UI is on from the first deploy; DOZZLE_* override it.
    if [ -z "${DOZZLE_PASSWORD_SHA256:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
      DOZZLE_PASSWORD_SHA256="$(printf '%s' "${ADMIN_PASSWORD}" | sha256sum | cut -d' ' -f1)"
      DOZZLE_USER="${DOZZLE_USER:-admin}"
    fi
    if [ -n "${DOZZLE_PASSWORD_SHA256:-}" ]; then
      DOZZLE_USER="${DOZZLE_USER:-owner}"
      # Written under the deploy user's HOME, not into the checkout: the
      # repo tree may be root-owned from an earlier manual clone, and a
      # failed write here must never abort a release. The compose file
      # mounts whatever DOZZLE_USERS_FILE points at.
      DOZZLE_USERS_DIR="${HOME:-/tmp}/.config/rangla"
      mkdir -p "${DOZZLE_USERS_DIR}"
      DOZZLE_USERS_FILE="${DOZZLE_USERS_DIR}/dozzle-users.yml"
      cat > "${DOZZLE_USERS_FILE}" <<DOZZLE_USERS
users:
  ${DOZZLE_USER}:
    name: "${DOZZLE_USER}"
    password: "${DOZZLE_PASSWORD_SHA256}"
    email: "logs@${APP_DOMAIN:-localhost}"
DOZZLE_USERS
      chmod 600 "${DOZZLE_USERS_FILE}"
      export DOZZLE_USERS_FILE
      export COMPOSE_PROFILES="${COMPOSE_PROFILES:+${COMPOSE_PROFILES},}logs"
    fi
    "${COMPOSE[@]}" up -d
    # The Caddyfile is a bind mount: a changed route (e.g. /logs) is on disk
    # but Caddy keeps serving the config it loaded at start until told.
    # Graceful reload, zero downtime; harmless when nothing changed.
    "${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
      || echo "! caddy reload skipped (container not running yet?)"
    "${COMPOSE[@]}" ps
    # Report what is now serving, read from the running container rather than
    # from the checkout — those disagree exactly when it matters, e.g. after a
    # build that silently failed and left the previous image up.
    echo "→ running: $("${COMPOSE[@]}" exec -T app sh -c 'echo "${GIT_SHA:-unknown} built ${BUILD_TIME:-unknown}"' 2>/dev/null || echo 'unknown (app not answering)')"
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
  owner)
    [ -n "${OWNER_EMAIL:-}" ] && [ -n "${OWNER_PASSWORD:-}" ] || {
      echo "set OWNER_EMAIL and OWNER_PASSWORD in prod.env first"; exit 1; }
    DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
    APP_DATABASE_URL="postgresql://${DB_OWNER_USER:-resto_user}:${DB_OWNER_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-resto_database}?schema=public" \
      pnpm exec tsx scripts/set-owner-login.ts
    ;;
  release)
    "$0" build
    "$0" migrate
    "$0" seed
    "$0" up
    echo "Released. Now run the smoke test — docs/DEPLOY.md §9."
    ;;
  *)
    echo "usage: $0 {build|migrate|up|seed|owner|release}"; exit 1
    ;;
esac
