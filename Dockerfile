# syntax=docker/dockerfile:1.7

# Multi-stage image for the Next.js app.
#
# Layout mirrors the Next standalone output contract: the runtime image only
# needs `.next/standalone` (server + traced node_modules), `.next/static`, and
# `public/`. Everything else (source, lockfile, dev deps) stays in earlier
# stages and is discarded.

# ---------- Base ----------
FROM node:22-alpine AS base
WORKDIR /app
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1
# pnpm is pinned via the `packageManager` field in package.json; corepack picks
# up that exact version so builds are reproducible across machines.
RUN corepack enable

# ---------- Dependencies ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The prisma schema is needed if `pnpm install` triggers `prisma generate` via
# a postinstall hook. Even without one, copying it keeps this stage self-
# contained for future postinstall changes.
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---------- Builder ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client before `next build` so the tracer bundles the
# generated files into `.next/standalone/node_modules`. `prisma.config.ts`
# resolves DATABASE_URL at config-load (used by migrate); generate itself
# never opens a connection, so a placeholder URL satisfies the loader.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" \
    pnpm exec prisma generate

# Next INLINES every NEXT_PUBLIC_* value into the client bundles at
# compile time, so these cannot come from prod.env at runtime the way
# APP_URL does. Without them the two client components that read the
# brand (the /admin sidebar and the /dashboard rail) render the "Resto"
# fallback while every server-rendered page shows the real name.
# deploy.sh passes these through from prod.env.
ARG NEXT_PUBLIC_APP_BRAND_NAME="Rangla Punjab"
ARG NEXT_PUBLIC_APP_BRAND_TAGLINE=""
ENV NEXT_PUBLIC_APP_BRAND_NAME=$NEXT_PUBLIC_APP_BRAND_NAME \
    NEXT_PUBLIC_APP_BRAND_TAGLINE=$NEXT_PUBLIC_APP_BRAND_TAGLINE

# Placeholders so `next build` can evaluate the env schema while it
# collects page data. `.dockerignore` excludes .env (correctly — secrets
# must not enter an image layer), so without these the build dies on
# "APP_DATABASE_URL is not set" and the production image cannot be built
# at all. Nothing here reaches the running container: these are build
# stage only, the runner gets real values from prod.env, and only
# NEXT_PUBLIC_* values are ever inlined into output — SESSION_SECRET is
# read server-side at runtime, so this dummy is never baked in.
RUN APP_DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" \
    DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" \
    REDIS_URL="redis://127.0.0.1:6379" \
    SESSION_SECRET="build-placeholder-not-a-secret-000000000000" \
    pnpm build

# ---------- Runner ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Least-privilege runtime user. Using fixed IDs (1001) so k8s SecurityContext
# and volume ownership stay predictable across environments.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Resized-variant cache (src/lib/image-cache.ts). Created here with the
# right owner: /app is root-owned, so the app could not mkdir it at
# runtime, and a compose volume mounted over it inherits this ownership.
RUN mkdir -p /app/.image-cache && chown nextjs:nodejs /app/.image-cache

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/" || exit 1

CMD ["node", "server.js"]
