/**
 * Unit tests for the pure helpers: context hygiene (raw_json stripping),
 * pagination clamping, pluralization, and the bearer-token auth check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripRawJson } from '../backend-client.js';
import { clampLimit, plural } from '../tools/entities.js';
import { extractBearer, timingSafeEqualString } from '../auth.js';

test('stripRawJson removes raw_json at every depth', () => {
  const input = {
    id: 1,
    raw_json: '{"big":"blob"}',
    name: 'Acme',
    contacts: [{ id: 2, raw_json: 'x', email: 'a@b.c' }],
  };
  assert.deepEqual(stripRawJson(input), {
    id: 1,
    name: 'Acme',
    contacts: [{ id: 2, email: 'a@b.c' }],
  });
});

test('stripRawJson preserves non-object values', () => {
  assert.equal(stripRawJson('hello'), 'hello');
  assert.equal(stripRawJson(42), 42);
  assert.equal(stripRawJson(null), null);
  assert.deepEqual(stripRawJson([1, { raw_json: 'x', a: 1 }]), [1, { a: 1 }]);
});

test('clampLimit defaults and caps', () => {
  assert.equal(clampLimit(undefined), 25);
  assert.equal(clampLimit(0), 25);
  assert.equal(clampLimit(-5), 25);
  assert.equal(clampLimit(NaN), 25);
  assert.equal(clampLimit(10), 10);
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit(1000), 50); // capped
});

test('plural follows the rules used for tool names', () => {
  assert.equal(plural('customer'), 'customers');
  assert.equal(plural('ticket'), 'tickets');
  assert.equal(plural('policy_folder'), 'policy_folders');
  assert.equal(plural('appointment_type'), 'appointment_types');
});

test('extractBearer parses the header', () => {
  assert.equal(extractBearer('Bearer abc123'), 'abc123');
  assert.equal(extractBearer('Bearer  abc123  '), 'abc123');
  assert.equal(extractBearer('Basic abc'), null);
  assert.equal(extractBearer(undefined), null);
  assert.equal(extractBearer('Bearer '), null);
});

test('timingSafeEqualString matches equal and rejects unequal', () => {
  assert.ok(timingSafeEqualString('secret', 'secret'));
  assert.ok(!timingSafeEqualString('secret', 'secre'));
  assert.ok(!timingSafeEqualString('secret', 'Secret'));
  assert.ok(!timingSafeEqualString('', 'x'));
  assert.ok(timingSafeEqualString('', ''));
});
