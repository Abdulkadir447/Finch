/**
 * Co-op repositories — local-mode gate (OFFLINE 2/3 boundary).
 *
 * OFFLINE 2 delivers the local-first plumbing (the repositories + the local
 * SQLite branch). Local mode ACTIVES in OFFLINE 3, when:
 *   1. the local DB is a populated mirror (the initial pull), and
 *   2. reads are served from the local mirror.
 *
 * Until both hold, `isLocalModeActive()` is false and every repository
 * operation uses the remote (HTTP) path — the app's behaviour is unchanged
 * and nothing breaks. Activating local writes before reads are local would
 * (a) make locally-created records invisible to server-backed reads, and
 * (b) drive local update/delete against rows that aren't mirrored yet.
 *
 * OFFLINE 3 calls `setLocalMirrorReady(true)` once the initial pull has
 * populated the local DB and reads are local.
 */
import { isLocalAvailable } from '../sync/localDb';

let localMirrorReady = false;

/** OFFLINE 3 flips this true once the local DB is a populated, read-backed mirror. */
export function setLocalMirrorReady(ready: boolean): void {
  localMirrorReady = ready;
}

export function isLocalMirrorReady(): boolean {
  return localMirrorReady;
}

/** True when local-first reads/writes should be used (desktop + mirror ready). */
export function isLocalModeActive(): boolean {
  return isLocalAvailable() && localMirrorReady;
}
