/**
 * Co-op sync — status store (point #12: visible, never hidden).
 *
 * Combines connectivity + local-DB availability + pending count + mirror
 * readiness into a single user-visible SyncStatus. A tiny observable store
 * compatible with React's useSyncExternalStore.
 *
 * OFFLINE 3: the store mirrors the main-process sync state (events from
 * `coop:sync` + a light poll as a fallback) and flips the repository layer's
 * local-mode gate — reads only come from SQLite once the initial pull has
 * populated the mirror (`setLocalMirrorReady`), never before.
 */
import { useSyncExternalStore } from 'react';
import { setLocalMirrorReady } from '../repositories/localMode';
import { getConnection, onConnectionChange } from './connectivity';
import { getSyncStatus, isLocalAvailable, onSyncStatus } from './localDb';
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
    // Desktop: unknown until main reports (initial pull may already be done
    // on a previous launch — main re-verifies on the first pull of this run).
    mirrorReady: false,
    lastSyncAt: null,
  };
}

function kindFor(s: SyncStatus): SyncStatusKind {
  if (s.syncing) return 'syncing';
  if (s.connection === 'offline') return s.localAvailable ? 'offline-saved' : 'offline-no-local';
  return s.pending > 0 ? 'needs-attention' : 'synced';
}

function set(next: SyncStatus) {
  next.kind = kindFor(next);
  // The repository layer's gate: local-first reads only once the mirror is
  // a populated pull — never before (ADR-002, OFFLINE 3 activation rule).
  if (next.mirrorReady !== status.mirrorReady) setLocalMirrorReady(next.mirrorReady);
  status = next;
  for (const l of listeners) l();
}

async function refresh() {
  if (!isLocalAvailable()) {
    set({
      ...status,
      connection: getConnection(),
      pending: 0,
      syncing: false,
      mirrorReady: false,
    });
    return;
  }
  // Main's status is authoritative for pending/syncing/mirrorReady; the
  // engine (renderer) owns the cycle, main owns the mirror + queue state.
  const s = await getSyncStatus();
  set({
    ...status,
    connection: getConnection(),
    pending: s?.pending ?? 0,
    syncing: s?.syncing ?? false,
    mirrorReady: s?.mirrorReady ?? false,
    lastSyncAt: s?.lastSyncAt ?? null,
  });
}

function start() {
  if (started) return;
  started = true;
  void refresh();
  onConnectionChange(() => void refresh());
  onSyncStatus(() => void refresh());
  // Light poll while a local layer exists (events are primary; the poll
  // covers missed broadcasts, e.g. before the first subscribe).
  if (isLocalAvailable()) {
    polling = setInterval(() => void refresh(), 5000);
  }
}

export function subscribe(cb: () => void): () => void {
  start();
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
    if (listeners.length === 0 && polling) {
      clearInterval(polling);
      polling = null;
    }
  };
}

export function getSnapshot(): SyncStatus {
  return status;
}

/** React hook: the current visible sync status. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
