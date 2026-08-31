# syntax=docker/dockerfile:1.7
#
# Build context is the REPOSITORY ROOT, not this directory — see
# docker/docker-compose.yml. npm workspaces keep a single lockfile at the root,
# so the context has to include it for `npm ci` to be reproducible.

FROM node:20-alpine AS deps
WORKDIR /repo
# Prisma 5.x requires libssl + libc6-compat on alpine to load its binary engine
RUN apk add --no-cache openssl libc6-compat
# Manifests first, so a source-only change reuses this layer. Every workspace
# manifest is needed: npm resolves the whole tree even when installing one.
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# `npm ci` (not install) is now possible: the single root lockfile replaced the
# two app lockfiles that had drifted out of sync with their package.json.
RUN npm ci --workspace=@elixirbooks/api --include-workspace-root --omit=dev \
      --no-audit --no-fund --loglevel=warn

# --- Dev dependencies --------------------------------------------------------
# Targeted by docker/docker-compose.override.yml for the hot-reload flow. It
# differs from `deps` only in keeping devDependencies, which is what nodemon
# lives in — under `deps` (--omit=dev) `npx nodemon` would fetch it from the
# network on every container start. This stage is also what keeps `make up-dev`
# working once Phase 4 moves typescript/ts-node into devDependencies.
FROM deps AS dev-deps
WORKDIR /repo
RUN npm ci --workspace=@elixirbooks/api --include-workspace-root \
      --no-audit --no-fund --loglevel=warn

FROM node:20-alpine AS runner
WORKDIR /repo/apps/api
ENV NODE_ENV=production
ENV PORT=3001
# ts-node transpiles at runtime and does not type-check. Type safety is
# enforced by `npm run typecheck` in CI. Phase 4 replaces this with a compiled
# dist/ and drops ts-node from the runtime entirely.
ENV TS_NODE_TRANSPILE_ONLY=true

RUN apk add --no-cache openssl libc6-compat
RUN addgroup -S app && adduser -S app -G app

# Take the whole installed tree from deps: npm hoists to /repo/node_modules but
# may still nest a copy under apps/api/node_modules when versions conflict, and
# a COPY of a path that does not exist is a hard build failure. Copying /repo
# wholesale is correct either way.
COPY --from=deps /repo /repo
# Overlay the application source. The root .dockerignore excludes node_modules,
# so this cannot clobber what the deps stage installed.
COPY --chown=app:app apps/api /repo/apps/api

# Generate the Prisma client. Its default output is the hoisted root
# node_modules, which is why that whole tree is copied above.
RUN npx prisma generate

# uploads must exist and be writable by the app user (compose mounts a volume
# here). Subdirectories are needed by the multer-based controllers.
RUN mkdir -p /repo/apps/api/uploads/products /repo/apps/api/uploads/company \
    && chown -R app:app /repo/apps/api/uploads

RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

USER app
EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/healthz || exit 1

ENTRYPOINT ["/repo/apps/api/docker-entrypoint.sh"]
CMD ["node", "-r", "ts-node/register", "server.ts"]
