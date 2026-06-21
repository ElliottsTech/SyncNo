#!/usr/bin/env bash
# SyncNo daily DR backup.
# Snapshots live SQLite via online backup API, uploads to restic repo
# (SharePoint via rclone), applies 14-day retention, verifies repo.
#
# Safe to run while backend is online. Stages DB snapshot in tmpfs to
# avoid filling the host disk (root partition is near-full).
#
# Requires /root/SyncNo/.backup.env (see .backup.env.example).

set -euo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-/root/SyncNo/.backup.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE missing. See .backup.env.example." >&2
  exit 2
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY not set in $ENV_FILE}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE not set in $ENV_FILE}"

STAGE_DIR="${BACKUP_STAGE_DIR:-/mnt/backup-stage}"
DB_SRC="${SYNCNO_DB:-/root/SyncNo/backend/data/syncro.db}"
ATTACH_DIR="${SYNCNO_ATTACHMENTS:-/root/SyncNo/backend/data/attachments}"
ENV_ROOT="${SYNCNO_ROOT:-/root/SyncNo}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

if [[ ! -f "$DB_SRC" ]]; then
  log "ERROR: DB not found at $DB_SRC"
  exit 2
fi

mkdir -p "$STAGE_DIR"
if ! mountpoint -q "$STAGE_DIR"; then
  log "WARN: $STAGE_DIR not a mountpoint (expected tmpfs) — proceeding anyway"
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
SNAP="$STAGE_DIR/syncro-${TS}.db"

log "snapshotting $DB_SRC -> $SNAP"
sqlite3 "$DB_SRC" ".backup '${SNAP}'"

log "verifying snapshot integrity"
INTEGRITY="$(sqlite3 "$SNAP" "PRAGMA integrity_check;" 2>&1)"
if [[ "$INTEGRITY" != "ok" ]]; then
  log "ERROR: snapshot integrity check failed: $INTEGRITY"
  rm -f "$SNAP"
  exit 3
fi
SNAP_SIZE="$(du -h "$SNAP" | cut -f1)"
log "snapshot ok ($SNAP_SIZE)"

ENV_FILES=()
for f in "$ENV_ROOT/.env" \
         "$ENV_ROOT/backend/.env" \
         "$ENV_ROOT/frontend/.env" \
         "$ENV_ROOT/frontend/.env.local"; do
  [[ -f "$f" ]] && ENV_FILES+=("$f")
done

BACKUP_TARGETS=("$SNAP" "$ATTACH_DIR" "${ENV_FILES[@]}")

log "restic backup -> $RESTIC_REPOSITORY"
restic backup \
  --tag syncno \
  --tag "host=$(hostname -s)" \
  --tag "ts=$TS" \
  "${BACKUP_TARGETS[@]}"

log "forget: keep-daily=$KEEP_DAILY, prune"
restic forget --keep-daily "$KEEP_DAILY" --prune

log "check"
restic check

rm -f "$SNAP"
log "done"
