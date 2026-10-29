# SyncNo Consolidation Plan

**Date:** 2026-10-29 · **Status:** proposed · **Sources:** live recon of both servers, BinaryLane API (read-only), prod code snapshots in `Projects\SyncNo-Prod-2026-10-29\`

---

## 1. Executive summary

SyncNo today is **one product split across two repos, two servers, and three git realities**:

- **SyncNo-Web** (`ElliottsTech/SyncNo-Web`) is the SaaS control plane — marketing/shop (Astro), marketing API (Express + SQLite `marketing.db`: onboarding, trials, Stripe subscriptions, analytics, blog/newsletter), admin portal (Astro + Azure AD), demo instance, PII scrubber, and a tenant-provisioning worker.
- **SyncNo** (`ElliottsTech/SyncNo`) is the product — Next.js frontend + Express/SQLite backend + MCP server.
- The SaaS embeds the product via `scripts/fork-demo.sh`, an **rsync copy** of the app into `apps/demo-*`. Tenant instances build their Docker images from that fork (`tenant-template/docker-compose.tenant.yml` build contexts), and the worker's "stage flow" re-pulls the app from GitHub and re-forks to roll updates out to tenants.

**Recommendation: merge into one monorepo (high feasibility — details §3) and migrate the SaaS to a new dedicated BinaryLane server in the ET account (Option B, §4).** Cancel the old `syncno.net` BL account afterwards (net cost ≈ $0, removes a whole account + a 100%-full-disk single point of failure). WebApps keeps the internal Elliotts SyncNo instance.

---

## 2. Current state (verified 2026-10-29)

### syncno.net server (BinaryLane 636212, **separate BL account**, Sydney)
std-2vcpu · 2 vCPU / 4 GB / 35 GB · **$19.60/mo + backup surcharge** · no VPC · **disk was 100% full** (cleaned to 6.4 GB free same day; root causes: tenant DBs 8.3 GB, docker images 9 GB + build cache 4.2 GB, .vscode-server 4 GB).

| Runs | Detail |
|---|---|
| SaaS control plane | `marketing-web` :4001 (syncno.net, www, **shop**), `marketing-api` :4002 (also license.syncno.net), `admin-web` :4005, `demo-fe/be` :4003/4004, `demo-scrub` (cron), `trial-expiry` |
| Provisioner | systemd `syncno-provisioner.service` → `/var/lib/syncno/instances/<slug>/` |
| Tenants | 5 dirs: **elliotts (live**, elliotts.syncno.net, own 4.8 GB DB), elliotts-tech, elliotts-tech-2, swcomp, techwindow (dormant) |
| Internal app | `syncno-frontend/backend` :3001/:3002 (the duplicate — remove on migration) |
| Edge | host nginx, wildcard *.syncno.net via acme.sh **manual DNS** (next renewal ~2026-12-24) |

### WebApps (`webapps.elliotts.tech`, ET BL account, Perth)
std-2vcpu · 2 vCPU / 8 GB / 80 GB · ET BL VPC 443823 behind **BL OPNsense** (Sydney, 43.224.183.147). 19 containers: **internal SyncNo instance** (canonical for Elliotts use — has the QBO integration + newest .env), analytics-service, bl-api-proxy (etapps.au apisix), binarylane-billing, fwdash, n8n, phpayroll, portainer, dashy, etc. Load ~0.9 / 2 cores, 4.8 GB RAM free, 15 GB disk free. No public 80/443 today.

### Git drift (the part that must be fixed before anything merges)
| Repo | GitHub | syncno server | Notes |
|---|---|---|---|
| SyncNo app | `5c02627` (+2026-10-29 work) | `8ec57f1` **diverged** | GitHub lacks demo-bypass/README commits; prod lacks QBO/serials/search work; prod has 5 modified server scripts |
| SyncNo-Web | `11490fb` | `113684a` **+14 unpushed commits** (payment portal, trials, Stripe fixes) **+36 uncommitted files** (~1,935 insertions: re-forked app code, onboarding wizard, worker, GeoLite2) | **Prod is the source of truth; GitHub is stale** |

Local snapshots with full `.git`: `Projects\SyncNo-Prod-2026-10-29\` (see its MANIFEST.md). Demo fork vs app source: **byte-identical today** (re-forked recently); `DEMO_MODE` is native to the app (`backend/src/demo.js`), so the fork carries no patches.

---

## 3. Code merge — feasibility: HIGH

### Why it's easy
- The SaaS *already* consumes the app as a file copy; a monorepo just deletes the copy step. `tenant-template` build contexts change from `{{app_root}}/apps/demo-*` to the app directories.
- No runtime conflicts: separate DBs (`marketing.db` vs per-tenant `syncro.db`), separate ports (4001–4005 vs 3000-per-tenant), shared patterns (Express + better-sqlite3, Docker Compose, Azure AD auth in both admin and app).
- The demo is literally the app with `DEMO_MODE=1` — one source serves product, demo, and tenants.

### Target layout (existing SyncNo repo becomes the monorepo)
```
SyncNo/
├── apps/            # from SyncNo-Web: web (marketing), admin, api, demo-scrub
├── frontend/        # existing app frontend  → serves product/demo/tenants
├── backend/         # existing app backend
├── mcp-server/      # unchanged
├── worker/          # provisioner (from SyncNo-Web)
├── tenant-template/ # build contexts repointed at ../frontend ../backend
└── scripts/         # merged; fork-demo.sh retired; stage flow builds in-place
```

### Merge sequence
1. **Recover SyncNo-Web prod state**: from the local snapshot, push `113684a` + the 36 working-tree files to GitHub (review diffs first — they contain live product changes).
2. **Reconcile the app repo**: fetch `8ec57f1` from the prod snapshot, merge into main (small: README/demo-bypass/server scripts vs GitHub's QBO/serials/search).
3. **Move SaaS apps in** (`git subtree add` or plain move preserving history): apps/web, apps/admin, apps/api, apps/demo-scrub, worker, tenant-template, docs.
4. **Repoint** tenant-template build contexts + worker `{{app_root}}` paths; delete `apps/demo-*`; replace stage flow's "pull + re-fork" with "pull + build demo from source".
5. **CI/deploy**: one compose file per host role (SaaS host, WebApps internal instance); `scripts/update.sh` extended for the SaaS stack.

**Effort:** ~1–2 focused days (mostly git plumbing + path fixes + one staged deploy test on the demo). **Risks:** low — worker path assumptions; tenant rebuild takes longer on rollouts (rebuilds from source instead of cached fork); mitigate by keeping the old fork branch until one successful tenant rollout.

---

## 4. Infrastructure consolidation — Option B recommended

| | **A: All on WebApps** | **B: New dedicated BL server (recommended)** |
|---|---|---|
| Cost | +~$3.30/mo disk (80→110 GB), −$19.60+ (cancel syncno account) → **net save ~$16/mo** | std-2vcpu **$19.60/mo**, 60 GB base disk → **net ≈ $0** |
| Fit | Disk needs resize (15 GB free vs ~25 GB needed); RAM fine (SaaS idle, 4.8 GB free) | Roomier than today (60 vs 35 GB); fresh IP, no DNS history |
| Security | Public tier lands on the box holding fwdash creds, BL-API proxy, billing, n8n — biggest blast radius, even with CF+HAProxy in front | Public tier isolated; WebApps untouched; can use its own VPC |
| Ops | One less server | Same server count as today, but in the right account |

Sizing check (from live data): SaaS control plane ≈ 320 MB RAM / ~0% CPU; each tenant ≈ 170 MB idle. A std-2vcpu (2 vCPU/4 GB) hosts control plane + ~8–10 idle tenants comfortably; std-4vcpu ($39.20) if tenants grow or the elliotts tenant syncs heavily. Take **std-2vcpu, Sydney or Perth, own VPC (or ET VPC), backups on**.

### Edge design (agreed)
Cloudflare proxied DNS → fresh origin IP → **HAProxy on the BL OPNsense** (already live there: SNI frontend on 80/443, ~20 backends) → new server. WAN rules already restrict HAProxy ports to `Cloudflare_IPs` + admin sources; the alias has been converted to an auto-updating URL alias (remove the old static alias once verified). `admin.syncno.net` stays **out of the public path** — Tailscale/direct-source only. Free tier = CF outage is accepted (no grey-cloud fallback).

---

## 5. Migration runbook (sketch)

**Phase 0 — code first (no user impact):** merge per §3; deploy merged stack to the *existing* syncno server as a canary (it already runs everything).
**Phase 1 — new server:** create std-2vcpu in ET account (+ backups); restore SaaS: code from monorepo, `marketing.db` (20 MB), GeoLite2, tenant instance dirs (`rsync /var/lib/syncno/instances`, ~5.4 GB in tenant DBs); import worker systemd unit; issue wildcard cert via acme.sh **Cloudflare DNS API** (ends the manual TXT ritual — do this before the Dec 24 renewal).
**Phase 2 — edge cutover:** HAProxy frontends/backends for syncno.net/www/shop/admin/demo/license/`*.syncno.net` tenants on the OPNsense; CF DNS A-record → new IP (proxied); verify per-vhost 200s; TTLs low beforehand.
**Phase 3 — tenant cutover:** re-point tenant DNS (wildcard), health-check each `<slug>.syncno.net`, rebuild tenant images from monorepo on the new host.
**Phase 4 — decommission:** stop the old app containers (`syncno-frontend/backend-1` — the duplicate); confirm restic→SharePoint backups re-targeted or re-initialised on new host (destination is host-independent); watch 48 h; **delete BL 636212 + cancel that BL account**.
**Rollback at every phase:** old stack stays up until Phase 4; DNS flip back is the rollback.

**Cert continuity:** wildcard re-issue happens on the NEW host against the same `*.syncno.net` zone — no gap; old cert remains valid until Dec 24 regardless.
**Backup continuity:** tenant DBs currently have no restic coverage on the old host (only the internal app DB does) — add tenant `data/` dirs to the new host's backup set (sizes: elliotts 4.8 GB + wal — schedule a checkpoint first).

---

## 6. Open decisions
1. Merge commits for SyncNo-Web's 36 uncommitted files — review then push from the snapshot (contains onboarding/worker changes only present on prod).
2. Internal Elliotts app: keep the WebApps instance as canonical (recommended — it has QBO live) and drop the syncno-server copy; alternatively promote the `elliotts` tenant and retire the WebApps one.
3. Dormant tenants (swcomp, techwindow, elliotts-tech×2): keep images on the new host (~3.6 GB) or let them re-provision on demand?
4. New server region: Sydney (same DC as OPNsense, lowest edge latency) vs Perth (same DC as WebApps, easier cross-host ops).
