# syntax=docker/dockerfile:1.7

# --- Build stage -------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps (use install, not ci, because the lockfile is currently
# out of sync with package.json -- regenerate the lockfile upstream and
# switch this to `npm ci` later).
COPY package.json package-lock.json* ./
# --legacy-peer-deps because react-helmet-async (and a few others) haven't
# updated their peer deps for React 19 yet. Safe in practice; replace once
# upstream catches up.
RUN npm install --no-audit --no-fund --loglevel=warn --legacy-peer-deps

# Copy source
COPY . .

# Build args passed from docker-compose (or the shell env) override .env at build time.
# Changing any ARG value busts this cache layer, so rebuilds always pick up config changes.
ARG VITE_DEMO_MODE=false
ARG VITE_API_BASE_URL=
RUN VITE_DEMO_MODE=$VITE_DEMO_MODE VITE_API_BASE_URL=$VITE_API_BASE_URL npm run build

# --- Serve stage -------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Replace default nginx config with our SPA + /api proxy config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

# Use exec form so signals propagate
CMD ["nginx", "-g", "daemon off;"]
