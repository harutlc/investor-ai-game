# syntax=docker/dockerfile:1

# Two images from one build: `--target api` (compiled Express API) and `--target web` (nginx serving the
# Vite build and proxying /api). docker-compose.yml builds both. The /app layout mirrors the repo, so the
# API finds its workspace root, config file and migrations exactly as it does outside a container.

# --- base: Node + the pnpm version pinned in package.json -------------------------------------------
FROM node:24-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# --- toolchain: compiles better-sqlite3 when no prebuilt binary fits; never reaches a runtime image --
FROM base AS toolchain
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# --- deps: every dependency, from manifests only, so source edits keep this layer cached ------------
FROM toolchain AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir /pnpm/store

# --- prod-deps: runtime dependencies of the API and @investor/shared only ---------------------------
FROM toolchain AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod --filter "@investor/api..." --store-dir /pnpm/store

# --- build: compile shared + api (tsc -b) ------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm build

# --- build-web: the Vite bundle. Its own stage, so the CSRF build arg never invalidates the API -----
FROM build AS build-web
# Must match the API's CSRF_ENABLED (compose passes the same .env value).
ARG VITE_CSRF_ENABLED=
ENV VITE_CSRF_ENABLED=${VITE_CSRF_ENABLED}
RUN pnpm build:web

# --- api ---------------------------------------------------------------------------------------------
FROM base AS api
ENV NODE_ENV=production
# Manifests + production node_modules (workspace symlinks included).
COPY --from=prod-deps /app ./
COPY config ./config
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
# The built API reads migrations from apps/api/src/db/migrations (see Database.ts).
COPY apps/api/src/db/migrations ./apps/api/src/db/migrations
# The data volume mounts here; creating it as `node` makes a fresh named volume writable by the app.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

# --- web ---------------------------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:stable-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-web /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
