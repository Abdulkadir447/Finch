/**
 * Co-op local backup primitives (PRD Phase 4 "Backup system", desktop side).
 *
 * The cloud backup (backend/backups.py) is a JSON snapshot of business data;
 * THIS module backs up the device's local SQLite database itself — the
 * offline mirror plus its sync queue — as a portable `.db` file.
 *
 * Three primitives, kept Electron-free so the test suite drives them on
 * plain Node:
 *
 *   isSqliteFile(path)      — header check (never trust a picked file).
 *   snapshot(db, destPath)  — a consistent copy via VACUUM INTO (works on
 *                             both better-sqlite3 and node:sqlite).
 *   replaceDbFile(dbPath, srcPath)
 *                           — swap the live DB file with a backup file
 *                             (caller closes the DB first, then reopens).
 *   assertRestoreSafe(dataLayer)
 *                           — refuse when the sync queue still holds
 *                             pending or parked-conflict operations: a
 *                             restore would silently drop work the owner
 *                             has not synced yet. Never lose data.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// 16-byte magic header every SQLite file starts with.
const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000', 'utf8');

/** True when the file exists and starts with the SQLite magic header. */
function isSqliteFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(16);
      const read = fs.readSync(fd, buf, 0, 16, 0);
      return read === 16 && buf.equals(SQLITE_HEADER);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** SQL-escape a path for VACUUM INTO (single quotes doubled). */
function _quote(p) {
  return `'${String(p).replace(/'/g, "''")}'`;
}

/**
 * Write a consistent snapshot of the open database to `destPath`.
 * VACUUM INTO produces a standalone, checkpointed copy — safe while the app
 * keeps using the live file.
 */
function snapshot(db, destPath) {
  if (fs.existsSync(destPath)) fs.rmSync(destPath);
  db.exec(`VACUUM INTO ${_quote(destPath)};`);
  return destPath;
}

/**
 * Replace the live database file with a backup file. The caller MUST have
 * closed the database first; WAL/SHM sidecars are removed so the restored
 * file opens clean. Throws if `srcPath` is not a SQLite database.
 */
function replaceDbFile(dbPath, srcPath) {
  if (!isSqliteFile(srcPath)) {
    throw new Error('The selected file is not a valid Co-op local database.');
  }
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(srcPath, dbPath);
  return dbPath;
}

/**
 * Guard for restore: the sync queue must be empty (nothing pending, no
 * parked conflicts). Restoring over unsynced work would lose it silently —
 * Co-op refuses instead.
 */
function assertRestoreSafe(dataLayer) {
  const pending = dataLayer.queue.countPending();
  const conflicts = dataLayer.queue.countConflicts();
  if (pending > 0 || conflicts > 0) {
    throw new Error(
      'Restore is unavailable while there are unsynced changes ' +
        `(${pending} pending, ${conflicts} conflict${conflicts === 1 ? '' : 's'}). ` +
        'Reconnect and sync first — nothing has been changed.'
    );
  }
}

module.exports = { isSqliteFile, snapshot, replaceDbFile, assertRestoreSafe };
