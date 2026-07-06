# SyncNo

MSP data viewer for Syncro MSP — displays customers, tickets, invoices, assets, and more from Syncro's API with Azure AD SSO authentication.

## Architecture

```
syncno/
├── backend/              # Express API server (port 3002)
│   └── src/
│       ├── db/           # SQLite DB + CSV importer
│       └── routes/       # API endpoints (customers, tickets, invoices, etc.)
├── frontend/             # Next.js 14 app (port 3001)
│   └── app/             # App router pages
├── scripts/             # Operational scripts (update.sh)
├── docker-compose.yml    # Production deployment
└── setup-ubuntu.sh      # One-shot server setup
```

**Backend:** Express + SQLite. Syncs data from Syncro API and serves REST endpoints.
**Frontend:** Next.js 14 with Azure AD SSO. Calls backend API directly.

---

## Prerequisites

- Node.js 20+
- Docker & Docker Compose (for production)
- Syncro MSP account + API key
- Azure AD app registration (for SSO)

---

## Environment Variables

Create `syncno/.env` (copy from `.env.example` for local dev):

```bash
# App
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=openssl rand -base64 32

# Backend (for local dev, Docker uses same .env)
SYNCRO_API_KEY=your-syncro-api-key
SYNCRO_SUBDOMAIN=your-syncro-subdomain

# Frontend (Azure AD SSO)
AZURE_CLIENT_ID=your-azure-app-client-id
AZURE_CLIENT_SECRET=your-azure-app-client-secret
AZURE_TENANT_ID=your-azure-tenant-id

# Frontend → backend proxy target (Docker: http://backend:3002, local: http://localhost:3002)
BACKEND_URL=http://backend:3002
NEXT_PUBLIC_API_URL=/api

# Service key — shared secret for NextAuth server-side callbacks and MCP servers.
# Backend accepts Authorization: Bearer <SYNCNO_API_KEY> as alternative to browser cookie.
SYNCNO_API_KEY=openssl rand -base64 32

# Demo mode — set to "yes" to flip the app into a public-demo profile:
# no sign-on (any sign-in attempt succeeds as a demo admin), simulated syncs,
# no-op mutations, and a separate demo DB (backend/data/demo.db, seeded from
# demo.seed.db). Omit for a normal authenticated deployment.
DEMO=no
# NEXT_PUBLIC_DEMO must match at build time so the client bundle knows it's a
# demo build (gated sign-in provider). Set both to "yes" for a demo image.
NEXT_PUBLIC_DEMO=no
```

Generate secrets: `openssl rand -base64 32`

---

## Local Development

```bash
cd syncno

# Install dependencies
npm install

# Start both servers (backend :3002, frontend :3001)
npm run dev

# Or start individually:
npm run dev --workspace=backend    # http://localhost:3002
npm run dev --workspace=frontend  # http://localhost:3001
```

### CSV Import (optional — if syncing from Syncro, skip this)

If you have Syncro data exported as CSVs:

```bash
# Place CSVs in syncno/backend/data/ as:
#   customers.csv, contacts.csv, tickets.csv, invoices.csv, etc.

# Delete existing DB and re-import
rm backend/data/syncro.db
npm run import --workspace=backend
```

---

## Security Model

The backend (Express, port 3002) is **not published** in Docker — it lives only on the internal Docker network. All browser traffic is proxied through the Next.js frontend via a rewrite (`/api/:path*` → `${BACKEND_URL}/api/:path*`). Cookies are forwarded by the rewrite, so the browser's NextAuth session authenticates the request at the backend.

Backend auth middleware (`backend/src/index.js`) accepts one of:
1. **NextAuth session cookie** — browser via the proxy. JWT decoded against `NEXTAUTH_SECRET`.
2. **`Authorization: Bearer <SYNCNO_API_KEY>`** — for service-to-service calls (NextAuth callbacks in `app/lib/auth.ts`) and future MCP servers running on the same host.

Anything else returns `401`.

Authorization rules:
- All data reads (`/api/customers`, `/api/tickets`, etc.): any authenticated user.
- Sync mutating routes (`POST /sync/trigger`, `/save`, `/reset`, `/schedule`, `/enabled`, `PATCH /synced`, `DELETE /sync/trigger`, `POST /sync/preview`): admin only.
- User management (`GET /users`, `GET /users/:id`, `PUT /users/:id/role`): admin only.
- Internal auth-helper routes (`POST /users/upsert`, `GET /users/:id/role`, `PUT /users/:id/last-login`): service key only — browser cannot call them.
- `/api/health` and `/api/auth/*`: public.

