/**
 * Co-op sync — local data-layer access (OFFLINE 1/2/3).
 *
 * A typed wrapper over the Electron IPC bridge (`window.coop`). In a plain
 * browser this is absent, so `isLocalAvailable()` is false and the app uses
 * the remote API as it does today. OFFLINE 3 runs the sync engine in the
 * renderer (where the Clerk-authenticated API client lives) and routes its
 * mirror/queue operations through the bridge below.
 */
import type { PullPayload, SyncConflictEntry, SyncPushResult, SyncOp } from './types';

export interface LocalRow {
  id: number;
  client_id: string;
  business_id: number;
  [key: string]: unknown;
}

export interface LocalListQuery {
  business_id: number;
  opts?: { limit?: number };
}

export interface LocalDb {
  businessEnsure(b: { client_id: string; name: string; currency?: string }): Promise<LocalRow>;
  businessGet(id: number): Promise<LocalRow | null>;
  /** The single-owner local business row (offline-safe: no network). */
  businessFirst(): Promise<LocalRow | null>;
  customerCreate(a: { business_id: number; data: object }): Promise<LocalRow>;
  customerUpdate(a: { id: number; data: object }): Promise<LocalRow>;
  customerDelete(id: number): Promise<LocalRow>;
  customerGet(id: number): Promise<LocalRow | null>;
  customerList(a: LocalListQuery): Promise<LocalRow[]>;
  productCreate(a: { business_id: number; data: object }): Promise<LocalRow>;
  productUpdate(a: { id: number; data: object }): Promise<LocalRow>;
  productDelete(id: number): Promise<LocalRow>;
  productGet(id: number): Promise<LocalRow>;
  productList(a: LocalListQuery): Promise<LocalRow[]>;
  orderCreate(a: { business_id: number; data: object }): Promise<LocalRow>;
  orderSetStatus(a: { business_id: number; order_id: number; status: string }): Promise<LocalRow>;
  orderGet(id: number): Promise<LocalRow | null>;
  orderList(a: LocalListQuery): Promise<LocalRow[]>;
  /** Orders joined with their customer's name (local read path). */
  orderListDetailed(a: LocalListQuery): Promise<Array<LocalRow & { customer_name: string | null }>>;
  /** All line items of the business's orders (grouped in the caller). */
  orderItemsByOrder(a: LocalListQuery): Promise<LocalRow[]>;
  stockAdjust(a: {
    business_id: number;
    product_id: number;
    change: number;
    reason: string;
    opts?: Record<string, unknown>;
  }): Promise<LocalRow>;
  stockMovements(a: { business_id: number; product_id?: number | null }): Promise<LocalRow[]>;
  // OFFLINE 5 — resolution-only local corrections (never queue an op).
  customerDiscardLocal(id: number): Promise<LocalRow>;
  productDiscardLocal(id: number): Promise<LocalRow>;
  stockSetLocal(a: { product_id: number; value: number; note?: string | null }): Promise<LocalRow>;
}

/** A parked conflict as returned by the queue (queue row + structured entry). */
export interface ParkedConflict {
  /** Queue row id (the sync operation id). */
  id: number;
  entity: string; // customer | product | order | order_item | stock_movement
  entity_id: number; // the local row this op targets
  client_id: string;
  operation: string; // create | update | delete
  payload: Record<string, unknown>;
  conflict: SyncConflictEntry | null;
}

export interface LocalSyncStatus {
  online: boolean;
  pending: number;
  /** OFFLINE 4: ops parked in 'conflict' — visible, never auto-retried. */
  conflicts: number;
  syncing: boolean;
  mirrorReady: boolean;
  lastSyncAt: string | null;
}

export interface PushOutcome {
  synced: number;
  conflicts: number;
  failed: number;
}

export interface BackupBridgeResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
}

