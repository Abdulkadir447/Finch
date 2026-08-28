/**
 * Co-op local data layer — migration runner.
 *
 * Applies versioned, ordered, idempotent migrations from ./migrations to the
 * local SQLite database, tracking applied versions in `schema_migrations`.
 * Migrations are additive and guarded (IF NOT EXISTS), matching the repo's
 * Postgres migration convention (ADR-002).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function ensureMigrationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function appliedVersions(db) {
  return new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
}

/**
 * Run all pending migrations. Returns the list of versions applied.
 * `db` is a driver handle (see driver.js).
 */
function migrate(db) {
  ensureMigrationsTable(db);
  const done = appliedVersions(db);
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.js$/.test(f))
    .sort();
  const applied = [];
  for (const file of files) {
    const version = parseInt(file.slice(0, 4), 10);
    if (done.has(version)) continue;
    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (migration.version !== version) {
      throw new Error(`Migration ${file} declares version ${migration.version}`);
    }
    // Apply within a transaction so a partial migration can't leave a
    // half-schema behind.
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
      db.exec('COMMIT');
      applied.push(version);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return applied;
}

module.exports = { migrate };