### Integrating an MCP server

Run the MCP server on the same host (or Docker network). Read `SYNCNO_API_KEY` and `BACKEND_URL` from the environment, send `Authorization: Bearer <key>` on every request. No special endpoints — the same routes the frontend uses are available to the MCP server. Service-key requests are tagged `req.user.role === 'service'`; they pass `requireAuth` but not `requireAdmin`, so admin-only mutations stay blocked.

---

## Demo Mode

A single codebase builds both the live app and a public-facing demo. The mode is selected entirely by env flags — no separate branch or build config.

Set `DEMO=yes` (backend) and `NEXT_PUBLIC_DEMO=yes` (frontend, must be set at build time so the client bundle is gated) to enable. With demo mode on:

- **Auth is bypassed** — the NextAuth provider accepts any sign-in and returns a fixed `Demo Admin` user (`demo@syncno.local`). No Azure round-trip.
- **A separate DB is used** — `backend/data/demo.db` (seeded from `demo.seed.db` on first run), so demo activity never touches the live database.
- **Mutations are no-ops** — sync triggers, credential saves, and other writes return `{ ok: true, demo: true }` without hitting Syncro or disk (`demoNoop` in `backend/src/demo.js`).

Useful for public trials, sales demos, and screenshots. Leave both flags unset for a normal authenticated deployment.

---

## Backups

