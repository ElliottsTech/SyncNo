#!/usr/bin/env bash
# SyncNo manual update script.
#
# Pulls latest from origin/main, rebuilds containers, restarts, and
# health-checks. On failure, prints manual rollback instructions including
# the previous SHA. Does NOT auto-rollback — admin decides.
#
# Usage: sudo REPO_DIR=/opt/syncno ./scripts/update.sh
# Env:
#   REPO_DIR                Repo checkout (default /opt/syncno)
#   HEALTH_URL              Health endpoint (default http://localhost:3001/api/health)
#   HEALTH_TIMEOUT_SEC      How long to wait post-restart (default 90)
#   HEALTH_POLL_INTERVAL_SEC  Poll cadence (default 2)
#   BRANCH                  Branch to pull (default main)

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/syncno}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3001/api/health}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-90}"
HEALTH_POLL_INTERVAL_SEC="${HEALTH_POLL_INTERVAL_SEC:-2}"
BRANCH="${BRANCH:-main}"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

fail() {
  local phase="$1"
  echo "============================================================" >&2
  echo "UPDATE FAILED at phase: ${phase}" >&2
  echo >&2
  echo "To roll back manually:" >&2
  echo "  cd ${REPO_DIR}" >&2
  echo "  git reset --hard ${PREV_SHA:-<previous-sha>}" >&2
  echo "  docker compose build" >&2
  echo "  docker compose up -d" >&2
  echo >&2
  echo "Then verify: curl ${HEALTH_URL}" >&2
  echo "Logs: docker compose logs --tail=100" >&2
  echo "============================================================" >&2
  exit 1
}

cd "${REPO_DIR}"

log "Pre-flight"
PREV_SHA="$(git rev-parse --short HEAD)"
log "Current SHA: ${PREV_SHA}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: uncommitted changes in ${REPO_DIR}. Commit or stash before updating." >&2
  git status --short >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon not responsive. Is the service running?" >&2
  exit 1
fi

log "Fetching origin/${BRANCH}"
git fetch origin "${BRANCH}"

NEW_SHA="$(git rev-parse --short "origin/${BRANCH}")"
if [[ "${NEW_SHA}" == "${PREV_SHA}" ]]; then
  log "Already up to date at ${PREV_SHA}. Nothing to do."
  exit 0
fi

log "Updating: ${PREV_SHA} → ${NEW_SHA}"
if ! git pull --ff-only origin "${BRANCH}"; then
  fail "pull"
fi

log "Building containers"
if ! docker compose build; then
  fail "build"
fi

log "Restarting containers"
if ! docker compose up -d; then
  fail "restart"
fi

log "Health check — polling ${HEALTH_URL} for up to ${HEALTH_TIMEOUT_SEC}s"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
healthy=false
while [[ $(date +%s) -lt ${deadline} ]]; do
  if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep "${HEALTH_POLL_INTERVAL_SEC}"
done

if [[ "${healthy}" != "true" ]]; then
  fail "health-check"
fi

# Record deploy SHA so the backend can read it if git isn't available inside
# the container (e.g. when .git isn't mounted read-only into backend).
echo "${NEW_SHA}" > "${REPO_DIR}/.deploy-sha"

log "Update complete: ${PREV_SHA} → ${NEW_SHA}. Services healthy."
