/**
 * OFFLINE 5 — conflict resolutions.
 *
 * Maps a user's choice on a parked conflict to CONCRETE ACTIONS that all go
 * through the normal repository/sync pathway — the UI never mutates the
 * database directly:
 *
 *   - "change a value and retry"  -> the corrected op is re-queued (same
 *     client_id) or enqueued through the repository, then pushed and
 *     re-validated by the server;
 *   - "keep cloud"                 -> the local row is corrected through a
 *     resolution-only data-layer method (or a converging repository update),
 *     and the conflict is terminally resolved;
 *   - "discard"                    -> the op is terminally resolved.
 *
 * After any resolution, a manual sync cycle is requested so the new op is
 * pushed immediately (when online).
 */
import type { AxiosInstance } from 'axios';
import {
  makeCustomerRepo,
  makeOrderRepo,
  makeProductRepo,
  type OrderStatusValue,
} from '../repositories';
import { localBusinessIdLocal } from '../repositories/identity';
import { ALLOWED_ORDER_TRANSITIONS } from '../pages/Orders/useOrders';
import {
  getLocalDb,
  requeueConflict,
  resolveConflictOp,
  type ParkedConflict,
} from './localDb';
import { requestManualSync } from './engine';

export type ResolutionKind =
  | 'new_value' // corrected value re-queued / re-enqueued, then synced
  | 'keep_cloud' // local corrected to cloud value, op resolved
  | 'retry' // same op re-queued (e.g. after a cloud restock)
  | 'discard'; // op dropped (terminal)

export interface ResolutionResult {
  kind: ResolutionKind;
  detail: string;
}

export class ResolutionError extends Error {}

const str = (v: unknown): string => (v == null ? '' : String(v));

/**
 * Apply a resolution to a parked conflict.
 *
 * choice:
 *   { act: 'new_value', value: string }  — new email / SKU
 *   { act: 'keep_cloud' }
 *   { act: 'retry' }
 *   { act: 'discard' }
 *   { act: 'set_status', value: string } — deliberate new order status
 */
