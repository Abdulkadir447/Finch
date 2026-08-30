/**
 * Co-op sync engine — tests (OFFLINE 3).
 *
 * Exercises the SAME mirror/push-outcome code that main.js runs, against a
 * real SQLite engine (node:sqlite in the sandbox; better-sqlite3 in the
 * production Electron — identical logic via the driver contract).
 *
 *   node --test electron/test/sync.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createDataLayer } = require('../db');
const { applyPull, markPushOutcome, getCursor } = require('../sync');

function setup() {
  return createDataLayer(':memory:', { force: 'node:sqlite' });
}

/** A /sync/pull-shaped payload (server field names, verbatim). */
function pullPayload(overrides = {}) {
  const {
    cursor = '2026-08-28T12:00:00',
    customer2 = { id: 2, client_id: null },
    orderCustomerServerId = 1,
  } = overrides;
  return {
    cursor,
    since: null,
    business: { id: 7, name: 'Cloud Co', currency: 'USD', updated_at: '2026-08-28T00:00:00' },
    customers: [
      // Client-created: carries its ULID (the local row keeps the same key).
      { id: 1, client_id: 'CUST-ULID-1', full_name: 'Grace', email: 'g@x.com',
        phone: null, address: null, company: null, deleted_at: null, updated_at: '2026-08-01T00:00:00' },
      // Cloud-native: client_id is null -> mirrors under the synthetic srv-2 key.
      { id: 2, client_id: customer2.client_id, full_name: 'Cloud Customer', email: 'c@x.com',
        phone: null, address: null, company: null, deleted_at: null, updated_at: '2026-08-02T00:00:00' },
    ],
    products: [
      { id: 11, client_id: 'PROD-ULID-1', sku: 'C1', name: 'Chair', description: null, category: null,
        unit_price: 100, cost_price: 40, current_stock: 10, reorder_level: 5,
        deleted_at: null, updated_at: '2026-08-01T00:00:00' },
    ],
    orders: [
      { id: 21, client_id: 'ORD-ULID-1', customer_id: orderCustomerServerId, status: 'pending',
        total_amount: 200, order_date: '2026-08-28T12:00:00', deleted_at: null, updated_at: '2026-08-28T12:00:00' },
    ],
    order_items: [
      { id: 31, client_id: 'ORDIT-ULID-1', order_id: 21, product_id: 11, quantity: 2,
        unit_price: 100, total_price: 200, deleted_at: null, updated_at: '2026-08-28T12:00:00' },
    ],
    stock_movements: [
      { id: 41, client_id: 'MOVE-ULID-1', product_id: 11, change: 10, reason: 'initial',
        note: null, order_id: null, created_at: '2026-08-01T00:00:00' },
    ],
    counts: { customers: 2, products: 1, orders: 1, order_items: 1, stock_movements: 1 },
  };
}

test('full pull populates the mirror with stable identity mapping', () => {
  const dl = setup();
  const payload = pullPayload();
  const res = applyPull(dl, payload, { full: true });

  assert.strictEqual(res.business_id, 1, 'local business row is created');
  assert.strictEqual(getCursor(dl.db), payload.cursor, 'cursor stored after success');

  // Business is keyed by String(server id) — the identity.ts convention.
  const biz = dl.db.prepare(`SELECT * FROM business`).get();
  assert.strictEqual(biz.client_id, '7');
  assert.strictEqual(biz.name, 'Cloud Co');

  // id_map: server id -> local id for every mirrored row.
  const custMap = dl.db.prepare(`SELECT local_id FROM id_map WHERE entity='customer' AND server_id=1`).get();
  assert.ok(custMap, 'customer mapping recorded');

  // The mirrored order references the LOCAL customer id, not the server id.
  const order = dl.db.prepare(`SELECT * FROM orders WHERE client_id='ORD-ULID-1'`).get();
  assert.strictEqual(order.customer_id, Number(custMap.local_id));
  const item = dl.db.prepare(`SELECT * FROM order_items WHERE client_id='ORDIT-ULID-1'`).get();
  assert.strictEqual(item.order_id, order.id);
  const prodMap = dl.db.prepare(`SELECT local_id FROM id_map WHERE entity='product' AND server_id=11`).get();
  assert.strictEqual(item.product_id, Number(prodMap.local_id));

  dl.close();
});