interface CoopBridge {
  db?: LocalDb;
  backup?: {
    create: () => Promise<BackupBridgeResult>;
    restore: () => Promise<BackupBridgeResult>;
  };
  sync?: {
    status: () => Promise<LocalSyncStatus>;
    pendingOps: () => Promise<Array<SyncOp & { id?: number }>>;
    applyPushOutcome: (result: SyncPushResult) => Promise<PushOutcome>;
    ingestMirror: (payload: PullPayload) => Promise<{ business_id: number; cursor: string; applied: Record<string, number> }>;
    pullCursor: () => Promise<string | null>;
    pendingOrderIds: () => Promise<number[]>;
    setSyncing: (b: boolean) => Promise<boolean>;
    conflicts: () => Promise<ParkedConflict[]>;
    // OFFLINE 5 — resolution actions.
    requeue: (a: { queueId: number; payloadOverride?: Record<string, unknown> | null }) => Promise<unknown>;
    resolveConflict: (a: { queueId: number }) => Promise<unknown>;
    onStatus?: (cb: (s: LocalSyncStatus) => void) => void;
  };
}

function getCoop(): CoopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { coop?: CoopBridge }).coop;
}

/** True when running in the desktop app with a local SQLite data layer. */
export function isLocalAvailable(): boolean {
  return !!getCoop()?.db;
}

export function getLocalDb(): LocalDb | null {
  return getCoop()?.db ?? null;
}

/** Pending offline ops (from the local queue); 0 when no local layer. */
export async function getPendingCount(): Promise<number> {
  const s = await getCoop()?.sync?.status().catch(() => null);
  return s?.pending ?? 0;
}

/** Main-process sync state (authoritative for pending/mirror/syncing). */
export function getSyncStatus(): Promise<LocalSyncStatus | null> {
  return getCoop()?.sync?.status().catch(() => null) ?? Promise.resolve(null);
}

/** The next push batch (pending ops, oldest first, capped at 200).
 *  `id` is the queue row id (sent as operation_id so the server can echo
 *  it back in structured conflict entries). */
export async function getPendingOps(): Promise<Array<SyncOp & { id?: number }>> {
  return (await getCoop()?.sync?.pendingOps().catch(() => null)) ?? [];
}

/** Mark the queue after a /sync/push response (synced / failed). */
export async function applyPushOutcome(result: SyncPushResult): Promise<void> {
  await getCoop()?.sync?.applyPushOutcome(result).catch(() => undefined);
}

/** Upsert a /sync/pull payload into the local mirror (main process). */
export async function ingestMirror(payload: PullPayload): Promise<void> {
  await getCoop()?.sync?.ingestMirror(payload);
}

/** The last stored pull cursor (null before the first successful pull). */
export async function getPullCursor(): Promise<string | null> {
  return (await getCoop()?.sync?.pullCursor().catch(() => null)) ?? null;
}

/** Local order ids with pending/failed order ops ("Pending sync" chips). */
export async function getPendingOrderIds(): Promise<number[]> {
  return (await getCoop()?.sync?.pendingOrderIds().catch(() => null)) ?? [];
}

/** Tell main a pull/push cycle is in flight (drives the "Syncing…" pill). */
export async function setSyncing(b: boolean): Promise<void> {
  await getCoop()?.sync?.setSyncing(b).catch(() => undefined);
}

/** Subscribe to main-process status broadcasts (mirror ready, last sync). */
/** Parked conflicts (OFFLINE 4) — queue row + structured server entry. */
export async function getConflicts(): Promise<ParkedConflict[]> {
  return (await getCoop()?.sync?.conflicts().catch(() => null)) ?? [];
}

/** OFFLINE 5 — re-queue a parked conflict (optionally with corrected fields). */
export async function requeueConflict(queueId: number, payloadOverride?: Record<string, unknown>): Promise<boolean> {
  return (await getCoop()?.sync?.requeue({ queueId, payloadOverride: payloadOverride ?? null }) ?? null) != null;
}

/** OFFLINE 5 — terminally resolve (discard) a parked conflict. */
export async function resolveConflictOp(queueId: number): Promise<boolean> {
  return (await getCoop()?.sync?.resolveConflict({ queueId }) ?? null) != null;
}

export function onSyncStatus(cb: (s: LocalSyncStatus) => void): () => void {
  const on = getCoop()?.sync?.onStatus;
  if (!on) return () => undefined;
  on(cb);
  return () => undefined; // ipcRenderer.on has no symmetric off in this bridge; single listener per app
}

export type { SyncOp, PullPayload, SyncPushResult, SyncConflictEntry };

/** The desktop backup bridge, when running inside Electron. */
export function getCoopBackup(): CoopBridge['backup'] {
  return getCoop()?.backup;
}
