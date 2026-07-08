/**
 * Verifies the full tool surface is registered and discoverable via the MCP
 * protocol (tools/list), and that the naming follows the documented convention.
 * No live backend required — we only inspect the manifest.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestClient } from './helpers.js';

const EXPECTED_TOOLS = new Set([
  'search',
  // 18 entities × (list + get)
  'list_customers', 'get_customer',
  'list_tickets', 'get_ticket',
  'list_invoices', 'get_invoice',
  'list_estimates', 'get_estimate',
  'list_purchase_orders', 'get_purchase_order',
  'list_assets', 'get_asset',
  'list_products', 'get_product',
  'list_payments', 'get_payment',
  'list_appointments', 'get_appointment',
  'list_appointment_types', 'get_appointment_type',
  'list_contracts', 'get_contract',
  'list_leads', 'get_lead',
  'list_policy_folders', 'get_policy_folder',
  'list_portal_users', 'get_portal_user',
  'list_schedules', 'get_schedule',
  'list_syncro_users', 'get_syncro_user',
  'list_wiki_pages', 'get_wiki_page',
  'list_vendors', 'get_vendor',
  // relationships + serial + info
  'get_customer_contacts', 'get_customer_tickets', 'get_customer_assets',
  'get_customer_invoices', 'get_customer_estimates', 'get_customer_payments',
  'get_customer_schedules', 'get_customer_policies',
  'get_ticket_comments', 'get_ticket_time_entries', 'get_ticket_line_items',
  'get_ticket_invoices', 'get_ticket_estimates', 'get_ticket_appointments',
  'get_ticket_worksheets',
  'get_invoice_payments', 'get_invoice_ticket',
  'get_vendor_purchase_orders', 'get_product_tickets', 'lookup_serial',
  'get_sync_status', 'get_sync_last_results', 'get_system_version',
]);

test('all expected tools are registered and discoverable', async () => {
  const client = await connectTestClient();
  const list = await client.listTools();
  const names = new Set(list.tools.map((t) => t.name));

  const missing = [...EXPECTED_TOOLS].filter((n) => !names.has(n));
  assert.deepEqual(missing, [], `missing tools: ${missing.join(', ')}`);

  // No unexpected tools either — catches accidental double-registration.
  const extra = [...names].filter((n) => !EXPECTED_TOOLS.has(n));
  assert.deepEqual(extra, [], `unexpected extra tools: ${extra.join(', ')}`);

  assert.equal(names.size, EXPECTED_TOOLS.size, `expected ${EXPECTED_TOOLS.size} tools, got ${names.size}`);
  await client.close();
});

test('every tool has a non-empty description and input schema', async () => {
  const client = await connectTestClient();
  const list = await client.listTools();
  for (const tool of list.tools) {
    assert.ok(tool.description && tool.description.length > 10, `${tool.name} missing description`);
    assert.ok(tool.inputSchema && typeof tool.inputSchema === 'object', `${tool.name} missing inputSchema`);
  }
  await client.close();
});

test('list_customers exposes pagination + filter inputs', async () => {
  const client = await connectTestClient();
  const list = await client.listTools();
  const tool = list.tools.find((t) => t.name === 'list_customers');
  assert.ok(tool, 'list_customers missing');
  const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties || {};
  for (const key of ['page', 'limit', 'search', 'filter_email', 'sortCol', 'sortDir']) {
    assert.ok(key in props, `list_customers should accept ${key}`);
  }
  await client.close();
});
