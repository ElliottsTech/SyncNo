/**
 * Per-entity declarations. Each entry describes one business entity's list and
 * detail surface on the backend, so the entity factory (`tools/entities.ts`)
 * can generate a `list_<entity>` and `get_<entity>` tool per row without
 * hand-writing each one.
 *
 * The filter keys and sort allowlists are copied verbatim from the route files
 * in `backend/src/routes/*.js` (the `req.query` destructure and the
 * `validSorts` allowlist). Keeping them here lets the LLM discover valid filters
 * from the tool schema itself and lets us validate before round-tripping.
 */

export interface EntitySpec {
  /** Tool name suffix, e.g. `customer` → `list_customers` / `get_customer`. */
  entity: string;
  /** Human label for descriptions. */
  label: string;
  /** REST path under /api/ for the list and detail endpoints. */
  path: string;
  /** Default sort column (must appear in `sorts`). */
  defaultSort: string;
  /** Columns the backend accepts for `sortCol`. Empty = no sort param. */
  sorts: string[];
  /** Substring (`LIKE`) filter keys the backend honors, without the `filter_` prefix. */
  filters: string[];
  /** One-line description of what this entity represents, for the tool schema. */
  what: string;
  /** Extra detail about the detail endpoint (e.g. notable nested fields). */
  detailNote?: string;
}

