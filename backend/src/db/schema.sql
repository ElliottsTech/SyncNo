-- Syncro MSP Schema

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  business_name TEXT,
  fullname TEXT,
  email TEXT,
  phone TEXT,
  mobile TEXT,
  address TEXT,
  address_2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  disabled INTEGER DEFAULT 0,
  location_name TEXT,
  location_id TEXT,
  pdf_url TEXT,
  tax_rate_id TEXT,
  invoice_term_id TEXT,
  referred_by TEXT,
  ref_customer_id TEXT,
  business_and_full_name TEXT,
  business_then_name TEXT,
  contacts TEXT,
  properties TEXT,
  notification_email TEXT,
  invoice_cc_emails TEXT,
  get_sms INTEGER DEFAULT 0,
  opt_out INTEGER DEFAULT 0,
  no_email INTEGER DEFAULT 0,
  latitude TEXT,
  longitude TEXT,
  online_profile_url TEXT,
  raw_json TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER,
  name TEXT,
  address1 TEXT,
  address2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  email TEXT,
  phone TEXT,
  mobile TEXT,
  latitude TEXT,
  longitude TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  vendor_id TEXT,
  opt_out INTEGER DEFAULT 0,
  extension TEXT,
  processed_phone TEXT,
  processed_mobile TEXT,
  ticket_matching_emails TEXT,
  properties TEXT,
  account_id TEXT,
  raw_json TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  number TEXT,
  subject TEXT,
  created_at TEXT,
  customer_id INTEGER,
  customer_business_then_name TEXT,
  due_date TEXT,
  resolved_at TEXT,
  start_at TEXT,
  end_at TEXT,
  location_id TEXT,
  problem_type TEXT,
  status TEXT,
  ticket_type_id TEXT,
  user_id TEXT,
  updated_at TEXT,
  pdf_url TEXT,
  priority TEXT,
  comments TEXT,
  user TEXT,
  raw_json TEXT,
  synced INTEGER DEFAULT 0,
  has_detail INTEGER DEFAULT 0,
  synced_at TEXT,
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  name TEXT,
  customer_id INTEGER,
  contact_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  properties TEXT,
  asset_type TEXT,
  asset_serial TEXT,
  external_rmm_link TEXT,
  rmm_links TEXT,
  has_live_chat INTEGER DEFAULT 0,
  snmp_enabled INTEGER DEFAULT 0,
  device_info TEXT,
  rmm_store TEXT,
  address TEXT,
  customer TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER,
  customer_business_then_name TEXT,
  number TEXT,
  created_at TEXT,
  updated_at TEXT,
  date TEXT,
  due_date TEXT,
  subtotal TEXT,
  total TEXT,
  tax TEXT,
  verified_paid INTEGER DEFAULT 0,
  tech_marked_paid INTEGER DEFAULT 0,
  ticket_id TEXT,
  pdf_url TEXT,
  is_paid INTEGER DEFAULT 0,
  location_id TEXT,
  po_number TEXT,
  contact_id TEXT,
  note TEXT,
  hardwarecost TEXT,
  user_id TEXT,
  raw_json TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY,
  customer_business_then_name TEXT,
  number TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT,
  customer_id INTEGER,
  date TEXT,
  subtotal TEXT,
  total TEXT,
  tax TEXT,
  ticket_id TEXT,
  pdf_url TEXT,
  location_id TEXT,
  invoice_id TEXT,
  employee TEXT,
  raw_json TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  success INTEGER DEFAULT 0,
  payment_amount TEXT,
  invoice_ids TEXT,
  ref_num TEXT,
  applied_at TEXT,
  payment_method TEXT,
  customer TEXT,
  customer_id INTEGER,
  raw_json TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY,
  name TEXT,
  rep_first_name TEXT,
  rep_last_name TEXT,
  email TEXT,
  phone TEXT,
  account_number TEXT,
  created_at TEXT,
  updated_at TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  website TEXT,
  notes TEXT,
  raw_json TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  price_cost TEXT,
  price_retail TEXT,
  condition TEXT,
  description TEXT,
  maintain_stock INTEGER DEFAULT 0,
  name TEXT,
  quantity TEXT,
  warranty TEXT,
  sort_order TEXT,
  reorder_at TEXT,
  disabled INTEGER DEFAULT 0,
  taxable INTEGER DEFAULT 0,
  product_category TEXT,
  category_path TEXT,
  upc_code TEXT,
  discount_percent TEXT,
  warranty_template_id TEXT,
  qb_item_id TEXT,
  desired_stock_level TEXT,
  price_wholesale TEXT,
  notes TEXT,
  tax_rate_id TEXT,
  physical_location TEXT,
  serialized INTEGER DEFAULT 0,
  vendor_ids TEXT,
  long_description TEXT,
  location_quantities TEXT,
  photos TEXT,
  since_updated_at TEXT,
  created_at TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  synced INTEGER DEFAULT 0,
  raw_json TEXT,
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS product_categories (
  id INTEGER PRIMARY KEY,
  account_id TEXT,
  ancestry TEXT,
  name TEXT,
  description TEXT,
  device_product_id TEXT,
  names_depth_cache TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS product_serials (
  id INTEGER PRIMARY KEY,
  product_id INTEGER,
  serial_number TEXT,
  account_id TEXT,
  status TEXT,
  line_item_id INTEGER,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS product_skus (
  id INTEGER PRIMARY KEY,
  product_id INTEGER,
  vendor_name TEXT,
  vendor_id INTEGER,
  sku TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY,
  account_subdomain TEXT,
  created_at TEXT,
  updated_at TEXT,
  expected_date TEXT,
  number TEXT,
  other TEXT,
  shipping TEXT,
  shipping_notes TEXT,
  status TEXT,
  total TEXT,
  user_id TEXT,
  vendor_id INTEGER,
  location_id TEXT,
  due_date TEXT,
  paid_date TEXT,
  delivery_tracking TEXT,
  vendor TEXT,
  location TEXT,
  line_items TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER,
  body TEXT,
  tech TEXT,
  user_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS ticket_time_entries (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER,
  user_id TEXT,
  start_time TEXT,
  end_time TEXT,
  recorded INTEGER,
  billable INTEGER,
  notes TEXT,
  active_duration INTEGER,
  product_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS ticket_line_items (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER,
  product_id TEXT,
  quantity INTEGER,
  price REAL,
  description TEXT,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_assets_customer ON assets(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_estimates_customer ON estimates(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_customers_business_name ON customers(business_name);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_time_entries_ticket ON ticket_time_entries(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_line_items_ticket ON ticket_line_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(product_category);
CREATE INDEX IF NOT EXISTS idx_product_categories_ancestry ON product_categories(ancestry);
CREATE INDEX IF NOT EXISTS idx_product_serials_product ON product_serials(product_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_serial ON product_serials(serial_number);
CREATE INDEX IF NOT EXISTS idx_product_skus_product ON product_skus(product_id);
CREATE INDEX IF NOT EXISTS idx_product_skus_vendor ON product_skus(vendor_id);
CREATE INDEX IF NOT EXISTS idx_ticket_line_items_product ON ticket_line_items(product_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  role TEXT DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  browser TEXT,
  os TEXT,
  device_type TEXT,
  country TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
  entity TEXT PRIMARY KEY,
  phase TEXT DEFAULT 'idle',
  total_pages INTEGER DEFAULT 0,
  last_page_synced INTEGER DEFAULT 0,
  detail_cursor TEXT DEFAULT NULL,
  detail_page INTEGER DEFAULT 1,
  detail_item_index INTEGER DEFAULT 0,
  detail_total INTEGER DEFAULT 0,
  detail_synced INTEGER DEFAULT 0,
  last_sync TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  catalog_page1_ids TEXT DEFAULT '[]',
  catalog_total_pages INTEGER DEFAULT 0,
  last_result_count INTEGER DEFAULT 0,
  last_result_error TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT,
  phase TEXT,
  status TEXT,
  message TEXT,
  error TEXT,
  current INTEGER,
  total INTEGER,
  subphase TEXT,
  detail_total INTEGER,
  detail_synced INTEGER,
  current_ticket_id TEXT,
  current_ticket_number TEXT,
  count INTEGER,
  current_record_id TEXT,
  current_record_name TEXT,
  data_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_events_created ON sync_events(created_at);
