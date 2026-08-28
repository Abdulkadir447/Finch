/**
 * Co-op local data layer — facade.
 *
 * Opens the database, runs migrations, and exposes the repositories + sync
 * queue as one object. `electron/main.js` uses this to serve IPC; the test
 * suite uses it directly. This is the single entry point to the local data
 * layer (ADR-002).
 */
'use strict';

const { open: openDb, defaultDbPath } = require('./database');
const { SyncQueue } = require('./syncQueue');
const {
  BusinessRepository,
  CustomerRepository,
  ProductRepository,
  StockRepository,
  OrderRepository,
} = require('./repositories');

/**
 * Build the data layer.
 * @param {string} file SQLite path or ':memory:'.
 * @param {object} [opts] driver options.
 */
function createDataLayer(file, opts = {}) {
  const db = openDb(file, opts);
  const queue = new SyncQueue(db);
  const business = new BusinessRepository(db);
  const customers = new CustomerRepository(db, queue);
  const products = new ProductRepository(db, queue);
  const stock = new StockRepository(db, queue, products);
  const orders = new OrderRepository(db, queue, products, stock);
  return {
    db,
    queue,
    business,
    customers,
    products,
    stock,
    orders,
    close: () => db.close(),
  };
}

module.exports = { createDataLayer, defaultDbPath };