export const ENTITIES: EntitySpec[] = [
  {
    entity: 'customer',
    label: 'customers',
    path: 'customers',
    defaultSort: 'business_name',
    sorts: ['business_name', 'fullname', 'email', 'city', 'state', 'created_at', 'disabled'],
    filters: ['display_name', 'fullname', 'email', 'city', 'state'],
    what: 'MSP customers (the hub entity). Contacts, tickets, assets, invoices, etc. hang off a customer.',
    detailNote: 'Includes the full record. Pass includeRawJson=true only if you need the original Syncro payload.',
  },
  {
    entity: 'ticket',
    label: 'tickets',
    path: 'tickets',
    defaultSort: 'created_at',
    sorts: ['created_at', 'updated_at', 'due_date', 'resolved_at', 'number', 'status', 'priority', 'subject', 'problem_type'],
    filters: ['number', 'subject', 'customer_business_then_name', 'status', 'priority'],
    what: 'Support tickets. Linked to a customer; carries comments, time entries, line items, invoices.',
    detailNote: 'Parses the comments + user JSON fields.',
  },
  {
    entity: 'invoice',
    label: 'invoices',
    path: 'invoices',
    defaultSort: 'date',
    sorts: ['date', 'due_date', 'number', 'total', 'created_at'],
    filters: ['customer_business_then_name', 'date', 'due_date', 'number', 'payment_status', 'total'],
    what: 'Invoices. The list endpoint computes a `payment_status` (paid/verified_paid/tech_marked_paid/overdue/unpaid).',
    detailNote: 'Enriches line items from raw_json with product names + serials; resolves originating estimate + payments.',
  },
  {
    entity: 'estimate',
    label: 'estimates',
    path: 'estimates',
    defaultSort: 'date',
    sorts: ['date', 'number', 'status', 'total', 'created_at'],
    filters: ['customer_business_then_name', 'date', 'number', 'status', 'total'],
    what: 'Estimates/quotes. Resolves linked ticket/invoice numbers and enriches line items.',
  },
  {
    entity: 'purchase_order',
    label: 'purchase orders',
    path: 'purchase-orders',
    defaultSort: 'created_at',
    sorts: ['created_at', 'due_date', 'number', 'total', 'status'],
    filters: ['created_at', 'due_date', 'number', 'status', 'total'],
    what: 'Purchase orders from vendors. Enriches line items with product names.',
  },
  {
    entity: 'asset',
    label: 'assets',
    path: 'assets',
    defaultSort: 'created_at',
    sorts: ['created_at', 'name', 'asset_type', 'updated_at'],
    filters: ['asset_serial', 'asset_type', 'name'],
    what: 'Customer assets/devices. Parses properties/customer/device_info/rmm_links JSON and attaches policy_folder.',
  },
  {
    entity: 'product',
    label: 'products',
    path: 'products',
    defaultSort: 'name',
    sorts: ['name', 'price_retail', 'price_cost', 'quantity', 'product_category', 'updated_at'],
    filters: ['name', 'product_category', 'serialized', 'disabled', 'taxable'],
    what: 'Inventory products. Detail includes serials, SKUs, category, and linked tickets/invoices/estimates/POs.',
    detailNote: 'Excludes soft-deleted unless includeDeleted=true.',
  },
  {
    entity: 'payment',
    label: 'payments',
    path: 'payments',
    defaultSort: 'applied_at',
    sorts: ['applied_at', 'payment_amount', 'payment_method', 'created_at', 'updated_at'],
    filters: ['ref_num', 'payment_method', 'customer_id'],
    what: 'Payments applied to invoices. Linked via the payments.invoice_ids JSON array.',
  },
  {
    entity: 'appointment',
    label: 'appointments',
    path: 'appointments',
    defaultSort: 'start_at',
    sorts: ['start_at', 'end_at', 'summary', 'created_at', 'updated_at'],
    filters: ['summary', 'location', 'customer_id', 'ticket_id'],
    what: 'Scheduled appointments. Resolves linked ticket + customer.',
  },
  {
    entity: 'appointment_type',
    label: 'appointment types',
    path: 'appointment_types',
    defaultSort: 'name',
    sorts: ['name', 'created_at', 'updated_at'],
    filters: ['name'],
    what: 'Appointment type catalog entries.',
  },
  {
    entity: 'contract',
    label: 'contracts',
    path: 'contracts',
    defaultSort: 'name',
    sorts: ['name', 'status', 'start_date', 'end_date', 'created_at', 'updated_at'],
    filters: ['name', 'status', 'customer_id'],
    what: 'Customer contracts. Resolves the linked customer.',
  },
  {
    entity: 'lead',
    label: 'leads',
    path: 'leads',
    defaultSort: 'created_at',
    sorts: ['name', 'email', 'status', 'created_at', 'updated_at', 'mailbox_name', 'ticket_subject', 'business_then_name'],
    filters: ['name', 'email', 'status', 'mailbox_name', 'ticket_subject'],
    what: 'Sales leads, often originating from a mailbox. Resolves customer + contact + ticket.',
  },
  {
    entity: 'policy_folder',
    label: 'policy folders',
    path: 'policy_folders',
    defaultSort: 'name',
    sorts: ['name', 'created_at', 'updated_at', 'asset_count'],
    filters: ['name', 'customer_id', 'asset_id'],
    what: 'Policy folders (self-referential tree under a customer). Resolves linked assets and parent/child folders.',
  },
  {
    entity: 'portal_user',
    label: 'portal users',
    path: 'portal_users',
    defaultSort: 'email',
    sorts: ['email', 'disabled', 'created_at', 'updated_at'],
    filters: ['email', 'disabled', 'customer_id'],
    what: 'End-user portal accounts. Resolves customer + contact.',
  },
  {
    entity: 'schedule',
    label: 'schedules',
    path: 'schedules',
    defaultSort: 'next_date',
    sorts: ['name', 'status', 'next_date', 'start_date', 'end_date', 'created_at', 'updated_at'],
    filters: ['invoice_id', 'customer_id', 'name', 'status'],
    what: 'Recurring schedules (e.g. managed-service billing). Note: structured columns are sparse; detail parses raw_json into a `parsed` field with cents→USD + line items.',
  },
  {
    entity: 'syncro_user',
    label: 'syncro users',
    path: 'syncro_users',
    defaultSort: 'email',
    sorts: ['email', 'name', 'disabled', 'type', 'created_at', 'updated_at'],
    filters: ['email', 'name', 'disabled'],
    what: 'MSP technicians/staff synced from Syncro.',
  },
  {
    entity: 'wiki_page',
    label: 'wiki pages',
    path: 'wiki_pages',
    defaultSort: 'name',
    sorts: ['name', 'slug', 'modified', 'created_at', 'updated_at'],
    filters: ['name', 'slug'],
    what: 'Internal wiki/knowledge-base pages.',
  },
  {
    entity: 'vendor',
    label: 'vendors',
    path: 'vendors',
    defaultSort: 'name',
    sorts: [],
    filters: [],
    what: 'Suppliers/vendors. NOTE: the list endpoint returns ALL vendors as a bare array (no pagination/filter/sort).',
  },
];