test('cloud-native rows mirror under the synthetic srv-<id> key', () => {
  const dl = setup();
  applyPull(dl, pullPayload(), { full: true });
  const row = dl.db.prepare(`SELECT * FROM customers WHERE client_id='srv-2'`).get();
  assert.ok(row, 'cloud-native customer has a stable synthetic key');
  assert.strictEqual(row.full_name, 'Cloud Customer');
  dl.close();
});

test('full pull is idempotent — re-applying changes nothing', () => {
  const dl = setup();
  applyPull(dl, pullPayload(), { full: true });
  const before = dl.db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE business_id=1`).get().n;
  applyPull(dl, pullPayload(), { full: true });
  const after = dl.db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE business_id=1`).get().n;
  assert.strictEqual(after, before, 'no duplicates on re-pull');
  dl.close();
});

test('full pull verifies counts and rolls back on mismatch', () => {
  const dl = setup();
  const payload = pullPayload();
  applyPull(dl, payload, { full: true });
  assert.strictEqual(getCursor(dl.db), payload.cursor);

  // Corrupt the counts: the upsert would "succeed" but the mirror would
  // silently disagree with the cloud — verification must refuse it and roll
  // back, keeping the OLD cursor (so the next delta re-covers the gap).
  const bad = pullPayload({ cursor: '2026-08-29T00:00:00' });
  bad.counts.customers = 99;
  assert.throws(
    () => applyPull(dl, bad, { full: true }),
    /mirror verification failed/,
  );
  assert.strictEqual(getCursor(dl.db), payload.cursor, 'cursor unchanged after a failed pull');
  dl.close();
});

test('delta pull updates only the changed rows and advances the cursor', () => {
  const dl = setup();
  applyPull(dl, pullPayload(), { full: true });
  const graceBefore = dl.db.prepare(`SELECT email FROM customers WHERE client_id='CUST-ULID-1'`).get();

  const delta = pullPayload({ cursor: '2026-08-29T00:00:00' });
  delta.customers = [
    { id: 1, client_id: 'CUST-ULID-1', full_name: 'Grace Updated', email: 'g2@x.com',
      phone: null, address: null, company: null, deleted_at: null, updated_at: '2026-08-29T00:00:00' },
  ];
  delta.counts = { customers: 1, products: 0, orders: 0, order_items: 0, stock_movements: 0 };

  applyPull(dl, delta, { full: false }); // delta: no total-count verification
  assert.strictEqual(
    dl.db.prepare(`SELECT email FROM customers WHERE client_id='CUST-ULID-1'`).get().email,
    'g2@x.com',
  );
  assert.strictEqual(graceBefore.email, 'g@x.com');
  // Untouched rows survive the delta.
  assert.ok(dl.db.prepare(`SELECT * FROM customers WHERE client_id='srv-2'`).get());
  assert.strictEqual(getCursor(dl.db), '2026-08-29T00:00:00');
  dl.close();
});

test('delta referencing an unknown row throws (engine recovers via full pull)', () => {
  const dl = setup();
  applyPull(dl, pullPayload(), { full: true });
  const delta = pullPayload({ cursor: '2026-08-29T00:00:00' });
  delta.orders = [
    // References customer 999, which was never mirrored.
    { id: 51, client_id: 'ORD-X', customer_id: 999, status: 'pending',
      total_amount: 1, order_date: '2026-08-29T00:00:00', deleted_at: null, updated_at: '2026-08-29T00:00:00' },
  ];
  delta.counts = { customers: 0, products: 0, orders: 1, order_items: 0, stock_movements: 0 };
  assert.throws(() => applyPull(dl, delta, { full: false }), /not in the local mapping/);
  dl.close();
});

test('soft delete propagates both ways (delete then resurrect)', () => {
  const dl = setup();
  applyPull(dl, pullPayload(), { full: true });

  const deleted = pullPayload({ cursor: '2026-08-30T00:00:00' });
  deleted.customers = [
    { id: 1, client_id: 'CUST-ULID-1', full_name: 'Grace', email: 'g@x.com',
      phone: null, address: null, company: null, deleted_at: '2026-08-30T00:00:00', updated_at: '2026-08-30T00:00:00' },
  ];
  deleted.counts = { customers: 1, products: 0, orders: 0, order_items: 0, stock_movements: 0 };
  applyPull(dl, deleted, { full: false });
  assert.ok(
    dl.db.prepare(`SELECT deleted_at FROM customers WHERE client_id='CUST-ULID-1'`).get().deleted_at,
    'soft delete mirrored locally',
  );

  const alive = pullPayload({ cursor: '2026-08-31T00:00:00' });
  alive.customers = [
    { id: 1, client_id: 'CUST-ULID-1', full_name: 'Grace', email: 'g@x.com',
      phone: null, address: null, company: null, deleted_at: null, updated_at: '2026-08-31T00:00:00' },
  ];
  alive.counts = { customers: 1, products: 0, orders: 0, order_items: 0, stock_movements: 0 };
  applyPull(dl, alive, { full: false });
  assert.strictEqual(
    dl.db.prepare(`SELECT deleted_at FROM customers WHERE client_id='CUST-ULID-1'`).get().deleted_at,
    null,
    'deletion cleared when the row is alive on the cloud',
  );
  dl.close();
});

