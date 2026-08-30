/**
 * Co-op sync — connectivity detection.
 *
 * In the browser this is navigator.onLine + online/offline events. In the
 * desktop app Electron additionally broadcasts a more authoritative
 * `coop:net` event from the main process (net.isOnline()), which we listen
 * for when the preload bridge is present.
 */
import type { ConnectionState } from './types';

type Listener = (online: boolean) => void;

let listeners: Listener[] = [];

function currentOnline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

function emit(online: boolean) {
  for (const l of listeners) l(online);
}

let wired = false;
function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('online', () => emit(true));
  window.addEventListener('offline', () => emit(false));
  // Desktop app: Electron main process broadcasts authoritative net state.
  const coop = (window as unknown as { coop?: { on?: (ch: string, cb: (d: { online: boolean }) => void) => void } }).coop;
  if (coop?.on) {
    coop.on('coop:net', (d) => emit(!!d.online));
  }
}

/** Subscribe to connectivity changes. Returns an unsubscribe function. */
export function onConnectionChange(cb: Listener): () => void {
  wire();
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function getConnection(): ConnectionState {
  return currentOnline() ? 'online' : 'offline';
}
