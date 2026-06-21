# SyncNo Backup & Restore

## What's backed up

| Asset | Path | Note |
|---|---|---|
| SQLite DB | `backend/data/syncro.db` | 2.9GB. Snapshotted via `sqlite3 .backup` (online, consistent) |
| Attachments | `backend/data/attachments/` | Currently empty |
| Env files | `.env`, `backend/.env`, `frontend/.env`, `frontend/.env.local` | Contains API keys + secrets |

**Excluded**: CSV source (`/root/SyncNo/SyncNo/`) — DB is canonical.

Destination: SharePoint document library via rclone, encrypted with restic AES-256.
Retention: 14 daily snapshots, pruned automatically.

## Secret material (out-of-band)

These two files are **not** in the backup. Lose them, lose the backups:

- `/root/.restic-password` — restic repo encryption key
- `/root/.config/rclone/rclone.conf` — SharePoint SP credentials

Copy both to a password manager or offline storage immediately after creation.

## Schedule

- Timer: `syncno-backup.timer` fires daily at 03:30 (system TZ = Australia/Perth)
- Service: `syncno-backup.service` (oneshot)
- Random delay: up to 10 min to avoid herd
- `Persistent=true` catches missed runs after downtime

Status:
```bash
systemctl list-timers syncno-backup.timer
journalctl -u syncno-backup.service -n 200
```

## On-demand JSON export

Separate from the daily backup. Dumps every `/api/<entity>` to JSON.

```bash
cd /root/SyncNo
./backend/scripts/export-json.sh                          # default out
./backend/scripts/export-json.sh --out /tmp/exp           # custom path
./backend/scripts/export-json.sh --entity customers       # single entity
./backend/scripts/export-json.sh --include-in-backup      # also restic backup it
```

Output: `backend/data/json_export/<UTC-timestamp>/<entity>.json` (one file per entity, merged across pages).

## First-time setup (already done on this host)

These steps are complete. Recorded here for rebuild reference.

1. `apt install restic rclone sqlite3`
2. Mount tmpfs at `/mnt/backup-stage` (3G, mode 0700) — see `/etc/fstab`
3. Create Entra ID app registration with `Sites.Selected` or `Sites.ReadWrite.All`
4. `/root/.config/rclone/rclone.conf` — `[sharepoint]` remote (type=onedrive)
5. `openssl rand -base64 32 > /root/.restic-password && chmod 600 /root/.restic-password`
6. `cp .backup.env.example .backup.env` and edit
7. `restic -r rclone:sharepoint:/SyncNo-Backups/syncno init`
8. `systemctl enable --now syncno-backup.timer`
9. Test: `systemctl start syncno-backup.service` (watch `journalctl -u syncno-backup -f`)

## Restore runbook

### Prereqs on new host

```bash
apt install restic rclone sqlite3 docker.io docker-compose-plugin
```

### 1. Recover out-of-band secrets

Place into:
- `/root/.restic-password` (mode 600)
- `/root/.config/rclone/rclone.conf`

### 2. Verify access

```bash
source /root/SyncNo/.backup.env   # if .backup.env survived; else set env vars manually
restic snapshots
```

### 3. Restore latest snapshot

```bash
restic restore latest --target /tmp/restore
# or a specific one:
restic snapshots
restic restore <snapshot-id> --target /tmp/restore
```

### 4. Place files

```bash
# Stop backend first
cd /root/SyncNo && docker compose down

# DB (find the snapshotted db under the restored path)
LATEST_DB=$(find /tmp/restore -name 'syncro-*.db' | sort | tail -1)
cp "$LATEST_DB" /root/SyncNo/backend/data/syncro.db

# Env files
find /tmp/restore -name '.env' -path '*SyncNo*'   # review, then cp into place
find /tmp/restore -name '.env.local'

# Attachments
cp -r /tmp/restore/path/to/attachments/* /root/SyncNo/backend/data/attachments/ 2>/dev/null || true
```

### 5. Verify integrity before bringing backend up

```bash
sqlite3 /root/SyncNo/backend/data/syncro.db "PRAGMA integrity_check;"
# expected: ok

sqlite3 /root/SyncNo/backend/data/syncro.db "SELECT count(*) FROM customers;"
sqlite3 /root/SyncNo/backend/data/syncro.db "SELECT count(*) FROM tickets;"
sqlite3 /root/SyncNo/backend/data/syncro.db "SELECT count(*) FROM invoices;"
```

### 6. Restart backend

```bash
cd /root/SyncNo && docker compose up -d
curl -s http://localhost:3001/api/health
```

### 7. Spot-check UI

Log in, open a ticket, an invoice, an attachment. Confirm nothing 404s.

## Verification (run periodically)

Daily `restic check` is built into the backup script (metadata-only, fast).

Weekly deep check (recommended, not scheduled):
```bash
source /root/SyncNo/.backup.env
restic check --read-data       # downloads + verifies every pack
```

Restore drill (quarterly):
```bash
restic restore latest --target /tmp/drill --verify-data
sqlite3 /tmp/drill/<db-path>/syncro-*.db "PRAGMA integrity_check;"
diff <(sqlite3 /root/SyncNo/backend/data/syncro.db "SELECT count(*) FROM customers;") \
     <(sqlite3 /tmp/drill/<db-path>/syncro-*.db "SELECT count(*) FROM customers;")
```

## Troubleshooting

**`backup.sh` fails with "snapshot integrity_check failed"**
DB is corrupt on the host. Stop backend, run `sqlite3 syncro.db ".recover" > recovered.sql`, rebuild DB from recovered SQL. Then re-run backup.

**restic 429 / throttled by Microsoft**
Edit `.backup.env`, uncomment `RCLONE_TRANSFERS=4` and `RCLONE_TPSLIMIT=10`. Restart timer.

**tmpfs full**
Increase tmpfs size in `/etc/fstab`, `umount` + `mount` to apply. 3G is sized for current DB (2.9G); grow if DB grows.

**rclone auth failed**
Confirm client secret hasn't expired (M365 → App registrations → Certificates & secrets). Regenerate if expired, update `rclone.conf`.