Built-in encrypted backups via [restic](https://restic.net/) + [rclone](https://rclone.org/) to SharePoint. Configured from the UI at **Settings → Backup** (`/settings/backup`, admin only); the underlying config lives at `/api/backup-settings`.

- **What gets backed up:** the SQLite DB (`backend/data/syncro.db`) and ticket attachments (`backend/data/attachments/`).
- **Where:** restic repository on a SharePoint remote via rclone (the `sharepoint` rclone remote). Password can be supplied directly or read from a file (`RESTIC_PASSWORD_FILE`, default `/root/.restic-password`).
- **Tunable env (all optional, sensible defaults):** `BACKUP_ENV_PATH`, `RCLONE_CONF_PATH`, `SYNCNO_ROOT`, `SYNCNO_DB`, `BACKUP_STAGE_DIR` (default `/mnt/backup-stage`).
- **Endpoints** (all admin only): `GET /api/backup-settings` (current config), `POST /` (save), `POST /test` (validate connection), `POST /init` (init restic repo), `POST /run` (run a backup), `POST /enable-timer` (toggle scheduled runs), `GET /status`, `GET /download-json` (export JSON of all entities), `GET /download` (download a snapshot).

A simple in-process lock guards concurrent snapshot downloads so they don't overrun the staging tmpfs.

---

## Docker Deployment

```bash
# 1. Clone the repo on your server
git clone https://github.com/ElliottsTech/SyncNo.git /opt/syncno
cd /opt/syncno

# 2. Create .env file
cat > .env << 'EOF'
NEXTAUTH_SECRET=<generate with openssl rand -base64 32>
NEXTAUTH_URL=https://your-domain.com
SYNCRO_API_KEY=<your-key>
SYNCRO_SUBDOMAIN=<your-subdomain>
SYNCNO_API_KEY=<generate with openssl rand -base64 32>
AZURE_CLIENT_ID=<from Azure portal>
AZURE_CLIENT_SECRET=<from Azure portal>
AZURE_TENANT_ID=<from Azure portal>
EOF

# 3. Build and start
docker compose up -d

# 4. Check status
docker compose ps
docker compose logs -f
```

Services:
- **Frontend:** http://your-server:3001 (only published port)
- **Backend API:** reachable only inside the Docker network at `http://backend:3002/api`. Browser requests proxied through the frontend at `/api/*`.

---

## Syncro Setup

1. Log into Syncro MSP
2. Go to **Settings → API**
3. Create an API key — copy it to `SYNCRO_API_KEY`
4. Your subdomain is the part before `.syncromsp.com` — copy to `SYNCRO_SUBDOMAIN`

The sync page (`/syncro`) shows sync status. "Sync" pulls records updated since last sync. "Re-sync" forces a full pull of all records.

---

## Azure AD SSO Setup

1. Go to **Azure Portal → Azure Active Directory → App registrations**
2. Click **New registration**
   - Name: `SyncNo`
   - Supported account types: Single tenant
   - Redirect URI: `https://your-domain.com/api/auth/callback/azure-ad`
3. After creation, go to **Certificates & secrets → New client secret** — copy to `AZURE_CLIENT_SECRET`
4. Go to **Expose an API** — set Application ID URI if not set
5. Go to **API permissions** — add `openid profile email` scopes if not present
6. Copy:
   - **Application (client) ID** → `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`

---

## Production Notes

- **Database:** SQLite file lives in `backend/data/syncro.db` (Docker volume)
- **Sync:** Runs on-demand from the `/syncro` page. Add a cron job or external scheduler to trigger `POST /api/sync/trigger` periodically (requires admin session cookie or service key)
- **Reverse proxy:** Put Nginx in front of the frontend container for TLS termination and custom domain. Backend does not need to be exposed publicly.
- **Backups:** Back up the SQLite file and `.env` — both contain all app data and credentials
- **Rate limiting:** Syncro API is throttled. The sync code handles 429s with 65s backoff
- **MCP integration:** Place MCP servers on the same Docker network. They authenticate with `Authorization: Bearer ${SYNCNO_API_KEY}`. Backend exposes no MCP-specific endpoints; reuse existing API routes.

---

## Updating SyncNo

Admin sidebar shows the current version. When a newer GitHub tag exists, a yellow "Update" pill appears with the new version + copyable `update.sh` command.

**To update:**

```bash
ssh user@server
sudo /opt/syncno/scripts/update.sh
```

The script:
1. Verifies no tracked file modifications and responsive Docker daemon
2. Auto-discovers repo root from script location (works for any install path)
3. Fetches `origin/main`, fast-forwards
4. Rebuilds containers (`docker compose build`)
5. Restarts services (`docker compose up -d`)
6. Polls `http://localhost:3001/api/health` for up to 90s

### Per-instance customizations

Use `docker-compose.override.yml` (gitignored) for instance-specific overrides like publishing extra ports or mounting local dirs. Compose auto-merges it on top of the base file, so `git pull` never conflicts.

Example `/opt/syncno/docker-compose.override.yml` to publish the backend port:

```yaml
services:
  backend:
    ports:
      - "3002:3002"
```

Set `HOST_INSTALL_DIR` in `.env` so the UI shows the right `update.sh` path:

```
HOST_INSTALL_DIR=/opt/syncno
```

**On failure** (build error, restart failure, or health check timeout), the script exits non-zero and prints a rollback block:

```
UPDATE FAILED at phase: <phase>

To roll back manually:
  cd /opt/syncno
  git reset --hard <previous-sha>
  docker compose build
  docker compose up -d

Then verify: curl http://localhost:3001/api/health
Logs: docker compose logs --tail=100
```

No auto-rollback — admin decides whether to roll back or fix forward.

**Note:** If git is unavailable inside the container, `update.sh` writes `/opt/syncno/.deploy-sha` on successful update as a fallback SHA source.

---

## URL Reference

| Route | Page |
|-------|------|
| `/` | Dashboard / tickets |
| `/customers` | Customer list |
| `/customers/[id]` | Customer detail (contacts, tickets, assets, invoices, estimates, payments, schedules) |
| `/invoices` | Invoice list |
| `/tickets` | Ticket list |
| `/tickets/[id]` | Ticket detail (comments, time entries, line items, invoices, estimates, appointments, worksheets) |
| `/assets` | Asset list |
| `/estimates` | Estimates |
| `/purchase-orders` | Purchase orders |
| `/vendors` | Vendors |
| `/products` | Products |
| `/payments` | Payments |
| `/appointments` | Appointments |
| `/appointment_types` | Appointment types |
| `/contracts` | Contracts |
| `/leads` | Leads |
| `/policy_folders` | Policy folders |
| `/portal_users` | Portal users |
| `/schedules` | Schedules |
| `/syncro_users` | Syncro users |
| `/wiki_pages` | Wiki pages |
| `/search` | Global search |
| `/syncro` | Sync settings & trigger |
| `/settings/config` | Syncro & Azure AD credentials, tab enablement (admin) |
| `/settings/backup` | Encrypted backup configuration — restic + rclone + SharePoint (admin) |
| `/logs` | Activity logs |
| `/users` | User management |
| `/login` | Azure AD login |

---

## API Reference

Base URL: `http://localhost:3002/api`

All list endpoints support query params:

| Param | Purpose |
|-------|---------|
| `filter_<column>` | Exact match filter (e.g. `?filter_display_name=Hip`) |
| `sortCol` | Column to sort by |
| `sortDir` | `asc` or `desc` |
| `limit` | Page size |
| `offset` | Pagination offset |

### Customers `/customers`
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | List; `display_name` = `COALESCE(NULLIF(business_name,''), fullname)` |
| GET | `/:id` | Detail |
| GET | `/:id/contacts` | |
| GET | `/:id/tickets` | |
| GET | `/:id/assets` | |
| GET | `/:id/invoices` | |
| GET | `/:id/estimates` | |
| GET | `/:id/payments` | |
| GET | `/:id/schedules` | |

### Tickets `/tickets`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |
| GET | `/:id/comments` |
| GET | `/:id/time_entries` |
| GET | `/:id/line_items` |
| GET | `/:id/invoices` |
| GET | `/:id/estimates` |
| GET | `/:id/appointments` |
| GET | `/:ticket_id/worksheet_results` |
| GET | `/:ticket_id/worksheet_results/:id` |

### Invoices `/invoices`
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Computed `payment_status`: paid / overdue / unpaid |
| GET | `/:id` | |
| GET | `/:id/payments` | |
| GET | `/:id/ticket` | Linked ticket |

### Estimates `/estimates`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Payments `/payments`
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Linked to invoices via `invoice_ids` JSON array |
| GET | `/:id` | |

### Vendors `/vendors`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |
| GET | `/:id/purchase_orders` |

### Purchase Orders `/purchase-orders`
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Line items joined with products for names |
| GET | `/:id` | |

### Assets `/assets`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Products `/products`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/categories` |
| GET | `/:id` |
| GET | `/:id/tickets` |

### Serials `/serials`
| Method | Path |
|--------|------|
| GET | `/:serial` | Lookup product by serial |

### Appointment Types `/appointment_types`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Appointments `/appointments`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Contracts `/contracts`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Leads `/leads`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Policy Folders `/policy_folders`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Portal Users `/portal_users`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Schedules `/schedules`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Syncro Users `/syncro_users`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Wiki Pages `/wiki_pages`
| Method | Path |
|--------|------|
| GET | `/` |
| GET | `/:id` |

### Users `/users`
| Method | Path | Auth |
|--------|------|------|
| POST | `/upsert` | |
| PUT | `/:id/last-login` | |
| GET | `/:id/role` | |
| GET | `/` | Admin only |
| GET | `/:id` | Admin only |
| PUT | `/:id/role` | Admin only |

### Logs `/logs`
| Method | Path |
|--------|------|
| GET | `/` |
| POST | `/` |

### Search `/search`
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Global search across entities |

### Sync `/sync`
| Method | Path | Notes |
|--------|------|-------|
| GET | `/status` | Current sync status |
| GET | `/last-results` | Last sync outcome |
| GET | `/progress` | Live progress |
| GET | `/events` | Event stream |
| GET | `/enabled` | Sync enabled flag |
| POST | `/enabled` | Toggle sync |
| GET | `/schedule` | Schedule config |
| POST | `/schedule` | Update schedule |
| POST | `/save` | Save mapping/config |
| POST | `/preview` | Preview changes |
| POST | `/trigger` | Incremental sync (updated since last) |
| DELETE | `/trigger` | Cancel in-progress sync |
| POST | `/reset` | Reset sync state |
| PATCH | `/synced` | Mark record synced |

### Backup Settings `/backup-settings` (admin only)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Current backup config |
| POST | `/` | Save config |
| POST | `/test` | Validate restic/rclone connection |
| POST | `/init` | Initialize the restic repository |
| POST | `/run` | Run a backup snapshot |
| POST | `/enable-timer` | Toggle scheduled backups |
| GET | `/status` | Last run status |
| GET | `/download-json` | Export all entities as JSON |
| GET | `/download` | Download a snapshot archive |

### Health
| Method | Path |
|--------|------|
| GET | `/api/health` | Returns `{ "status": "ok" }` |

### System `/system`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/version` | Admin only | `{ current, latest, updateAvailable }`. Pass `?refresh=true` to bypass cache. |
