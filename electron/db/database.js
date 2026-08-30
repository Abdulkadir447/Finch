/**
 * Co-op local data layer — database facade.
 *
 * Opens the SQLite database (via the driver contract), applies migrations,
 * enables WAL for durability + concurrency, and exposes a transaction helper.
 * The repository and sync-queue layers build on this.
 */
'use strict';

const path = require('node:path');
const driver = require('./driver');
const { migrate } = require('./migrate');

/**
 * Open (and migrate) the local database.
 * @param {string} file  SQLite path, or ':memory:'.
 * @param {object} [opts] { force: 'better-sqlite3' | 'node:sqlite' }
 * @returns driver handle with an added `tx(fn)` helper and `file`.
 */
function open(file, opts = {}) {
  const db = driver.open(file, opts);
  // WAL: durable writes, readers don't block the writer (desktop-app shape).
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
  } catch {
    // Some in-memory/test configs may not support these; non-fatal.
  }
  migrate(db);
  db.tx = (fn) => {
    db.exec('BEGIN');
    try {
      const out = fn(db);
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  db.file = file;
  return db;
}

/** Resolve the default DB file path for a business (per-app data dir). */
function defaultDbPath(appDataDir) {
  return path.join(appDataDir, 'coop.db');
}

module.exports = { open, defaultDbPath };
