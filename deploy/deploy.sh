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
    # Live logs UI (Dozzle). Login = DOZZLE_USER / DOZZLE_PASSWORD from
    # prod.env, defaulting to user "admin" with ADMIN_PASSWORD, so it is on
    # from the first deploy. Dozzle ≥ v11 accepts only bcrypt hashes, so the
    # users file is produced by Dozzle's own generator (never hand-hashed).
    # Written under the deploy user's HOME, not into the checkout: the repo
    # tree may be root-owned from an earlier manual clone, and a failed
    # write here must never abort a release.
    DOZZLE_PASS="${DOZZLE_PASSWORD:-${ADMIN_PASSWORD:-}}"
    if [ -n "${DOZZLE_PASSWORD_SHA256:-}" ] && [ -z "${DOZZLE_PASSWORD:-}" ]; then
      echo "! DOZZLE_PASSWORD_SHA256 is no longer used (Dozzle v11 needs bcrypt) — set DOZZLE_PASSWORD instead; using ADMIN_PASSWORD for now"
    fi
    if [ -n "${DOZZLE_PASS}" ]; then
      DOZZLE_USER="${DOZZLE_USER:-admin}"
      DOZZLE_USERS_DIR="${HOME:-/tmp}/.config/rangla"
      mkdir -p "${DOZZLE_USERS_DIR}"
      DOZZLE_USERS_FILE="${DOZZLE_USERS_DIR}/dozzle-users.yml"
      if docker run --rm amir20/dozzle:latest generate \
           --name "${DOZZLE_USER}" --email "logs@${APP_DOMAIN:-localhost}" \
           --password "${DOZZLE_PASS}" "${DOZZLE_USER}" > "${DOZZLE_USERS_FILE}.tmp" 2>/dev/null \
         && [ -s "${DOZZLE_USERS_FILE}.tmp" ]; then
        mv "${DOZZLE_USERS_FILE}.tmp" "${DOZZLE_USERS_FILE}"
        chmod 600 "${DOZZLE_USERS_FILE}"
        export DOZZLE_USERS_FILE
        export COMPOSE_PROFILES="${COMPOSE_PROFILES:+${COMPOSE_PROFILES},}logs"
        echo "→ dozzle login: ${DOZZLE_USER} (users file ${DOZZLE_USERS_FILE})"
      else
        rm -f "${DOZZLE_USERS_FILE}.tmp"
        echo "! could not generate the dozzle users file — logs UI stays off this release"
      fi
    fi
    "${COMPOSE[@]}" up -d
    # The Caddyfile is a bind mount: a changed route (e.g. /logs) is on disk
    # but Caddy keeps serving the config it loaded at start until told.
    # Graceful reload, zero downtime; harmless when nothing changed.
    # …but a single-file bind mount pins the INODE: `git reset --hard`
    # writes a new Caddyfile, and the container keeps the old one, so the
    # reload would happily re-apply stale config. Compare what the container
    # sees with what is on disk and recreate caddy when they differ (a few
    # seconds of TLS downtime, only on releases that changed the Caddyfile).
    HOST_SUM="$(sha256sum deploy/Caddyfile | cut -d' ' -f1)"
    CONT_SUM="$("${COMPOSE[@]}" exec -T caddy sha256sum /etc/caddy/Caddyfile 2>/dev/null | cut -d' ' -f1 || true)"
    if [ "${HOST_SUM}" != "${CONT_SUM}" ]; then
      echo "→ Caddyfile changed on disk (container still has the old inode) — recreating caddy"
      "${COMPOSE[@]}" up -d --force-recreate --no-deps caddy
    elif "${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile; then
      echo "→ caddy reloaded (config unchanged or same file)"
    else
      echo "! caddy reload failed — recreating caddy"
      "${COMPOSE[@]}" up -d --force-recreate --no-deps caddy
    fi
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
