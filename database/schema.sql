-- SQLite Schema for Co-op (BSD Chapter 1 backend foundation + Chapter 2 standards)
--
-- Implements:
--   * Multi-tenant isolation : business_id on every business table (BSD Ch1.8/1.17)
--   * Soft delete           : deleted_at + deleted_by on every major entity (BSD Ch1.17 / Ch2.12)
--   * Optimistic concurrency : version column (BSD Ch1.17 / Ch2.9)
--   * Universal audit cols  : created_by / updated_by on every business table (BSD Ch2.7)
--   * Company Setup         : businesses table (AFD Ch1.10)
--   * Sync queue           : sync_queue (BSD Ch1.9 / 1.17)
--   * Audit logging         : audit_log + triggers (BSD Ch1.17)
--   * Report cache          : analytics_snapshots (BSD Ch1.17 session cache)
--
-- NOTE: UUID primary keys (BSD Ch2.5) are deferred — Integer AUTOINCREMENT
--       is retained to stay backward-compatible with backend/main.py until a
--       coordinated migration lands. All other Ch2.7 universal columns are present.
--
-- Timestamps (created_at / updated_at) are maintained by the ORM, so no
-- trigger is needed for them. Audit triggers below populate audit_log.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Businesses (tenant root)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    owner_id      TEXT,
    owner_email   TEXT,
    industry      TEXT,
    currency      TEXT DEFAULT 'USD',
    address       TEXT,
    phone         TEXT,
    tax_id        TEXT,
    website       TEXT,
    timezone      TEXT,
    created_by    TEXT,
    updated_by    TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at    DATETIME,
    deleted_by    TEXT,
    version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_businesses_email ON businesses(owner_email);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id   INTEGER,
    sku           TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    category      TEXT,
    unit_price    REAL NOT NULL,
    cost_price    REAL,
    current_stock INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 5,
    created_by    TEXT,
    updated_by    TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at    DATETIME,
    deleted_by    TEXT,
    version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
-- SKU is unique per business among live rows only (Task 10): soft-deleted
-- products' SKUs are reusable; two businesses may share a SKU.
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku
    ON products(business_id, sku) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id   INTEGER,
    full_name     TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT,
    address       TEXT,
    company       TEXT,
    created_by    TEXT,
    updated_by    TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at    DATETIME,
    deleted_by    TEXT,
    version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
-- Email is unique per business among LIVE rows only (Task 11 / audit H2):
-- a soft-deleted customer's email becomes reusable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_business_email
    ON customers(business_id, email) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id   INTEGER,
    customer_id   INTEGER NOT NULL,
    status        TEXT DEFAULT 'pending',
    total_amount  REAL NOT NULL,
    order_date    DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by    TEXT,
    updated_by    TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at    DATETIME,
    deleted_by    TEXT,
    version       INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (customer_id) REFERENCES customers (id)
);
CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ---------------------------------------------------------------------------
-- Order items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id   INTEGER NOT NULL,
    product_id    INTEGER NOT NULL,
    change        INTEGER NOT NULL,
    reason        TEXT NOT NULL,
    note          TEXT,
    order_id      INTEGER,
    actor         TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products (id)
);

CREATE TABLE IF NOT EXISTS order_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id   INTEGER,
    order_id      INTEGER NOT NULL,
    product_id    INTEGER NOT NULL,
    quantity      INTEGER NOT NULL,
    unit_price    REAL NOT NULL,
    total_price   REAL NOT NULL,
    created_by    TEXT,
    updated_by    TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at    DATETIME,
    deleted_by    TEXT,
    version       INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (order_id) REFERENCES orders (id),
    FOREIGN KEY (product_id) REFERENCES products (id)
);
CREATE INDEX IF NOT EXISTS idx_order_items_business ON order_items(business_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ---------------------------------------------------------------------------
-- Profiles (local user profile, keyed to the Clerk identity — BSD Ch3.11)
-- UUID PK (BSD Ch2.5) is deferred; clerk_user_id carries the
-- external auth identity. Auth tokens are intentionally NOT stored
-- locally (BSD Ch3.17 — tokens are verified per-request against Clerk JWKS).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    clerk_user_id      TEXT NOT NULL UNIQUE,
    full_name          TEXT,
    email              TEXT UNIQUE,
    avatar_url         TEXT,
    phone_number       TEXT,
    preferred_language TEXT DEFAULT 'en',
    timezone           TEXT,
    created_by         TEXT,
    updated_by         TEXT,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at         DATETIME,
    deleted_by         TEXT,
    version            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_user ON profiles(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- ---------------------------------------------------------------------------
-- Sync queue (offline-first replication buffer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER,
    entity_type TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    operation   TEXT NOT NULL,
    payload     TEXT,
    status      TEXT DEFAULT 'pending',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at   DATETIME
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_business ON sync_queue(business_id);

-- ---------------------------------------------------------------------------
-- Audit log (change tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name  TEXT NOT NULL,
    record_id   INTEGER,
    action      TEXT NOT NULL,
    actor       TEXT,
    change_json TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name);

-- ---------------------------------------------------------------------------
-- Analytics snapshots (session-based report cache)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id    INTEGER,
    snapshot_date  DATETIME DEFAULT CURRENT_TIMESTAMP,
    metric_key     TEXT NOT NULL,
    metric_value   REAL,
    dimensions_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_analytics_business ON analytics_snapshots(business_id);

-- ---------------------------------------------------------------------------
-- Audit triggers (BSD Ch1.17) — log UPDATE / DELETE on core tables.
-- INSERT is omitted to avoid per-row noise during bulk imports.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_products_audit_update
  AFTER UPDATE ON products
  BEGIN
    INSERT INTO audit_log(table_name, record_id, action, actor, created_at)
    VALUES ('products', NEW.id, 'UPDATE', 'system', CURRENT_TIMESTAMP);
  END;

CREATE TRIGGER IF NOT EXISTS trg_products_audit_delete
  AFTER DELETE ON products
  BEGIN
    INSERT INTO audit_log(table_name, record_id, action, actor, created_at)
    VALUES ('products', OLD.id, 'DELETE', 'system', CURRENT_TIMESTAMP);
  END;

CREATE TRIGGER IF NOT EXISTS trg_customers_audit_update
  AFTER UPDATE ON customers
  BEGIN
    INSERT INTO audit_log(table_name, record_id, action, actor, created_at)
    VALUES ('customers', NEW.id, 'UPDATE', 'system', CURRENT_TIMESTAMP);
  END;

CREATE TRIGGER IF NOT EXISTS trg_customers_audit_delete
  AFTER DELETE ON customers
  BEGIN
    INSERT INTO audit_log(table_name, record_id, action, actor, created_at)
    VALUES ('customers', OLD.id, 'DELETE', 'system', CURRENT_TIMESTAMP);
  END;

CREATE TRIGGER IF NOT EXISTS trg_orders_audit_update
  AFTER UPDATE ON orders
  BEGIN
    INSERT INTO audit_log(table_name, record_id, action, actor, created_at)
    VALUES ('orders', NEW.id, 'UPDATE', 'system', CURRENT_TIMESTAMP);
  END;

CREATE TRIGGER IF NOT EXISTS trg_orders_audit_delete
  AFTER DELETE ON orders
  BEGIN
    INSERT INTO audit_log(table_name, record_id, action, actor, created_at)
    VALUES ('orders', OLD.id, 'DELETE', 'system', CURRENT_TIMESTAMP);
  END;
