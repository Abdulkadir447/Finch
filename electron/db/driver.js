/**
 * Co-op local data layer — SQLite driver contract.
 *
 * The data layer is written against this thin contract so the SAME logic runs
 * on two engines:
 *
 *   * better-sqlite3  — production Electron (synchronous, fast, native).
 *   * node:sqlite     — Node >= 22.5 (built-in), used by the test suite and
 *                       any plain-Node environment.
 *
 * Both expose the same surface: exec / prepare -> { get, all, run } / close,
 * and run() returns { lastInsertRowid, changes }. This keeps the repository
 * and sync-queue code identical and testable outside a full Electron runtime.
 */
'use strict';

function openBetterSqlite3(file) {
  const Database = require('better-sqlite3');
  const db = new Database(file);
  return {
    name: 'better-sqlite3',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        get: (...p) => stmt.get(...p),
        all: (...p) => stmt.all(...p),
        run: (...p) => stmt.run(...p),
      };
    },
    close: () => db.close(),
  };
}

function openNodeSqlite(file) {
  // Node >= 22.5 built-in. Path ':memory:' is supported.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  return {
    name: 'node:sqlite',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        get: (...p) => stmt.get(...p),
        all: (...p) => stmt.all(...p),
        run: (...p) => {
          const r = stmt.run(...p);
          return { lastInsertRowid: r.lastInsertRowid, changes: r.changes };
        },
      };
    },
    close: () => db.close(),
  };
}

/**
 * Open a SQLite database, preferring better-sqlite3 (production) and falling
 * back to node:sqlite (tests / Node >= 22.5). `force` lets tests pin an engine.
 */
function open(file, { force } = {}) {
  const order = force
    ? [force]
    : ['better-sqlite3', 'node:sqlite'];
  let lastErr;
  for (const name of order) {
    try {
      if (name === 'better-sqlite3') return openBetterSqlite3(file);
      if (name === 'node:sqlite') return openNodeSqlite(file);
    } catch (e) {
      lastErr = e;
      // If the module is missing, try the next engine. If it opened but the
      // file failed, that's a real error — rethrow.
      if (e && (e.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(String(e.message)))) {
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('No usable SQLite engine available');
}

module.exports = { open };