test('stock movements dedupe by client_id (offline movement + server echo)', () => {
  const dl = setup();
  applyPull(dl, pullPayload(), { full: true });
  const one = dl.db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE business_id=1`).get().n;

  // The same movement (same client_id) comes back after push: no duplicate.
  const echo = pullPayload({ cursor: '2026-08-29T00:00:00' });
  echo.stock_movements = [
    { id: 41, client_id: 'MOVE-ULID-1', product_id: 11, change: 10, reason: 'initial',
      note: null, order_id: null, created_at: '2026-08-01T00:00:00' },
  ];
  echo.counts = { customers: 0, products: 0, orders: 0, order_items: 0, stock_movements: 1 };
  applyPull(dl, echo, { full: false });
  const two = dl.db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE business_id=1`).get().n;
  assert.strictEqual(two, one, 'the ledger is append-once per client_id');
  dl.close();
});

// ---------------------------------------------------------------------------
// Push outcome marking
// ---------------------------------------------------------------------------

test('markPushOutcome syncs acknowledged ops and fails refused ones', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace', email: 'g@x.com' });
  const c2 = dl.customers.create(biz.id, { full_name: 'Bad', email: 'b@x.com' });
  assert.strictEqual(dl.queue.countPending(), 2);

  const out = markPushOutcome(dl, {
    applied: 1, skipped: 0,
    ids: { [c.client_id]: 101 },
    errors: [{ client_id: c2.client_id, entity: 'customer', error: 'email taken' }],
  });
  assert.deepStrictEqual(out, { synced: 1, conflicts: 0, failed: 1 });

  const byClient = new Map([dl.queue.get(1), dl.queue.get(2)].map((op) => [op.client_id, op.status]));
  assert.strictEqual(byClient.get(c.client_id), 'synced');
  assert.strictEqual(byClient.get(c2.client_id), 'failed');
  const failedOp = [dl.queue.get(1), dl.queue.get(2)].find((op) => op.client_id === c2.client_id);
  assert.match(failedOp.last_error, /email taken/);
  dl.close();
});

test('failed ops go back to pending on retryFailed', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  dl.customers.create(biz.id, { full_name: 'Grace', email: 'g@x.com' });
  markPushOutcome(dl, {
    applied: 0, skipped: 0, ids: {},
    errors: [{ client_id: dl.customers.list(biz.id)[0].client_id, entity: 'customer', error: 'boom' }],
  });
  assert.strictEqual(dl.queue.countPending(), 0);
  dl.queue.retryFailed();
  assert.strictEqual(dl.queue.countPending(), 1, 'the failed op is retriable');
  dl.close();
});

// ---------------------------------------------------------------------------
// Local order writes produce SERVER-VALID push payloads (reference gap fix)
// ---------------------------------------------------------------------------

test('local order create enqueues ops with client-id references', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace', email: 'g@x.com' });
  const p = dl.products.create(biz.id, { name: 'Chair', sku: 'C1', unit_price: 100, current_stock: 10 });

  dl.orders.create(biz.id, {
    customer_id: c.id,
    items: [{ product_id: p.id, quantity: 2, unit_price: 100 }],
  });

  const ops = dl.queue.pending();
  const orderOp = ops.find((o) => o.entity === 'order');
  const itemOp = ops.find((o) => o.entity === 'order_item');
  const moveOp = ops.find((o) => o.entity === 'stock_movement' && o.payload.reason === 'order');

  // What the server's _apply_order / _apply_order_item / _apply_stock_movement
  // read — every cross-reference must be a CLIENT id (ADR-002 reference
  // resolution), never a local integer.
  assert.strictEqual(orderOp.payload.customer_client_id, c.client_id);
  assert.strictEqual(itemOp.payload.order_client_id, orderOp.client_id);
  assert.strictEqual(itemOp.payload.product_client_id, p.client_id);
  assert.ok(moveOp, 'the order deduction is queued as its own movement op');
  assert.strictEqual(moveOp.payload.product_client_id, p.client_id);
  assert.strictEqual(moveOp.payload.change, -2, 'offline deduction is an operation');
  dl.close();
});

