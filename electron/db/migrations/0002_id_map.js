/**
 * Migration 0002 — server-id -> local-id mapping (OFFLINE 3 mirror).
 *
 * The pull payload carries SERVER ids for cross-references (an order's
 * customer_id is the customer's server id). Local rows have their own
 * integer ids, so the mirror needs an explicit, persistent map:
 *
 *   (entity, server_id) -> (client_id, local_id)
 *
 * Every mirror upsert records the mapping for its row. Client-created rows
 * map through their ULID; cloud-native rows (client_id is null on the
 * server) map through the deterministic synthetic key `srv-<server_id>`, so
 * the mapping is stable across pulls with no extra state.
 */
'use strict';

module.exports = {
  version: 2,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS id_map (
        entity    TEXT NOT NULL,
        server_id INTEGER NOT NULL,
        client_id TEXT NOT NULL,
        local_id  INTEGER NOT NULL,
        PRIMARY KEY (entity, server_id)
      );
      CREATE INDEX IF NOT EXISTS idx_id_map_client ON id_map(entity, client_id);
    `);
  },
};
