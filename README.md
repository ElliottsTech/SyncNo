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

# API URL (frontend → backend)
NEXT_PUBLIC_API_URL=http://localhost:3002/api
```

Generate a secret: `openssl rand -base64 32`

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
- **Frontend:** http://your-server:3001
- **Backend API:** http://your-server:3002/api

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
- **Sync:** Runs on-demand from the `/syncro` page. Add a cron job or external scheduler to trigger `POST /api/sync/trigger` periodically
- **Reverse proxy:** Put Nginx in front of both containers for TLS termination and custom domain
- **Backups:** Back up the SQLite file and `.env` — both contain all app data and credentials
- **Rate limiting:** Syncro API is throttled. The sync code handles 429s with 65s backoff

---

## URL Reference

| Route | Page |
|-------|------|
| `/` | Dashboard / tickets |
| `/customers` | Customer list |
| `/invoices` | Invoice list |
| `/tickets` | Ticket list |
| `/assets` | Asset list |
| `/estimates` | Estimates |
| `/purchase-orders` | Purchase orders |
| `/vendors` | Vendors |
| `/search` | Global search |
| `/syncro` | Sync settings & trigger |
| `/logs` | Activity logs |
| `/users` | User management |
| `/login` | Azure AD login |