test('pendingOrderIds lists orders awaiting push', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace', email: 'g@x.com' });
  const p = dl.products.create(biz.id, { name: 'Chair', sku: 'C1', unit_price: 100, current_stock: 10 });
  const o = dl.orders.create(biz.id, { customer_id: c.id, items: [{ product_id: p.id, quantity: 1, unit_price: 100 }] });

  assert.deepStrictEqual(dl.queue.pendingOrderIds(), [o.id]);

  // After the batch is acknowledged, the chip disappears.
  const orderOp = dl.queue.pending().find((x) => x.entity === 'order');
  markPushOutcome(dl, {
    applied: 1, skipped: 0, ids: { [orderOp.client_id]: 500 },
    errors: [],
  });
  // Other ops (items/movements) are still pending, but the ORDER op is done.
  assert.deepStrictEqual(dl.queue.pendingOrderIds(), [], 'no pending order ops');
  dl.close();
});

// ---------------------------------------------------------------------------
// OFFLINE 4 — conflict state: parked, never auto-retried, fully retained
// ---------------------------------------------------------------------------

const EMAIL_CONFLICT = {
  operation_id: '77',
  entity: 'customer',
  client_id: 'CUST-B',
  reason: 'email_conflict',
  error: 'customer CUST-B: email already belongs to customer 3',
  local: { email: 'dup@x.com', full_name: 'B' },
  server: { id: 3, client_id: 'CUST-A', full_name: 'A', email: 'dup@x.com' },
};

test('markPushOutcome parks a conflicting op as conflict (not failed/synced)', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const a = dl.customers.create(biz.id, { full_name: 'A', email: 'a@x.com' });
  const b = dl.customers.create(biz.id, { full_name: 'B', email: 'b@x.com' });
  const out = markPushOutcome(dl, {
    applied: 1, skipped: 0,
    ids: { [a.client_id]: 101 },
    conflicts: [{ ...EMAIL_CONFLICT, client_id: b.client_id, operation_id: String(b.id) }],
    failed: [],
  });
  assert.deepStrictEqual(out, { synced: 1, conflicts: 1, failed: 0 });
  const bOp = dl.queue.get(b.id);
  assert.strictEqual(bOp.status, 'conflict');
  // The original payload is untouched; the structured conflict is retained.
  assert.strictEqual(bOp.payload.email, 'b@x.com', 'original payload retained');
  const kept = JSON.parse(bOp.last_error);
  assert.strictEqual(kept.reason, 'email_conflict', 'conflict reason retained');
  assert.strictEqual(kept.server.client_id, 'CUST-A', 'server snapshot retained');
  assert.strictEqual(kept.operation_id, String(b.id), 'operation_id retained');
  dl.close();
});

test('a conflict is NOT retried automatically (unlike a failed op)', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace', email: 'g@x.com' });
  const cid = c.client_id;
  markPushOutcome(dl, {
    applied: 0, skipped: 0, ids: {},
    conflicts: [{ ...EMAIL_CONFLICT, client_id: cid }],
    failed: [],
  });
  assert.strictEqual(dl.queue.countPending(), 0);
  assert.strictEqual(dl.queue.countConflicts(), 1);

  dl.queue.retryFailed();
  assert.strictEqual(dl.queue.countPending(), 0, 'retryFailed does NOT re-arm conflicts');
  assert.strictEqual(dl.queue.get(c.id).status, 'conflict', 'still parked after retryFailed');

  // Conflicts are visible for OFFLINE 5's resolution UI, with the reason.
  const parked = dl.queue.conflicts();
  assert.strictEqual(parked.length, 1);
  assert.strictEqual(parked[0].conflict.reason, 'email_conflict');
  assert.strictEqual(parked[0].payload.email, 'g@x.com');
  dl.close();
});

