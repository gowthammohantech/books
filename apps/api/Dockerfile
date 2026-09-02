# syntax=docker/dockerfile:1.7
#
# Build context is the REPOSITORY ROOT, not this directory — see
# docker/docker-compose.yml. npm workspaces keep a single lockfile at the root,
# so the context has to include it for `npm ci` to be reproducible.

# --- Production dependencies --------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /repo
# Prisma 5.x requires libssl + libc6-compat on alpine to load its binary engine
RUN apk add --no-cache openssl libc6-compat
# Manifests first, so a source-only change reuses this layer. Every workspace
# manifest is needed: npm resolves the whole tree even when installing one.
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/validation/package.json packages/validation/
COPY packages/enums/package.json packages/enums/
COPY packages/money/package.json packages/money/
RUN npm ci --workspace=@elixirbooks/api --workspace=@elixirbooks/validation --workspace=@elixirbooks/enums --workspace=@elixirbooks/money --include-workspace-root --omit=dev \
      --no-audit --no-fund --loglevel=warn

# --- Dev dependencies ---------------------------------------------------------
# Targeted by docker/docker-compose.override.yml for the hot-reload flow, and
# used by the build stage below. It differs from `deps` only in keeping
# devDependencies — which is where typescript, ts-node and nodemon now live.
FROM deps AS dev-deps
WORKDIR /repo
RUN npm ci --workspace=@elixirbooks/api --workspace=@elixirbooks/validation --workspace=@elixirbooks/enums --workspace=@elixirbooks/money --include-workspace-root \
      --no-audit --no-fund --loglevel=warn

# --- Compile ------------------------------------------------------------------
FROM dev-deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
# Only the ESM marker script — the shared packages' build invokes it. The rest
# of scripts/ is dev-only and excluded by .dockerignore.
COPY scripts/write-esm-package-marker.mjs scripts/
COPY packages packages
COPY apps/api apps/api
# Shared packages first — apps/api imports their built output, not their source.
# enums before money: money imports the enums build output, not its source.
RUN npm run build --workspace=@elixirbooks/enums \
 && npm run build --workspace=@elixirbooks/money \
 && npm run build --workspace=@elixirbooks/validation
# The Prisma client has to exist before tsc: the generated types are what most
# of the source is checked against.
RUN npm run prisma:generate --workspace=@elixirbooks/api \
 && npm run build --workspace=@elixirbooks/api

# --- Runtime ------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /repo/apps/api
ENV NODE_ENV=production
ENV PORT=3001

RUN apk add --no-cache openssl libc6-compat
RUN addgroup -S app && adduser -S app -G app

# Production dependency tree only — no typescript, no ts-node.
COPY --from=deps /repo/node_modules /repo/node_modules
COPY --from=deps /repo/package.json /repo/package-lock.json /repo/.npmrc /repo/
COPY --from=deps /repo/apps/api/package.json /repo/apps/api/package.json
# Workspace packages are symlinked into node_modules, so their built output has
# to be present at the path the symlink points to.
COPY --from=build --chown=app:app /repo/packages/validation/package.json /repo/packages/validation/package.json
COPY --from=build --chown=app:app /repo/packages/validation/dist /repo/packages/validation/dist
COPY --from=build --chown=app:app /repo/packages/enums/package.json /repo/packages/enums/package.json
COPY --from=build --chown=app:app /repo/packages/enums/dist /repo/packages/enums/dist
COPY --from=build --chown=app:app /repo/packages/money/package.json /repo/packages/money/package.json
COPY --from=build --chown=app:app /repo/packages/money/dist /repo/packages/money/dist

# Compiled output, plus the two things it reads at runtime: the Prisma schema
# and migrations (the entrypoint and boot bootstrap run `migrate deploy`), and
# the bundled geo dataset the boot import reads.
COPY --from=build --chown=app:app /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build --chown=app:app /repo/apps/api/prisma/schema.prisma /repo/apps/api/prisma/schema.prisma
COPY --from=build --chown=app:app /repo/apps/api/prisma/migrations /repo/apps/api/prisma/migrations
COPY --from=build --chown=app:app /repo/apps/api/prisma/data /repo/apps/api/prisma/data
COPY --chown=app:app apps/api/docker-entrypoint.sh /repo/apps/api/docker-entrypoint.sh

# Regenerate the client against the production tree. Its default output is the
# hoisted root node_modules, which is why that whole tree is copied above.
RUN npx prisma generate

RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

USER app
EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/healthz || exit 1

ENTRYPOINT ["/repo/apps/api/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
