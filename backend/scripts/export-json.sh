#!/usr/bin/env bash
# On-demand JSON export of every SyncNo entity endpoint.
# Hits /api/<entity> with Bearer SYNCNO_API_KEY, paginates page/limit,
# writes one JSON file per entity under <out>/<entity>.json containing
# the merged data array across all pages.
#
# Usage:
#   ./export-json.sh                           # -> backend/data/json_export/<ts>/
#   ./export-json.sh --out /tmp/exp            # custom destination
#   ./export-json.sh --include-in-backup       # also restic backup the export
#   ./export-json.sh --api http://host:3001    # custom backend URL
#   ./export-json.sh --entity customers        # only one entity

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_OUT="$PROJECT_ROOT/backend/data/json_export"

API_URL="${SYNCNO_API_URL:-http://localhost:3001}"
API_KEY="${SYNCNO_API_KEY:-}"
OUT=""
INCLUDE_IN_BACKUP=0
ENTITIES_FILTER=()
PAGE_SIZE="${EXPORT_PAGE_SIZE:-1000}"

usage() {
  cat <<EOF
Usage: $0 [options]
  --out PATH            Output directory (default: $DEFAULT_OUT/<ts>/)
  --api URL             Backend URL (default: $API_URL)
  --key KEY             SYNCNO_API_KEY (else read from env or backend/.env)
  --entity NAME         Only export this entity (repeatable)
  --page-size N         Per-page limit (default: $PAGE_SIZE)
  --include-in-backup   After export, restic backup the output dir
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --api) API_URL="$2"; shift 2 ;;
    --key) API_KEY="$2"; shift 2 ;;
    --entity) ENTITIES_FILTER+=("$2"); shift 2 ;;
    --page-size) PAGE_SIZE="$2"; shift 2 ;;
    --include-in-backup) INCLUDE_IN_BACKUP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

# Fall back to backend/.env for SYNCNO_API_KEY
if [[ -z "$API_KEY" && -f "$PROJECT_ROOT/backend/.env" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$PROJECT_ROOT/backend/.env"; set +a
fi
if [[ -z "$API_KEY" ]]; then
  echo "ERROR: SYNCNO_API_KEY not set (env or backend/.env)" >&2
  exit 2
fi

# Entity -> API path. Most match dir name; PO uses hyphen.
declare -a ENTITIES=(
  appointments
  appointment_types
  contacts
  contracts
  customers
  estimates
  invoices
  items
  leads
  payments
  policy_folders
  portal_users
  products
  purchase_orders
  schedules
  syncro_users
  tickets
  vendors
  wiki_pages
)
declare -A API_PATH=(
  [purchase_orders]=purchase-orders
)

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT:-$DEFAULT_OUT/$TS}"
mkdir -p "$OUT"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

# Health check
health="$(curl -fsS -H "Authorization: Bearer $API_KEY" "$API_URL/api/health" 2>/dev/null || true)"
if [[ -z "$health" ]]; then
  log "ERROR: backend not reachable at $API_URL/api/health"
  exit 3
fi
log "backend healthy: $API_URL"

want() {
  local e="$1"
  if [[ ${#ENTITIES_FILTER[@]} -eq 0 ]]; then return 0; fi
  for f in "${ENTITIES_FILTER[@]}"; do [[ "$f" == "$e" ]] && return 0; done
  return 1
}

total_records=0
failures=0

for entity in "${ENTITIES[@]}"; do
  if ! want "$entity"; then continue; fi
  path="${API_PATH[$entity]:-$entity}"
  out_file="$OUT/${entity}.json"
  page=1
  merged='[]'
  entity_total=0

  while :; do
    url="$API_URL/api/${path}?page=${page}&limit=${PAGE_SIZE}"
    resp="$(curl -fsS \
      -H "Authorization: Bearer $API_KEY" \
      -H "Accept: application/json" \
      "$url")" || {
      log "  FAIL $entity (page $page)"
      failures=$((failures+1))
      break
    }
    # Extract data + pagination.total via python (always present on box for node tooling)
    parsed="$(python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
data=d.get("data") if isinstance(d,dict) else d
if data is None: data=[]
pag=(d.get("pagination") or {}) if isinstance(d,dict) else {}
print(json.dumps(data))
print(pag.get("total", len(data)))
' <<<"$resp" 2>/dev/null)" || {
      log "  FAIL $entity (parse page $page)"
      failures=$((failures+1))
      break
    }
    page_data="$(sed -n '1p' <<<"$parsed")"
    page_total="$(sed -n '2p' <<<"$parsed")"
    merged="$(python3 -c '
import json,sys
a=json.loads(sys.argv[1]); b=json.loads(sys.argv[2])
print(json.dumps(a+b))
' "$merged" "$page_data")"
    entity_total="${page_total:-$entity_total}"
    count_page="$(python3 -c 'import json,sys;print(len(json.loads(sys.argv[1])))' "$page_data")"
    [[ "$count_page" -lt "$PAGE_SIZE" ]] && break
    page=$((page+1))
    # Safety cap — 10000 pages would be 10M records
    [[ "$page" -gt 10000 ]] && break
  done

  printf '%s' "$merged" >"$out_file"
  count="$(python3 -c 'import json,sys;print(len(json.loads(sys.argv[1])))' "$merged")"
  total_records=$((total_records+count))
  log "  $entity: $count records -> $out_file"
done

log "export complete: $total_records records, $failures failures -> $OUT"

if [[ "$INCLUDE_IN_BACKUP" -eq 1 ]]; then
  if ! command -v restic >/dev/null; then
    log "restic not installed — skipping backup include"; exit 0
  fi
  ENV_FILE="${BACKUP_ENV_FILE:-$PROJECT_ROOT/.backup.env}"
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  log "restic backup $OUT"
  restic backup --tag syncno --tag json-export --tag "ts=$TS" "$OUT"
fi
