/**
 * Local database backup/restore primitives (electron/db/backup.js) — driven
 * on plain Node with the node:sqlite engine, exactly like the rest of the
 * data-layer suite.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDataLayer } = require('../db');
const { isSqliteFile, snapshot, replaceDbFile, assertRestoreSafe } = require('../db/backup');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coop-backup-'));
}

test('isSqliteFile accepts a real database and rejects anything else', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'coop.db');
  const dl = createDataLayer(dbPath, { force: 'node:sqlite' });
  dl.close();
  assert.strictEqual(isSqliteFile(dbPath), true);

  const fake = path.join(dir, 'fake.db');
  fs.writeFileSync(fake, 'definitely not sqlite');
  assert.strictEqual(isSqliteFile(fake), false);
  assert.strictEqual(isSqliteFile(path.join(dir, 'missing.db')), false);
});

test('snapshot produces a consistent, portable copy of the database', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'coop.db');
  const dl = createDataLayer(dbPath, { force: 'node:sqlite' });
  dl.business.ensure({ client_id: '01TESTBIZ', name: 'Acme', currency: 'NGN' });
  const b = dl.business.first();
  dl.customers.create(b.id, { full_name: 'Jane', email: 'jane@example.com' });

  const backupPath = path.join(dir, 'coop-backup.db');
  snapshot(dl.db, backupPath);
  assert.strictEqual(isSqliteFile(backupPath), true);

  // The backup is standalone: open it as a fresh data layer and read the row.
  const restored = createDataLayer(backupPath, { force: 'node:sqlite' });
  const rows = restored.customers.list(b.id, {});
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].email, 'jane@example.com');
  restored.close();
  dl.close();
});

test('replaceDbFile swaps the live database with the backup file', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'coop.db');

  const dl = createDataLayer(dbPath, { force: 'node:sqlite' });
  const b = dl.business.ensure({ client_id: '01TESTBIZ', name: 'Acme', currency: 'NGN' });
  dl.customers.create(b.id, { full_name: 'Backed up', email: 'backed@example.com' });
  const backupPath = path.join(dir, 'backup.db');
  snapshot(dl.db, backupPath);
  // A customer added AFTER the snapshot must disappear on restore.
  dl.customers.create(b.id, { full_name: 'Later', email: 'later@example.com' });
  dl.close();

  replaceDbFile(dbPath, backupPath);
  const reopened = createDataLayer(dbPath, { force: 'node:sqlite' });
  const emails = reopened.customers.list(b.id, {}).map((c) => c.email);
  assert.deepStrictEqual(emails, ['backed@example.com']);
  reopened.close();
});

test('replaceDbFile refuses a file that is not SQLite', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'coop.db');
  const fake = path.join(dir, 'fake.db');
  fs.writeFileSync(fake, 'hello world');
  assert.throws(() => replaceDbFile(dbPath, fake), /not a valid Co-op local database/);
});

test('assertRestoreSafe refuses while work is unsynced or conflicted', () => {
  const dir = tmpDir();
  const dl = createDataLayer(path.join(dir, 'coop.db'), { force: 'node:sqlite' });
  const b = dl.business.ensure({ client_id: '01TESTBIZ', name: 'Acme', currency: 'NGN' });
  assert.doesNotThrow(() => assertRestoreSafe(dl));

  // A customer create enqueues a sync op -> restore must refuse.
  dl.customers.create(b.id, { full_name: 'Jane', email: 'jane@example.com' });
  assert.throws(() => assertRestoreSafe(dl), /unsynced changes/);
  dl.close();
});
