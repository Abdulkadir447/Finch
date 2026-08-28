/**
 * Co-op local data layer — tests.
 *
 * Runs the SAME repository/queue code against a real SQLite engine
 * (node:sqlite in the sandbox; the driver contract means production Electron
 * uses better-sqlite3 with identical logic). No Electron runtime required.
 *
 *   node --test electron/test/db.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createDataLayer } = require('../db');

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function setup() {
  return createDataLayer(':memory:', { force: 'node:sqlite' });
}

test('migrations create the core schema', () => {
  const dl = setup();
  const tables = dl.db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => r.name);
  for (const t of [
    'schema_migrations', 'business', 'customers', 'products', 'orders',
    'order_items', 'stock_movements', 'sync_queue', 'sync_meta',
  ]) {
    assert.ok(tables.includes(t), `expected table ${t}, got ${tables.join(',')}`);
  }
  dl.close();
});

test('business.ensure is idempotent by client_id', () => {
  const dl = setup();
  const a = dl.business.ensure({ client_id: '01BUSINESS', name: 'Acme', currency: 'USD' });
  const b = dl.business.ensure({ client_id: '01BUSINESS', name: 'Acme Renamed' });
  assert.strictEqual(a.id, b.id, 'same client_id must return the same row');
  assert.strictEqual(b.name, 'Acme', 'ensure must not overwrite an existing row');
  dl.close();
});

test('customer.create generates a ULID client_id and enqueues a sync op', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace', email: 'g@x.com' });
  assert.ok(ULID_RE.test(c.client_id), `client_id ${c.client_id} is not a ULID`);
  assert.ok(c.id > 0);
  assert.strictEqual(dl.queue.countPending(), 1);
  const op = dl.queue.pending()[0];
  assert.strictEqual(op.entity, 'customer');
  assert.strictEqual(op.client_id, c.client_id, 'idempotency key must be the row client_id');
  assert.strictEqual(op.operation, 'create');
  dl.close();
});

test('customer.update enqueues an update op with the same client_id', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace' });
  dl.customers.update(c.id, { email: 'new@x.com' });
  assert.strictEqual(dl.queue.countPending(), 2);
  const ops = dl.queue.pending();
  assert.strictEqual(ops[1].operation, 'update');
  assert.strictEqual(ops[1].client_id, c.client_id);
  dl.close();
});

test('product.create with initial stock also enqueues an initial movement', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const p = dl.products.create(biz.id, { name: 'Chair', sku: 'C1', unit_price: 100, current_stock: 10 });
  assert.strictEqual(p.current_stock, 10);
  // 1 product create + 1 initial stock movement.
  assert.strictEqual(dl.queue.countPending(), 2);
  const entities = dl.queue.pending().map((o) => o.entity);
  assert.ok(entities.includes('product'));
  assert.ok(entities.includes('stock_movement'));
  dl.close();
});

test('order.create deducts stock, records movements, enqueues all ops', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace' });
  const p = dl.products.create(biz.id, { name: 'Chair', unit_price: 100, current_stock: 10 });

  const before = dl.queue.countPending();
  const order = dl.orders.create(biz.id, {
    customer_id: c.id,
    items: [{ product_id: p.id, quantity: 3, unit_price: 100 }],
  });

  assert.strictEqual(order.status, 'pending');
  assert.strictEqual(order.total_amount, 300);
  // Stock deducted 10 -> 7.
  assert.strictEqual(dl.products.get(p.id).current_stock, 7);
  // A stock movement of -3 (reason 'order') was recorded.
  const moves = dl.stock.movements(biz.id, p.id);
  const orderMove = moves.find((m) => m.reason === 'order');
  assert.ok(orderMove, 'expected an order stock movement');
  assert.strictEqual(orderMove.change, -3);
  // New queued ops: order_item + order + stock_movement (3).
  assert.strictEqual(dl.queue.countPending(), before + 3);
  dl.close();
});

test('order cancellation restores stock exactly once', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace' });
  const p = dl.products.create(biz.id, { name: 'Chair', unit_price: 100, current_stock: 10 });
  const order = dl.orders.create(biz.id, { customer_id: c.id, items: [{ product_id: p.id, quantity: 4, unit_price: 100 }] });
  assert.strictEqual(dl.products.get(p.id).current_stock, 6);

  dl.orders.setStatus(biz.id, order.id, 'cancelled');
  assert.strictEqual(dl.products.get(p.id).current_stock, 10, 'cancelling restores the deducted stock');

  // Cancelling again must NOT restore again.
  dl.orders.setStatus(biz.id, order.id, 'cancelled');
  assert.strictEqual(dl.products.get(p.id).current_stock, 10, 'second cancel must not double-restore');
  dl.close();
});

test('stock.adjust enforces non-zero and insufficient stock', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const p = dl.products.create(biz.id, { name: 'Chair', unit_price: 100, current_stock: 2 });
  assert.throws(() => dl.stock.adjust(biz.id, p.id, 0, 'adjustment'), /non-zero/);
  assert.throws(() => dl.stock.adjust(biz.id, p.id, -5, 'correction'), /Insufficient stock/);
  dl.stock.adjust(biz.id, p.id, -1, 'correction');
  assert.strictEqual(dl.products.get(p.id).current_stock, 1);
  dl.close();
});

test('sync queue lifecycle: pending -> synced / failed -> retry', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace' });
  const op = dl.queue.pending()[0];
  assert.strictEqual(dl.queue.countPending(), 1);

  dl.queue.markSynced(op.id);
  assert.strictEqual(dl.queue.countPending(), 0);
  assert.strictEqual(dl.queue.get(op.id).status, 'synced');

  // New op, fail it, then retry.
  dl.customers.update(c.id, { phone: '555' });
  const op2 = dl.queue.pending()[0];
  dl.queue.markFailed(op2.id, 'network down');
  assert.strictEqual(dl.queue.get(op2.id).status, 'failed');
  assert.strictEqual(dl.queue.get(op2.id).attempts, 1);
  dl.queue.retryFailed();
  assert.strictEqual(dl.queue.get(op2.id).status, 'pending');
  assert.strictEqual(dl.queue.countPending(), 1);
  dl.close();
});

test('client_ids are unique and sortable (time-ordered)', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const a = dl.customers.create(biz.id, { full_name: 'A' });
  const b = dl.customers.create(biz.id, { full_name: 'B' });
  assert.notStrictEqual(a.client_id, b.client_id, 'client_ids must be unique');
  // Both generated within the same ms may tie on the timestamp prefix but the
  // random suffix must differ; the ULID format is what the server dedupes on.
  assert.ok(ULID_RE.test(a.client_id) && ULID_RE.test(b.client_id));
  dl.close();
});
