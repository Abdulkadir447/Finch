/**
 * Co-op local data layer — repositories (OFFLINE 1, foundation for OFFLINE 2).
 *
 * Local-first: every write is a local SQLite transaction that (1) updates the
 * local source of truth and (2) enqueues a sync operation carrying the row's
 * client_id as its idempotency key. The UI sees the change immediately, fully
 * offline (ADR-002).
 *
 * These are the data-layer primitives. OFFLINE 2 wires the React UI to call
 * these (via IPC) instead of FastAPI for core operations.
 */
'use strict';

const { ulid } = require('./ids');

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Business (local tenant root)
// ---------------------------------------------------------------------------
class BusinessRepository {
  constructor(db) {
    this.db = db;
  }

  /** Ensure a local business row exists (idempotent by client_id). */
  ensure({ client_id, name, currency = 'USD' }) {
    let row = this.db.prepare(`SELECT * FROM business WHERE client_id=?`).get(client_id);
    if (row) return row;
    const r = this.db
      .prepare(`INSERT INTO business (client_id, name, currency) VALUES (?, ?, ?)`)
      .run(client_id, name, currency);
    return this.db.prepare(`SELECT * FROM business WHERE id=?`).get(Number(r.lastInsertRowid));
  }

  get(id) {
    return this.db.prepare(`SELECT * FROM business WHERE id=?`).get(id);
  }

  update(id, { name, currency }) {
    this.db
      .prepare(`UPDATE business SET name=COALESCE(?, name), currency=COALESCE(?, currency), updated_at=? WHERE id=?`)
      .run(name ?? null, currency ?? null, now(), id);
    return this.get(id);
  }
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
class CustomerRepository {
  constructor(db, queue) {
    this.db = db;
    this.queue = queue;
  }

