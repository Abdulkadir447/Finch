/**
 * In-app notification preferences (Settings → Notifications).
 *
 * Stored on the device (localStorage) — these gate what the in-app
 * notification center shows; they do not invent an email/push channel that
 * does not exist in v1. Defaults are ON.
 */
export interface NotificationPrefs {
  /** The daily business summary inside the notification center. */
  dailySummary: boolean;
  /** Low/out-of-stock alerts inside the notification center. */
  lowStock: boolean;
}

const KEY_SUMMARY = 'coop:notify:dailySummary';
const KEY_LOW_STOCK = 'coop:notify:lowStock';

let listeners: Array<() => void> = [];

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function getNotificationPrefs(): NotificationPrefs {
  return {
    dailySummary: readBool(KEY_SUMMARY, true),
    lowStock: readBool(KEY_LOW_STOCK, true),
  };
}

export function setNotificationPrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
  try {
    if (patch.dailySummary !== undefined) {
      window.localStorage.setItem(KEY_SUMMARY, patch.dailySummary ? '1' : '0');
    }
    if (patch.lowStock !== undefined) {
      window.localStorage.setItem(KEY_LOW_STOCK, patch.lowStock ? '1' : '0');
    }
  } catch {
    /* private mode — prefs still apply for the session */
  }
  const next = getNotificationPrefs();
  for (const l of listeners) l();
  return next;
}

export function subscribeNotificationPrefs(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}
