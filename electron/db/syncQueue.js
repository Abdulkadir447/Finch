/**
 * Co-op local data layer — sync queue.
 *
 * Offline writes enqueue an operation here; the sync engine (OFFLINE 3) drains
 * pending ops to the cloud when connectivity returns. Each op carries the
 * entity's client_id as its idempotency key so a retried op applies once
 * (ADR-002 rule 4).
 *
 * This module is storage for the queue only — it does not perform network I/O.
 */
'use strict';

const ENTITIES = ['customer', 'product', 'order', 'order_item', 'stock_movement'];
const OPERATIONS = ['create', 'update', 'delete'];

class SyncQueue {
  constructor(db) {
    this.db = db;
  }

  _assert(entity, operation) {
    if (!ENTITIES.includes(entity)) throw new Error(`Unknown sync entity: ${entity}`);
    if (!OPERATIONS.includes(operation)) throw new Error(`Unknown sync operation: ${operation}`);
  }

  /**
   * Enqueue a sync operation.
   * @param {object} p
   * @param {number} p.business_id
   * @param {string} p.entity      customer|product|order|order_item|stock_movement
   * @param {number} p.entity_id   local row id
   * @param {string} p.client_id   ULID idempotency key
   * @param {string} p.operation   create|update|delete
   * @param {object} p.payload     JSON-serialisable snapshot / movement
   */
  enqueue({ business_id, entity, entity_id, client_id, operation, payload }) {
    this._assert(entity, operation);
    const r = this.db
      .prepare(
        `INSERT INTO sync_queue
           (business_id, entity, entity_id, client_id, operation, payload, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(business_id, entity, entity_id, client_id, operation, JSON.stringify(payload));
    return Number(r.lastInsertRowid);
  }

  /** Pending ops, oldest first (stable push order). */
  pending({ business_id } = {}) {
    if (business_id != null) {
      return this.db
        .prepare(
          `SELECT * FROM sync_queue WHERE status='pending' AND business_id=? ORDER BY id ASC`
        )
        .all(business_id)
        .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
    }
    return this.db
      .prepare(`SELECT * FROM sync_queue WHERE status='pending' ORDER BY id ASC`)
      .all()
      .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  /** Local order ids with a pending/failed order op (the UI's "Pending
   *  sync" chip — point #8: offline writes are visible as pending). */
  pendingOrderIds({ business_id } = {}) {
    const rows =
      business_id != null
        ? this.db
            .prepare(
              `SELECT DISTINCT entity_id FROM sync_queue
                WHERE status IN ('pending','failed') AND entity='order' AND business_id=?`,
            )
            .all(business_id)
        : this.db
            .prepare(
              `SELECT DISTINCT entity_id FROM sync_queue
                WHERE status IN ('pending','failed') AND entity='order'`,
            )
            .all();
    return rows.map((r) => Number(r.entity_id));
  }

  countPending({ business_id } = {}) {
    const row =
      business_id != null
        ? this.db
            .prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE status='pending' AND business_id=?`)
            .get(business_id)
        : this.db.prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE status='pending'`).get();
    return row.n;
  }

  markSynced(queueId) {
    this.db
      .prepare(`UPDATE sync_queue SET status='synced', updated_at=datetime('now') WHERE id=?`)
      .run(queueId);
  }

  markFailed(queueId, error) {
    this.db
      .prepare(
        `UPDATE sync_queue
            SET status='failed', attempts=attempts+1, last_error=?, updated_at=datetime('now')
          WHERE id=?`
      )
      .run(String(error), queueId);
  }

  /**
   * OFFLINE 4 — record a structured CONFLICT on a queue op.
   *
   * A conflict is NOT a failure: retrying can't fix it (it collides with
   * cloud state), so the op is parked in 'conflict' status — excluded from
   * pending(), never re-armed by retryFailed() — until OFFLINE 5's
   * resolution UI handles it. The ORIGINAL payload is untouched; the
   * structured server response (reason, local, server, operation_id) is kept
   * in last_error as JSON so resolution has full context.
   */
  markConflict(queueId, conflict) {
    this.db
      .prepare(
        `UPDATE sync_queue
            SET status='conflict', last_error=?, updated_at=datetime('now')
          WHERE id=?`
      )
      .run(JSON.stringify(conflict || {}), queueId);
  }

  /** Ops waiting for human resolution (OFFLINE 5). Not retried automatically. */
  conflicts({ business_id } = {}) {
    const rows =
      business_id != null
        ? this.db
            .prepare(
              `SELECT * FROM sync_queue WHERE status='conflict' AND business_id=? ORDER BY id ASC`,
            )
            .all(business_id)
        : this.db.prepare(`SELECT * FROM sync_queue WHERE status='conflict' ORDER BY id ASC`).all();
    return rows.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload),
      conflict: r.last_error ? JSON.parse(r.last_error) : null,
    }));
  }

  countConflicts({ business_id } = {}) {
    const row =
      business_id != null
        ? this.db
            .prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE status='conflict' AND business_id=?`)
            .get(business_id)
        : this.db.prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE status='conflict'`).get();
    return row.n;
  }

  /** Failed ops become pending again (retry on next sync attempt).
   *  CONFLICT ops are deliberately NOT re-armed — they wait for resolution. */
  retryFailed() {
    this.db
      .prepare(`UPDATE sync_queue SET status='pending', updated_at=datetime('now') WHERE status='failed'`)
      .run();
  }

  get(queueId) {
    const r = this.db.prepare(`SELECT * FROM sync_queue WHERE id=?`).get(queueId);
    return r ? { ...r, payload: JSON.parse(r.payload) } : null;
  }
}

module.exports = { SyncQueue, ENTITIES, OPERATIONS };