  create(business_id, { full_name, email, phone, company, address }) {
    const client_id = ulid();
    const r = this.db
      .prepare(
        `INSERT INTO customers (client_id, business_id, full_name, email, phone, company, address, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(client_id, business_id, full_name, email ?? null, phone ?? null, company ?? null, address ?? null, now());
    const id = Number(r.lastInsertRowid);
    const row = this.get(id);
    this.queue.enqueue({ business_id, entity: 'customer', entity_id: id, client_id, operation: 'create', payload: row });
    return row;
  }

  update(id, { full_name, email, phone, company, address }) {
    this.db
      .prepare(
        `UPDATE customers SET
           full_name=COALESCE(?, full_name), email=COALESCE(?, email), phone=COALESCE(?, phone),
           company=COALESCE(?, company), address=COALESCE(?, address), updated_at=?
         WHERE id=?`
      )
      .run(full_name ?? null, email ?? null, phone ?? null, company ?? null, address ?? null, now(), id);
    const row = this.get(id);
    this.queue.enqueue({ business_id: row.business_id, entity: 'customer', entity_id: id, client_id: row.client_id, operation: 'update', payload: row });
    return row;
  }

  softDelete(id) {
    this.db.prepare(`UPDATE customers SET deleted_at=?, updated_at=? WHERE id=?`).run(now(), now(), id);
    const row = this.db.prepare(`SELECT * FROM customers WHERE id=?`).get(id);
    this.queue.enqueue({ business_id: row.business_id, entity: 'customer', entity_id: id, client_id: row.client_id, operation: 'delete', payload: { client_id: row.client_id } });
    return row;
  }

  get(id) {
    return this.db.prepare(`SELECT * FROM customers WHERE id=? AND deleted_at IS NULL`).get(id);
  }

  list(business_id, { limit = 200 } = {}) {
    return this.db
      .prepare(`SELECT * FROM customers WHERE business_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`)
      .all(business_id, limit);
  }
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
class ProductRepository {
  constructor(db, queue) {
    this.db = db;
    this.queue = queue;
  }

  create(business_id, { name, sku, category, description, unit_price, cost_price, current_stock = 0, reorder_level = 0 }) {
    const client_id = ulid();
    const r = this.db
      .prepare(
        `INSERT INTO products (client_id, business_id, name, sku, category, description, unit_price, cost_price, current_stock, reorder_level, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(client_id, business_id, name, sku ?? null, category ?? null, description ?? null,
        unit_price ?? null, cost_price ?? null, current_stock, reorder_level, now());
    const id = Number(r.lastInsertRowid);
    const row = this.get(id);
    this.queue.enqueue({ business_id, entity: 'product', entity_id: id, client_id, operation: 'create', payload: row });
    // Initial stock (if any) is a ledger movement. The stock is ALREADY in the
    // row from the INSERT above, so this only records the ledger entry +
    // enqueues the sync op — it must NOT re-apply the quantity.
    if (current_stock) this._recordInitialStock(business_id, id, current_stock);
    return row;
  }

  update(id, fields) {
    this.db
      .prepare(
        `UPDATE products SET
           name=COALESCE(?, name), sku=COALESCE(?, sku), category=COALESCE(?, category),
           description=COALESCE(?, description), unit_price=COALESCE(?, unit_price),
           cost_price=COALESCE(?, cost_price), reorder_level=COALESCE(?, reorder_level), updated_at=?
         WHERE id=?`
      )
      .run(fields.name ?? null, fields.sku ?? null, fields.category ?? null, fields.description ?? null,
        fields.unit_price ?? null, fields.cost_price ?? null, fields.reorder_level ?? null, now(), id);
    const row = this.get(id);
    this.queue.enqueue({ business_id: row.business_id, entity: 'product', entity_id: id, client_id: row.client_id, operation: 'update', payload: row });
    return row;
  }

  softDelete(id) {
    this.db.prepare(`UPDATE products SET deleted_at=?, updated_at=? WHERE id=?`).run(now(), now(), id);
    const row = this.db.prepare(`SELECT * FROM products WHERE id=?`).get(id);
    this.queue.enqueue({ business_id: row.business_id, entity: 'product', entity_id: id, client_id: row.client_id, operation: 'delete', payload: { client_id: row.client_id } });
    return row;
  }

  get(id) {
    return this.db.prepare(`SELECT * FROM products WHERE id=? AND deleted_at IS NULL`).get(id);
  }

  list(business_id, { limit = 200 } = {}) {
    return this.db
      .prepare(`SELECT * FROM products WHERE business_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`)
      .all(business_id, limit);
  }

  /**
   * Record the initial-stock ledger entry for a freshly created product.
   * The stock value is already persisted by the product INSERT, so this only
   * appends the movement row + enqueues its sync op (no stock mutation).
   */
  _recordInitialStock(business_id, product_id, initialStock) {
    const product = this.get(product_id);
    const mc = ulid();
    const r = this.db
      .prepare(`INSERT INTO stock_movements (client_id, business_id, product_id, change, reason, note, order_id, created_at)
                VALUES (?, ?, ?, ?, 'initial', NULL, NULL, ?)`)
      .run(mc, business_id, product_id, initialStock, now());
    this.queue.enqueue({
      business_id, entity: 'stock_movement', entity_id: Number(r.lastInsertRowid), client_id: mc, operation: 'create',
      payload: { product_client_id: product.client_id, change: initialStock, reason: 'initial', note: null, order_id: null, applied_at: now() },
    });
  }
}

// ---------------------------------------------------------------------------
// Stock (operation-based, ADR-002 rule 5)
// ---------------------------------------------------------------------------
class StockRepository {
  constructor(db, queue, products) {
    this.db = db;
    this.queue = queue;
    this.products = products;
  }

  /** Apply a signed stock change + record a movement (offline-safe). */
  adjust(business_id, product_id, change, reason = 'correction', { order_id = null, note = null } = {}) {
    if (change === 0) throw new Error('Stock change must be non-zero');
    const product = this.products.get(product_id);
    if (!product) throw new Error(`Product ${product_id} not found`);
    const newStock = (product.current_stock || 0) + change;
    if (newStock < 0) throw new Error(`Insufficient stock: ${product.current_stock} available`);
    this.db.tx(() => {
      this.db.prepare(`UPDATE products SET current_stock=?, updated_at=? WHERE id=?`).run(newStock, now(), product_id);
      const mc = ulid();
      const r = this.db
        .prepare(`INSERT INTO stock_movements (client_id, business_id, product_id, change, reason, note, order_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(mc, business_id, product_id, change, reason, note ?? null, order_id ?? null, now());
      this.queue.enqueue({
        business_id, entity: 'stock_movement', entity_id: Number(r.lastInsertRowid), client_id: mc, operation: 'create',
        payload: { product_client_id: product.client_id, change, reason, note, order_id, applied_at: now() },
      });
    });
    return this.products.get(product_id);
  }

  movements(business_id, product_id = null, { limit = 100 } = {}) {
    if (product_id != null) {
      return this.db
        .prepare(`SELECT * FROM stock_movements WHERE business_id=? AND product_id=? ORDER BY id DESC LIMIT ?`)
        .all(business_id, product_id, limit);
    }
    return this.db
      .prepare(`SELECT * FROM stock_movements WHERE business_id=? ORDER BY id DESC LIMIT ?`)
      .all(business_id, limit);
  }
}

// ---------------------------------------------------------------------------
// Orders (create deducts stock; status changes may restore it)
// ---------------------------------------------------------------------------
class OrderRepository {
  constructor(db, queue, products, stock) {
    this.db = db;
    this.queue = queue;
    this.products = products;
    this.stock = stock;
  }

  /**
   * Create an order with line items; deducts stock and records movements,
   * all in one local transaction. items: [{ product_id, quantity, unit_price }].
   */
  create(business_id, { customer_id, items, order_date = null }) {
    const order_client_id = ulid();
    return this.db.tx(() => {
      const total = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
      const r = this.db
        .prepare(
          `INSERT INTO orders (client_id, business_id, customer_id, status, total_amount, order_date, updated_at)
           VALUES (?, ?, ?, 'pending', ?, ?, ?)`
        )
        .run(order_client_id, business_id, customer_id, total, order_date ?? now(), now());
      const order_id = Number(r.lastInsertRowid);

      for (const it of items) {
        const line_client_id = ulid();
        this.db
          .prepare(
            `INSERT INTO order_items (client_id, business_id, order_id, product_id, quantity, unit_price, total_price)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(line_client_id, business_id, order_id, it.product_id, it.quantity, it.unit_price, it.quantity * it.unit_price);
        const item = this.db.prepare(`SELECT * FROM order_items WHERE client_id=?`).get(line_client_id);
        this.queue.enqueue({ business_id, entity: 'order_item', entity_id: item.id, client_id: line_client_id, operation: 'create', payload: item });
        // Deduct stock (operation-based) — mirrors the server's create-time deduction.
        const product = this.products.get(it.product_id);
        if (product) {
          this.stock._adjustInline(business_id, it.product_id, -it.quantity, 'order', { order_id });
        }
      }

      const order = this.get(order_id);
      this.queue.enqueue({ business_id, entity: 'order', entity_id: order_id, client_id: order_client_id, operation: 'create', payload: order });
      return order;
    });
  }

  /** Change status; cancelling a non-cancelled order restores its stock. */
  setStatus(business_id, order_id, status) {
    const order = this.get(order_id);
    if (!order) throw new Error(`Order ${order_id} not found`);
    const prev = order.status;
    this.db.prepare(`UPDATE orders SET status=?, updated_at=? WHERE id=?`).run(status, now(), order_id);
    const updated = this.get(order_id);
    this.queue.enqueue({ business_id, entity: 'order', entity_id: order_id, client_id: order.client_id, operation: 'update', payload: updated });
    // Cancellation restores stock exactly once (mirrors the server rule).
    if (status === 'cancelled' && prev !== 'cancelled') {
      this.db.tx(() => {
        const items = this.db.prepare(`SELECT * FROM order_items WHERE order_id=?`).all(order_id);
        for (const it of items) {
          this.stock._adjustInline(business_id, it.product_id, it.quantity, 'order_cancelled', { order_id });
        }
      });
    }
    return updated;
  }

  get(order_id) {
    return this.db.prepare(`SELECT * FROM orders WHERE id=? AND deleted_at IS NULL`).get(order_id);
  }

  items(order_id) {
    return this.db.prepare(`SELECT * FROM order_items WHERE order_id=?`).all(order_id);
  }

  list(business_id, { limit = 200 } = {}) {
    return this.db
      .prepare(`SELECT * FROM orders WHERE business_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`)
      .all(business_id, limit);
  }
}

// Inline stock adjustment shared by StockRepository and OrderRepository.
// (Kept on StockRepository to keep one code path for stock math.)
StockRepository.prototype._adjustInline = function (business_id, product_id, change, reason = 'correction', { order_id = null, note = null } = {}) {
  const product = this.products.get(product_id);
  if (!product) return;
  const newStock = (product.current_stock || 0) + change;
  if (newStock < 0) return; // offline create shouldn't hard-fail the order on stock; server re-validates
  this.db.prepare(`UPDATE products SET current_stock=?, updated_at=? WHERE id=?`).run(newStock, now(), product_id);
  const mc = ulid();
  const r = this.db
    .prepare(`INSERT INTO stock_movements (client_id, business_id, product_id, change, reason, note, order_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(mc, business_id, product_id, change, reason, note ?? null, order_id ?? null, now());
  this.queue.enqueue({
    business_id, entity: 'stock_movement', entity_id: Number(r.lastInsertRowid), client_id: mc, operation: 'create',
    payload: { product_client_id: product.client_id, change, reason, note, order_id, applied_at: now() },
  });
};

module.exports = {
  BusinessRepository,
  CustomerRepository,
  ProductRepository,
  StockRepository,
  OrderRepository,
};
