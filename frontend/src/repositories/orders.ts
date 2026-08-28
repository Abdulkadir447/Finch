/**
 * Co-op repositories — Orders (OFFLINE 2, item 4).
 *
 * Local-first order creation: the data layer generates a ULID client_id,
 * applies the stock deduction locally (operation-based), and enqueues the
 * order + items + movements for sync. The UI shows a "Pending sync" state.
 *
 * ID mapping note (ADR-002 / OFFLINE 3): local order creation references the
 * customer/products by their LOCAL ids. Those local rows are established by
 * the pull/refresh half of sync (OFFLINE 3), which maintains a
 * server-id -> local-id map. Until pull exists, local order creation is fully
 * functional for locally-consistent data (e.g. an offline session); the
 * remote path is unchanged and always works.
 */
import type { AxiosInstance } from 'axios';
import { getLocalDb } from '../sync/localDb';
import { localBusinessId } from './identity';
import { isLocalModeActive } from './localMode';

export interface OrderLineInput {
  product_id: number;
  quantity: number;
  unit_price: number;
}

export interface OrderInput {
  customer_id: number;
  items: OrderLineInput[];
  order_date?: string | null;
}

export type OrderStatusValue =
  | 'pending'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface OrderRepo {
  create(input: OrderInput): Promise<unknown>;
  setStatus(id: number, status: OrderStatusValue): Promise<unknown>;
  /** True when order writes go to the local layer (pending sync). */
  readonly isLocal: boolean;
}

export function makeOrderRepo(api: AxiosInstance): OrderRepo {
  const isLocal = isLocalModeActive();
  return {
    isLocal,
    async create(input) {
      if (isLocal) {
        const biz = await localBusinessId(api);
        // The server computes total_amount server-side; locally we compute the
        // same sum from the lines so the local row matches what the server
        // would store (and the success screen can show it).
        const total_amount = input.items.reduce(
          (s, it) => s + it.quantity * it.unit_price,
          0,
        );
        const row = await getLocalDb()!.orderCreate({
          business_id: biz,
          data: { ...input, total_amount },
        });
        // Local row exposes id + total_amount, like the server OrderOut.
        return row as unknown as { id: number; total_amount: number };
      }
      return (await api.post('/orders', input)).data;
    },
    async setStatus(id, status) {
      if (isLocal) {
        const biz = await localBusinessId(api);
        await getLocalDb()!.orderSetStatus({ business_id: biz, order_id: id, status });
        return { local: true, pending: true };
      }
      return (await api.put(`/orders/${id}/status`, { status })).data;
    },
  };
}
