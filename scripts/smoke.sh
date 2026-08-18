#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose --env-file docker/.env -f docker/docker-compose.yml"
WEB_PORT="${WEB_PORT:-8080}"
TIMEOUT_SECS=90

echo "==> Bringing stack up (idempotent)"
make env >/dev/null
$COMPOSE up -d --build

echo "==> Waiting for /api/healthz on web:${WEB_PORT} (timeout ${TIMEOUT_SECS}s)"
deadline=$((SECONDS + TIMEOUT_SECS))
while true; do
  if curl -fsS "http://localhost:${WEB_PORT}/api/healthz" >/dev/null 2>&1; then
    echo "    api healthz: OK"
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "ERROR: api/healthz did not respond within ${TIMEOUT_SECS}s"
    echo "--- api logs (last 80) ---"
    $COMPOSE logs --tail=80 api || true
    echo "--- web logs (last 40) ---"
    $COMPOSE logs --tail=40 web || true
    exit 1
  fi
  sleep 2
done

echo "==> Checking nginx static fallback (/)"
status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${WEB_PORT}/")
if [[ "$status" != "200" ]]; then
  echo "ERROR: web root returned HTTP $status (expected 200)"
  exit 1
fi
echo "    web root:    OK ($status)"

echo "==> Checking /healthz on nginx itself"
status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${WEB_PORT}/healthz")
if [[ "$status" != "200" ]]; then
  echo "ERROR: nginx /healthz returned HTTP $status (expected 200)"
  exit 1
fi
echo "    nginx healthz: OK ($status)"

echo "==> Checking /api/healthz JSON payload"
body=$(curl -fsS "http://localhost:${WEB_PORT}/api/healthz")
echo "    payload: $body"
echo "$body" | grep -q '"status":"ok"'

echo "==> Scanning api logs for ERROR (last 200 lines)"
if $COMPOSE logs --tail=200 api 2>&1 | grep -E "^.*(ERROR|UnhandledPromiseRejection|Error: )" | grep -v "MongoDB connection failed" >/dev/null; then
  echo "WARN: api logs contain errors (review with 'make logs')"
fi

echo "==> All smoke checks passed."