test('subsequent normal operations keep syncing around a parked conflict', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const stuck = dl.customers.create(biz.id, { full_name: 'Stuck', email: 's@x.com' });
  markPushOutcome(dl, {
    applied: 0, skipped: 0, ids: {},
    conflicts: [{ ...EMAIL_CONFLICT, client_id: stuck.client_id }],
    failed: [],
  });

  // A NEW local write must still flow through the queue and sync.
  const fresh = dl.customers.create(biz.id, { full_name: 'Fresh', email: 'f@x.com' });
  assert.deepStrictEqual(dl.queue.pending().map((o) => o.client_id), [fresh.client_id],
    'the parked conflict is excluded from the push batch');

  markPushOutcome(dl, {
    applied: 1, skipped: 0, ids: { [fresh.client_id]: 202 },
    conflicts: [], failed: [],
  });
  assert.strictEqual(dl.queue.get(fresh.id).status, 'synced');
  assert.strictEqual(dl.queue.get(stuck.id).status, 'conflict', 'the conflict stays parked');
  assert.strictEqual(dl.queue.countConflicts(), 1);
  dl.close();
});

// ---------------------------------------------------------------------------
// OFFLINE 5 — resolution primitives: requeue / resolve / local corrections
// ---------------------------------------------------------------------------

test('requeue turns a parked conflict back into a pending op (payload corrected)', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace', email: 'dup@x.com' });
  markPushOutcome(dl, {
    applied: 0, skipped: 0, ids: {},
    conflicts: [{ operation_id: String(c.id), entity: 'customer', client_id: c.client_id,
      reason: 'email_conflict', error: 'email taken', local: { email: 'dup@x.com' }, server: null }],
    failed: [],
  });
  assert.strictEqual(dl.queue.get(c.id).status, 'conflict');

  const requeued = dl.queue.requeue(c.id, { email: 'unique@x.com' });
  assert.strictEqual(requeued.status, 'pending', 'back in the push queue');
  assert.strictEqual(requeued.payload.email, 'unique@x.com', 'corrected value applied');
  assert.strictEqual(requeued.payload.full_name, 'Grace', 'untouched fields preserved');
  assert.strictEqual(requeued.last_error, null, 'conflict info cleared on requeue');
  assert.strictEqual(dl.queue.countConflicts(), 0);
  assert.strictEqual(dl.queue.countPending(), 1);

  // Requeue is only valid for parked conflicts.
  assert.strictEqual(dl.queue.requeue(c.id, {}), null, 'a pending op cannot be re-queued');
  dl.close();
});

test('resolveConflict parks the op in a terminal resolved state', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Grace', email: 'g@x.com' });
  dl.queue.markConflict(c.id, { reason: 'email_conflict' });

  dl.queue.resolveConflict(c.id);
  const op = dl.queue.get(c.id);
  assert.strictEqual(op.status, 'resolved');
  assert.strictEqual(dl.queue.countConflicts(), 0);
  assert.strictEqual(dl.queue.countPending(), 0);
  assert.strictEqual(dl.queue.conflicts().length, 0, 'no longer needs attention');
  // Even retryFailed cannot resurrect it.
  dl.queue.retryFailed();
  assert.strictEqual(dl.queue.get(c.id).status, 'resolved');
  dl.close();
});

test('discardLocal soft-deletes a never-synced row WITHOUT queueing an op', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const c = dl.customers.create(biz.id, { full_name: 'Ghost', email: 'ghost@x.com' });
  const p = dl.products.create(biz.id, { name: 'Ghost P', sku: 'G1', unit_price: 1 });
  const pendingBefore = dl.queue.countPending();

  dl.customers.discardLocal(c.id);
  dl.products.discardLocal(p.id);

  assert.ok(!dl.customers.get(c.id), 'customer soft-deleted');
  assert.ok(!dl.products.get(p.id), 'product soft-deleted');
  assert.strictEqual(dl.queue.countPending(), pendingBefore, 'no delete op was queued');
  dl.close();
});

test('setLocalStock corrects the row and the ledger without queueing', () => {
  const dl = setup();
  const biz = dl.business.ensure({ client_id: 'B1', name: 'Acme' });
  const p = dl.products.create(biz.id, { name: 'Chair', sku: 'C1', unit_price: 100, current_stock: 8 });
  // The offline order already deducted 2 locally (8 -> 6); the cloud refused
  // it (its stock was lower). Resolution: align local to the cloud value 7.
  dl.products.update(p.id, { current_stock: undefined }); // no-op keep
  const pendingBefore = dl.queue.countPending();

  dl.stock.setLocalStock(p.id, 7, 'aligned to cloud stock');
  assert.strictEqual(dl.products.get(p.id).current_stock, 7, 'row corrected');
  assert.strictEqual(dl.queue.countPending(), pendingBefore, 'correction is local-only');
  const movements = dl.stock.movements(biz.id, p.id);
  const corr = movements.find((m) => m.reason === 'correction' && m.change === -1);
  assert.ok(corr, 'a signed correction ledger entry was recorded');
  dl.close();
});
