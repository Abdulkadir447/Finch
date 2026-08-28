/**
 * Co-op repositories — Inventory / stock (OFFLINE 2, item 3).
 *
 * Stock is operation-based (ADR-002 rule 5): an adjustment is a signed
 * movement, never a final stock number. Locally the data layer applies the
 * movement and enqueues it; the server re-applies + re-validates on sync.
 */
import type { AxiosInstance } from 'axios';
import { getLocalDb } from '../sync/localDb';
import { localBusinessId } from './identity';
import { isLocalModeActive } from './localMode';

export type AdjustReason = 'purchase' | 'sale' | 'damaged' | 'returned' | 'correction';
export interface AdjustInput {
  change: number;
  reason: AdjustReason;
  note?: string;
}

export interface InventoryRepo {
  adjust(productId: number, input: AdjustInput): Promise<unknown>;
  /** True when stock ops go to the local layer (pending sync). */
  readonly isLocal: boolean;
}

export function makeInventoryRepo(api: AxiosInstance): InventoryRepo {
  const isLocal = isLocalModeActive();
  return {
    isLocal,
    async adjust(productId, input) {
      if (isLocal) {
        const biz = await localBusinessId(api);
        await getLocalDb()!.stockAdjust({
          business_id: biz,
          product_id: productId,
          change: input.change,
          reason: input.reason,
          opts: input.note ? { note: input.note } : undefined,
        });
        return { local: true, pending: true };
      }
      return (await api.post(`/products/${productId}/adjust`, input)).data;
    },
  };
}