export async function resolveConflict(
  c: ParkedConflict,
  choice: { act: string; value?: string },
  api: AxiosInstance,
): Promise<ResolutionResult> {
  const db = getLocalDb();
  if (!db) throw new ResolutionError('Local data layer unavailable.');
  const conf = c.conflict;
  if (!conf) throw new ResolutionError('This conflict has no server context.');
  const server = (conf.server ?? {}) as Record<string, unknown>;
  const local = (conf.local ?? {}) as Record<string, unknown>;

  switch (conf.reason) {
    // ------------------------------------------------------------------
    case 'email_conflict': {
      if (choice.act === 'new_value') {
        const email = (choice.value ?? '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new ResolutionError('Enter a valid email address.');
        }
        if (c.operation === 'create') {
          await requeueConflict(c.id, { email });
          return { kind: 'new_value', detail: `Re-queued with ${email} — will sync now.` };
        }
        // update: the row exists on the server — go through the repository
        // (writes the local row + enqueues a fresh update op).
        await makeCustomerRepo(api).update(c.entity_id, { email });
        await resolveConflictOp(c.id);
        return { kind: 'new_value', detail: `Change to ${email} queued — will sync now.` };
      }
      if (choice.act === 'keep_cloud') {
        if (c.operation === 'create') {
          // Never-synced local customer: drop it locally, no cloud op exists.
          await db.customerDiscardLocal(c.entity_id);
        } else {
          // Converge the local row back to the cloud values via the repo.
          const values: Record<string, unknown> = {};
          if (server.email != null) values.email = server.email;
          if (server.full_name != null) values.full_name = server.full_name;
          await makeCustomerRepo(api).update(c.entity_id, values);
        }
        await resolveConflictOp(c.id);
        return {
          kind: 'keep_cloud',
          detail: c.operation === 'create'
            ? 'Local customer discarded — the cloud record is kept.'
            : 'Cloud values restored locally — the change is dropped.',
        };
      }
      throw new ResolutionError('Unsupported choice.');
    }

    // ------------------------------------------------------------------
    case 'sku_conflict': {
      if (choice.act === 'new_value') {
        const sku = (choice.value ?? '').trim();
        if (!sku) throw new ResolutionError('Enter a new SKU.');
        if (c.operation === 'create') {
          await requeueConflict(c.id, { sku });
          return { kind: 'new_value', detail: `Re-queued with SKU ${sku} — will sync now.` };
        }
        await makeProductRepo(api).update(c.entity_id, { sku });
        await resolveConflictOp(c.id);
        return { kind: 'new_value', detail: `SKU change to ${sku} queued — will sync now.` };
      }
      if (choice.act === 'keep_cloud') {
        if (c.operation === 'create') {
          await db.productDiscardLocal(c.entity_id);
        } else {
          const values: Record<string, unknown> = {};
          if (server.sku != null) values.sku = server.sku;
          if (server.name != null) values.name = server.name;
          await makeProductRepo(api).update(c.entity_id, values);
        }
        await resolveConflictOp(c.id);
        return {
          kind: 'keep_cloud',
          detail: c.operation === 'create'
            ? 'Local product discarded — the cloud record is kept.'
            : 'Cloud values restored locally — the change is dropped.',
        };
      }
      throw new ResolutionError('Unsupported choice.');
    }

    // ------------------------------------------------------------------
    case 'insufficient_stock': {
      if (choice.act === 'retry') {
        await requeueConflict(c.id);
        return { kind: 'retry', detail: 'Movement re-queued — will retry on the next sync.' };
      }
      if (choice.act === 'discard') {
        // Align local stock to the cloud value (local-only correction with a
        // 'correction' ledger entry; no queue op — pushing again would just
        // re-conflict). The product's LOCAL id is resolved from the
        // movement's product_client_id.
        const products = await db.productList({ business_id: await localBusinessIdLocal(), opts: { limit: 100000 } });
        const clientId = str(c.payload.product_client_id);
        const product = products.find((p) => p.client_id === clientId);
        if (!product) throw new ResolutionError('The product for this movement is no longer in the local database.');
        const cloudStock = Number(server.current_stock ?? 0);
        await db.stockSetLocal({
          product_id: product.id,
          value: cloudStock,
          note: 'Sync conflict resolution: aligned to cloud stock (rejected movement discarded)',
        });
        await resolveConflictOp(c.id);
        return {
          kind: 'discard',
          detail: `Movement discarded; local stock aligned to ${cloudStock}.`,
        };
      }
      throw new ResolutionError('Unsupported choice.');
    }

    // ------------------------------------------------------------------
    case 'invalid_transition': {
      if (choice.act === 'set_status' && choice.value) {
        // A deliberate new status — pushed and re-validated by the server
        // (if the cloud moved again in between, it conflicts again).
        await makeOrderRepo(api).setStatus(c.entity_id, choice.value as OrderStatusValue);
        await resolveConflictOp(c.id);
        return { kind: 'new_value', detail: `Status change to “${choice.value}” queued — will sync now.` };
      }
      if (choice.act === 'keep_cloud') {
        const cloudStatus = str(server.status);
        // A no-op status update converges the local row to the cloud value
        // (the server treats same-status updates as an idempotent skip).
        await makeOrderRepo(api).setStatus(c.entity_id, cloudStatus as OrderStatusValue);
        await resolveConflictOp(c.id);
        return { kind: 'keep_cloud', detail: `Cloud status “${cloudStatus}” kept.` };
      }
      throw new ResolutionError('Unsupported choice.');
    }

    // ------------------------------------------------------------------
    case 'not_found': {
      if (choice.act === 'discard') {
        await resolveConflictOp(c.id);
        return {
          kind: 'discard',
          detail: 'Operation dropped. The local record (if any) stays on this device.',
        };
      }
      throw new ResolutionError('Unsupported choice.');
    }

    // ------------------------------------------------------------------
    default: {
      // Unknown reason codes still get a safe escape hatch: discard.
      if (choice.act === 'discard') {
        await resolveConflictOp(c.id);
        return { kind: 'discard', detail: 'Operation dropped.' };
      }
      throw new ResolutionError('Unsupported choice.');
    }
  }
}

/** Kick a sync cycle after a resolution (no-op when offline — the op syncs
 *  on reconnect, which is the expected offline behaviour). */
export function syncAfterResolution(): void {
  requestManualSync();
}

/** Human titles per reason (the Sync Center card header). */
export const CONFLICT_TITLES: Record<string, string> = {
  email_conflict: 'Customer email conflict',
  sku_conflict: 'Product SKU conflict',
  insufficient_stock: 'Stock movement rejected',
  invalid_transition: 'Order status conflict',
  not_found: 'Reference not found',
};

/** The legal next statuses for an order currently in `from` (the local
 *  port of the server's transition machine — single source of truth). */
export function legalNextStatuses(from: string): string[] {
  return ALLOWED_ORDER_TRANSITIONS[from as keyof typeof ALLOWED_ORDER_TRANSITIONS] ?? [];
}
