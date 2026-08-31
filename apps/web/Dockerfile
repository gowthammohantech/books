# syntax=docker/dockerfile:1.7
#
# Build context is the REPOSITORY ROOT, not this directory — see
# docker/docker-compose.yml. npm workspaces keep a single lockfile at the root,
# so the context has to include it for `npm ci` to be reproducible.

# --- Build stage -------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /repo

# Manifests first so a source-only change reuses the install layer.
COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/validation/package.json packages/validation/
# --legacy-peer-deps now comes from the root .npmrc (React 19 peer ranges),
# and `npm ci` replaces `npm install` because there is one lockfile again.
RUN npm ci --workspace=@elixirbooks/web --workspace=@elixirbooks/validation --include-workspace-root \
      --no-audit --no-fund --loglevel=warn

COPY tsconfig.base.json ./
COPY scripts scripts
COPY packages packages
COPY apps/web apps/web
# Shared packages first — the SPA imports their built ESM output.
RUN npm run build --workspace=@elixirbooks/validation

# Build args passed from docker-compose (or the shell env) override .env at
# build time. Changing any ARG busts this layer, so rebuilds pick up config.
#
# VITE_API_BASE_URL has NO default on purpose. It used to default to a specific
# Azure App Service hostname, so a plain `docker build` silently baked that
# third party's URL into the bundle. Empty means same-origin, which is what the
# nginx /api proxy in front of this image serves.
ARG VITE_DEMO_MODE=false
ARG VITE_API_BASE_URL=
RUN VITE_DEMO_MODE=$VITE_DEMO_MODE VITE_API_BASE_URL=$VITE_API_BASE_URL \
      npm run build --workspace=@elixirbooks/web

# --- Serve stage -------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

COPY apps/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

# Exec form so signals propagate
CMD ["nginx", "-g", "daemon off;"]
