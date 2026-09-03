#!/usr/bin/env bash
#
# Capture every Products API response to disk, for byte-for-byte comparison
# across a refactor.
#
# Stage 3 of the refactor plan turns ProductController into
# controller/service/repository. The only convincing evidence that a rewrite of
# 877 lines preserved behaviour is the bytes on the wire, so this drives the
# real server over HTTP — through protect, requirePermission, the validators and
# the upload middleware — rather than calling handlers directly with a fake req.
#
# Usage:
#   scripts/captureGolden.sh before      # on the pre-refactor tree
#   scripts/captureGolden.sh after       # after
#   diff -ru /tmp/golden/before /tmp/golden/after
#
set -euo pipefail

LABEL="${1:?usage: captureGolden.sh <before|after>}"
OUT="/tmp/golden/${LABEL}"
PORT="${GOLDEN_PORT:-3099}"
DB="${DATABASE_URL:-postgresql://postgres@127.0.0.1:5433/elixirbooks_test}"
SECRET="${JWT_SECRET:-golden-test-secret}"

cd "$(dirname "$0")/.."
rm -rf "$OUT" && mkdir -p "$OUT"

echo "[golden] seeding fixture..."
TOKEN=$(JWT_SECRET="$SECRET" DATABASE_URL="$DB" npx ts-node prisma/goldenFixture.ts | grep '"token"' | sed 's/.*: "//; s/".*//')
[ -n "$TOKEN" ] || { echo "[golden] no token from fixture"; exit 1; }

# A server left over from an earlier run answers /healthz instantly, so the
# capture silently drives STALE CODE and the before/after diff comes out empty
# no matter what changed. That happened once and cost a wasted "after" run;
# refuse to start rather than produce a diff that proves nothing.
if curl -sf --noproxy '*' "http://127.0.0.1:$PORT/api/healthz" >/dev/null 2>&1; then
  echo "[golden] something is already serving :$PORT - refusing to capture against it."
  echo "[golden] kill it first, e.g.: ps aux | grep '[t]s-node server.ts'"
  exit 1
fi

echo "[golden] booting server on :$PORT..."
JWT_SECRET="$SECRET" DATABASE_URL="$DB" PORT="$PORT" \
  MIGRATE_ON_BOOT=false SEED_ON_BOOT=false BACKFILL_ON_BOOT=false GEO_ON_BOOT=false \
  npx ts-node server.ts > "$OUT/_server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -sf --noproxy '*' "http://127.0.0.1:$PORT/api/healthz" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf --noproxy '*' "http://127.0.0.1:$PORT/api/healthz" >/dev/null || {
  echo "[golden] server never became healthy"; tail -20 "$OUT/_server.log"; exit 1; }
kill -0 "$SERVER_PID" 2>/dev/null || {
  echo "[golden] our server exited but :$PORT still answers - a stale process owns it"; exit 1; }

# name  method  path
# Ordered so the mutating calls come last: the reads above them must see the
# fixture exactly as seeded.
capture() {
  local name="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o "$OUT/$name.json" -w '%{http_code}' -X "$method"
              -H "Authorization: Bearer $TOKEN" --noproxy '*')
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  local code
  code=$(curl "${args[@]}" "http://127.0.0.1:$PORT$path")
  echo "$code" > "$OUT/$name.status"
  printf '  %-42s %s %s\n' "$name" "$code" "$path"
}

echo "[golden] capturing..."
capture list-default        GET '/api/admin/products'
capture list-page2          GET '/api/admin/products?page=2&limit=5'
capture list-search         GET '/api/admin/products?search=widget'
capture list-search-none    GET '/api/admin/products?search=zzzznomatch'
capture list-filter-product GET '/api/admin/products?item_type=Product'
capture list-filter-service GET '/api/admin/products?item_type=Service'
capture list-limit-huge     GET '/api/admin/products?limit=100000'
capture list-page-zero      GET '/api/admin/products?page=0&limit=0'
capture byid-found          GET '/api/admin/products/golden-product-0000000000001'
capture byid-service        GET '/api/admin/products/golden-product-0000000000002'
capture byid-missing        GET '/api/admin/products/does-not-exist'
capture categories          GET '/api/admin/product-categories'
capture brands              GET '/api/admin/product-brands'
capture units               GET '/api/admin/product-units'
capture taxes               GET '/api/admin/product-taxes'
capture cost-layers         GET '/api/admin/inventory/cost-layers'

