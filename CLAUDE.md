# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SyncNo is a web UI for viewing Syncro MSP data exported as CSVs. Data is imported into SQLite and accessed via Express API, displayed with Next.js.

## Commands

```bash
cd /root/SyncNo/syncno-app

# Start both servers (backend :3001, frontend :3002)
npm run dev

# Re-import CSV data (after schema changes)
npm run import --workspace=backend

# Frontend only
npm run dev --workspace=frontend

# Backend only
npm run dev --workspace=backend

# Rebuild frontend
npm run build --workspace=frontend
```

## Architecture

### Backend (Express + SQLite)
- **Entry**: `backend/src/index.js` (port 3001)
- **Routes**: `backend/src/routes/*.js` - one file per entity
- **DB**: `backend/src/db/schema.sql` defines tables, `importer.js` streams CSV imports
- **Data**: `backend/data/syncro.db` (SQLite)

Key API patterns:
- Column filters use `filter_<column_name>` query params (e.g. `?filter_display_name=Hip`)
- Sort uses `sortCol` and `sortDir` params
- Customer display name uses SQL `COALESCE(NULLIF(business_name,''), fullname) AS display_name`

### Frontend (Next.js 14 App Router)
- Pages in `frontend/app/` - file-based routing matches URL structure
- Components in `frontend/components/` - DataTable, Badge, Pagination, Sidebar
- API calls go to `http://localhost:3001/api/`

DataTable component (`DataTable.tsx`):
- `serverSide` prop enables server-side sort/filter
- `onSortChange(col, dir)` and `onFilterChange(filters)` callbacks
- Filter icon click toggles per-column filter input

## Data Model

Core entities: customers, contacts, tickets, assets, invoices, estimates, payments, vendors, purchase_orders, products

Notable joins:
- PO line_items joined with products table to get product names
- Invoices have payment_status computed field (paid/overdue/unpaid)
- Payments linked to invoices via JSON array in `invoice_ids` column

## CSV Source

Data lives in `/root/SyncNo/SyncNo/` as `03072026_*.csv` files.
When schema changes, delete `syncro.db` and re-run `npm run import --workspace=backend`.
