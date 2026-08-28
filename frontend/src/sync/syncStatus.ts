/**
 * Co-op sync — status store (point #12: visible, never hidden).
 *
 * Combines connectivity + local-DB availability + pending count into a single
 * user-visible SyncStatus. A tiny observable store compatible with
 * React's useSyncExternalStore. The push engine (OFFLINE 3) will update
 * `syncing`/`pending` as it runs; until then pending is read from the local
 * queue and syncing stays false.
 */
import { useSyncExternalStore } from 'react';
import { getConnection, onConnectionChange } from './connectivity';
import { getPendingCount, isLocalAvailable } from './localDb';
import type { SyncStatus, SyncStatusKind } from './types';

let status: SyncStatus = initial();
let listeners: Array<() => void> = [];
let polling: ReturnType<typeof setInterval> | null = null;
let started = false;

function initial(): SyncStatus {
  const local = isLocalAvailable();
  const connection = getConnection();
  return {
    kind: local ? 'synced' : connection === 'online' ? 'synced' : 'offline-no-local',
    connection,
    localAvailable: local,
    pending: 0,
    syncing: false,
  };
}

function kindFor(s: SyncStatus): SyncStatusKind {
  if (s.syncing) return 'syncing';
  if (s.connection === 'offline') return s.localAvailable ? 'offline-saved' : 'offline-no-local';
  return s.pending > 0 ? 'needs-attention' : 'synced';
}

function set(next: SyncStatus) {
  next.kind = kindFor(next);
  status = next;
  for (const l of listeners) l();
}

async function refresh() {
  const pending = isLocalAvailable() ? await getPendingCount() : 0;
  set({ ...status, connection: getConnection(), pending, syncing: status.syncing });
}

function start() {
  if (started) return;
  started = true;
  void refresh();
  onConnectionChange(() => void refresh());
  // Light poll while a local layer exists (the push engine will replace this
  // with event-driven updates in OFFLINE 3).
  if (isLocalAvailable()) {
    polling = setInterval(() => void refresh(), 5000);
  }
}

export function subscribe(cb: () => void): () => void {
  start();
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function getSnapshot(): SyncStatus {
  return status;
}

/** React hook: the current visible sync status. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