# Mutations last, and each one re-reads so the effect is captured too.
capture create-minimal      POST '/api/admin/products' '{"name":"Golden Created","unit":"golden-unit-000000000000001"}'
capture create-invalid      POST '/api/admin/products' '{}'
capture update-name         PUT  '/api/admin/products/golden-product-0000000000001' '{"name":"Widget Renamed"}'
capture byid-after-update   GET  '/api/admin/products/golden-product-0000000000001'
capture delete-ok           DELETE '/api/admin/products/golden-product-0000000000004'
capture delete-missing      DELETE '/api/admin/products/does-not-exist'
capture list-after-mutations GET '/api/admin/products?limit=100'

# --- quotations -------------------------------------------------------------
capture q-list              GET '/api/admin/quotations'
capture q-list-page2        GET '/api/admin/quotations?page=2&limit=2'
capture q-list-search       GET '/api/admin/quotations?search=QT-GOLDEN01'
capture q-byid              GET '/api/admin/quotations/golden-quotation-000000000001'
capture q-byid-missing      GET '/api/admin/quotations/does-not-exist'
# Cross-tenant probes: the golden token asking for the OTHER tenant's quotation.
capture q-byid-foreign      GET '/api/admin/quotations/golden-foreign-quotation-001'
capture q-customers-all     GET '/api/admin/customers-all'
capture q-customers-search  GET '/api/admin/customers-all?search=Customer'
capture q-customers-active  GET '/api/admin/customers-all?status=Active'
capture q-minimal           GET '/api/admin/quotations-minimal'
capture q-status-bad        PATCH '/api/admin/quotations-status/golden-quotation-000000000002' '{"status":"sent"}'
capture q-status            PATCH '/api/admin/quotations-status/golden-quotation-000000000002' '{"status":"accepted"}'
capture q-byid-after-status GET '/api/admin/quotations/golden-quotation-000000000002'
capture q-delete            DELETE '/api/admin/quotations/golden-quotation-000000000006'
capture q-delete-missing    DELETE '/api/admin/quotations/does-not-exist'
capture q-status-foreign    PATCH '/api/admin/quotations-status/golden-foreign-quotation-001' '{"status":"declined"}'
capture q-update-foreign    PUT '/api/admin/quotations/golden-foreign-quotation-001' '{"notes":"OVERWRITTEN BY ANOTHER TENANT"}'
capture q-delete-foreign    DELETE '/api/admin/quotations/golden-foreign-quotation-001'
capture q-list-after        GET '/api/admin/quotations?limit=100'

# Volatile fields would defeat a byte-for-byte diff. Ids generated by a create
# and timestamps written by one are normalised; everything else is compared as-is.
echo "[golden] normalising volatile fields..."
python3 - "$OUT" <<'PY'
import json, pathlib, re, sys
out = pathlib.Path(sys.argv[1])
UUID = re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.I)
TS = re.compile(r'\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\b')
CODE = re.compile(r'PROD-[A-Z0-9]{9}\b')          # generateUniqueProductCode
for f in sorted(out.glob('*.json')):
    raw = f.read_text()
    raw = UUID.sub('<uuid>', raw)
    raw = TS.sub('<ts>', raw)
    raw = CODE.sub('<generated-code>', raw)
    try:
        f.write_text(json.dumps(json.loads(raw), indent=2, sort_keys=True) + '\n')
    except json.JSONDecodeError:
        f.write_text(raw)  # keep non-JSON bodies verbatim
PY

rm -f "$OUT/_server.log"
echo "[golden] $(ls "$OUT"/*.json | wc -l) responses captured to $OUT"
