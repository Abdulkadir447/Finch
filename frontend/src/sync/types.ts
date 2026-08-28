/**
 * Co-op sync — shared types (offline-first, ADR-002).
 *
 * Mirrors the server's /sync/push protocol (backend/sync.py) and the local
 * data-layer surface exposed by Electron (electron/db). These types are the
 * contract between the UI, the local repository layer (OFFLINE 2) and the
 * sync engine (OFFLINE 3).
 */

export type SyncEntity = 'customer' | 'product' | 'order' | 'order_item' | 'stock_movement';
export type SyncOperation = 'create' | 'update' | 'delete';

/** One queued offline operation (what the sync engine will push). */
export interface SyncOp {
  entity: SyncEntity;
  /** Client-generated ULID — the idempotency key the server dedupes on. */
  client_id: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
}

export type ConnectionState = 'online' | 'offline';

/**
 * The user-visible sync state (point #12: never hide synchronization).
 *  - synced:            online, nothing pending
 *  - offline-saved:     offline, local DB available (writes still work)
 *  - offline-no-local:  offline, no local DB (browser) — honest: can't proceed
 *  - syncing:           a push is in flight
 *  - needs-attention:   online, ops pending that haven't pushed yet / failed
 */
export type SyncStatusKind = 'synced' | 'offline-saved' | 'offline-no-local' | 'syncing' | 'needs-attention';

export interface SyncStatus {
  kind: SyncStatusKind;
  connection: ConnectionState;
  /** True when running in the desktop app with a local SQLite data layer. */
  localAvailable: boolean;
  /** Offline operations awaiting push. */
  pending: number;
  /** True while a push is actively in flight. */
  syncing: boolean;
}

/** The result the server returns for a push batch (mirrors /sync/push). */
export interface SyncPushResult {
  applied: number;
  skipped: number;
  ids: Record<string, number>;
  errors: Array<{ client_id: string; entity: string; error: string }>;
}
