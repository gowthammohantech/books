# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
# Prisma 5.x requires libssl + libc6-compat on alpine to load its binary engine
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json* ./
# npm install (not ci) because the committed package-lock.json is currently
# out of sync with package.json. Switch back to `npm ci` once the lockfile
# is regenerated upstream.
RUN npm install --omit=dev --no-audit --no-fund --loglevel=warn

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# ts-node should transpile-only at runtime (no type-checking). Compile-time
# type safety is enforced via `npm run typecheck` before push.
ENV TS_NODE_TRANSPILE_ONLY=true

# Prisma 5.x runtime dependency
RUN apk add --no-cache openssl libc6-compat

# Non-root user
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:app . .

# Generate the Prisma client now that prisma/schema.prisma is in place.
# Runs as root before USER switch so generated files write to node_modules.
RUN npx prisma generate

# uploads dir must exist and be writable by the app user (compose mounts a volume here).
# Subdirectories needed by various multer-based controllers: products, company.
RUN mkdir -p /app/uploads/products /app/uploads/company && chown -R app:app /app/uploads

# Entrypoint runs `prisma migrate deploy` (+ idempotent seed) before the server,
# so deploys/updates apply schema changes automatically.
RUN chmod +x /app/docker-entrypoint.sh

USER app

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/healthz || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
