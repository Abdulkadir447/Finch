/**
 * Co-op sync — engine (OFFLINE 3).
 *
 * Runs in the RENDERER, because this is where the Clerk-authenticated API
 * client lives (session token via the axios interceptor). One cycle:
 *
 *   1. PUSH   pending offline writes  →  POST /sync/push  →  mark queue
 *   2. PULL   initial full mirror, or delta since the last cursor
 *            →  GET /sync/pull  →  main process ingests into SQLite
 *
 * Push always runs before pull, so the mirror a local read sees already
 * includes this device's just-pushed writes (no stale reads after sync).
 *
 * Triggers: app startup, connectivity restored, a periodic online interval,
 * and a manual "Sync now". A failed delta arms a one-shot FULL pull
 * (re-verified) — the mirror can never silently drift.
 *
 * Activation rule (ADR-002): the repository layer only reads from SQLite
 * once the initial pull succeeded — main reports `mirrorReady` and the
 * status store flips the gate. Before that, everything is the remote path.
 */
import type { AxiosInstance } from 'axios';
import { getConnection, onConnectionChange } from './connectivity';
import {
  applyPushOutcome,
  getPendingOps,
  getPullCursor,
  getSyncStatus,
  ingestMirror,
  isLocalAvailable,
  setSyncing,
} from './localDb';
import type { PullPayload, SyncPushResult } from './types';

const INTERVAL_MS = 30_000;
/** While online and idle, keep the mirror at most this fresh. */
const FRESHNESS_MS = 5 * 60_000;

let started = false;
let running = false;
let stopped = false;
let lastSuccessAt = 0;
let needFullPull = false; // armed by a failed delta: next pull is a full, re-verified one
let manualRequested = false;
let apiRef: AxiosInstance | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let unsubs: Array<() => void> = [];

async function cycle(): Promise<void> {
  if (running || stopped || !apiRef || !isLocalAvailable()) return;
  if (getConnection() !== 'online') return; // offline: writes still work locally; nothing to move

  const manual = manualRequested;
  manualRequested = false;

  // Idle fast-path: online, nothing pending, mirror fresh → do nothing.
  if (!manual) {
    const main = await getSyncStatus();
    const cursor = await getPullCursor();
    const mirrorOk = !!main?.mirrorReady && !needFullPull;
    if ((main?.pending ?? 0) === 0 && cursor && mirrorOk && Date.now() - lastSuccessAt < FRESHNESS_MS) {
      return;
    }
  }

  running = true;
  try {
    await setSyncing(true);

    // --- 1) PUSH: drain the queue (idempotent on the server's side) -------
    const ops = await getPendingOps();
    if (ops.length > 0) {
      const { data } = await apiRef.post<SyncPushResult>('/sync/push', { operations: ops });
      await applyPushOutcome(data);
    }

    // --- 2) PULL: full (initial / recovery) or delta since the cursor -----
    const cursor = needFullPull ? null : await getPullCursor();
    const { data: payload } = await apiRef.get<PullPayload>('/sync/pull', {
      params: cursor ? { since: cursor } : undefined,
    });
    // A failed full pull throws in main (verification) — the mirror and
    // cursor stay as they were; the next cycle retries.
    await ingestMirror(payload);
    needFullPull = false;
    lastSuccessAt = Date.now();
  } catch {
    // Offline mid-cycle, server error, or a verification failure: state
    // stays honest (queue rows are untouched; cursor unchanged on a failed
    // full pull) and the next trigger retries. A failed DELTA may mean the
    // mirror has drifted — force a re-verified full pull next time.
    if (needFullPull === false) {
      const main = await getSyncStatus();
      if (main?.mirrorReady) needFullPull = true;
    }
  } finally {
    await setSyncing(false);
    running = false;
  }
}

/** Manual "Sync now" (the UI button). */
export function requestManualSync(): void {
  if (!started || stopped) return;
  manualRequested = true;
  void cycle();
}

/**
 * Start the engine (idempotent). Returns a stop function; call it on
 * sign-out to release the interval and the connectivity listener.
 */
export function startSyncEngine(api: AxiosInstance): () => void {
  if (started) return () => undefined;
  started = true;
  apiRef = api;

  void cycle(); // app startup: initial pull (or drain, if writes are pending)
  unsubs.push(
    onConnectionChange((online) => {
      if (online) void cycle(); // connectivity restored
    }),
  );
  timer = setInterval(() => void cycle(), INTERVAL_MS); // periodic online refresh

  return () => {
    stopped = true;
    apiRef = null;
    if (timer) clearInterval(timer);
    timer = null;
    for (const u of unsubs) u();
    unsubs = [];
  };
}
