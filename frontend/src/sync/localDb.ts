/**
 * Co-op sync — local data-layer access (OFFLINE 1/2).
 *
 * A typed wrapper over the Electron IPC bridge (`window.coop.db`). In a plain
 * browser this is absent, so `isLocalAvailable()` is false and the app uses
 * the remote API as it does today. OFFLINE 2 routes the UI's core operations
 * through these repositories; until then this is the seam.
 */
import type { SyncOp } from './types';

export interface LocalRow {
  id: number;
  client_id: string;
  business_id: number;
  [key: string]: unknown;
}

export interface LocalDb {
  businessEnsure(b: { client_id: string; name: string; currency?: string }): Promise<LocalRow>;
  customerCreate(a: { business_id: number; data: Record<string, unknown> }): Promise<LocalRow>;
  customerUpdate(a: { id: number; data: Record<string, unknown> }): Promise<LocalRow>;
  customerDelete(id: number): Promise<LocalRow>;
  customerGet(id: number): Promise<LocalRow | null>;
  customerList(bizId: number): Promise<LocalRow[]>;
  productCreate(a: { business_id: number; data: Record<string, unknown> }): Promise<LocalRow>;
  productUpdate(a: { id: number; data: Record<string, unknown> }): Promise<LocalRow>;
  productDelete(id: number): Promise<LocalRow>;
  productGet(id: number): Promise<LocalRow | null>;
  productList(bizId: number): Promise<LocalRow[]>;
  orderCreate(a: { business_id: number; data: Record<string, unknown> }): Promise<LocalRow>;
  orderSetStatus(a: { business_id: number; order_id: number; status: string }): Promise<LocalRow>;
  orderGet(id: number): Promise<LocalRow | null>;
  orderList(bizId: number): Promise<LocalRow[]>;
  stockAdjust(a: {
    business_id: number;
    product_id: number;
    change: number;
    reason: string;
    opts?: Record<string, unknown>;
  }): Promise<LocalRow>;
  stockMovements(a: { business_id: number; product_id?: number | null }): Promise<LocalRow[]>;
}

interface CoopBridge {
  db?: LocalDb;
  sync?: { status: () => Promise<{ online: boolean; pending: number; syncing: boolean }> };
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

export type { SyncOp };
