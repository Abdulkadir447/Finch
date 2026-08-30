/**
 * Co-op repositories — Products (OFFLINE 2, item 2).
 * Same local-first pattern as Customers; stock-related fields travel with the
 * product, and initial stock is recorded as a local ledger movement by the
 * data layer (operation-based, ADR-002 rule 5).
 */
import type { AxiosInstance } from 'axios';
import { getLocalDb } from '../sync/localDb';
import { localBusinessId } from './identity';
import { isLocalModeActive } from './localMode';

export interface ProductValues {
  sku: string;
  name: string;
  description?: string | null;
  category?: string | null;
  unit_price: number;
  cost_price?: number | null;
  current_stock: number;
  reorder_level: number;
}

export interface ProductRepo {
  create(values: ProductValues): Promise<unknown>;
  update(id: number, values: Partial<ProductValues>): Promise<unknown>;
  remove(id: number): Promise<unknown>;
  readonly isLocal: boolean;
}

export function makeProductRepo(api: AxiosInstance): ProductRepo {
  const isLocal = isLocalModeActive();
  return {
    isLocal,
    async create(values) {
      if (isLocal) {
        const biz = await localBusinessId(api);
        await getLocalDb()!.productCreate({ business_id: biz, data: values });
        return { local: true, pending: true };
      }
      return (await api.post('/products', values)).data;
    },
    async update(id, values) {
      if (isLocal) {
        await getLocalDb()!.productUpdate({ id, data: values });
        return { local: true, pending: true };
      }
      return (await api.put(`/products/${id}`, values)).data;
    },
    async remove(id) {
      if (isLocal) {
        await getLocalDb()!.productDelete(id);
        return { local: true, pending: true };
      }
      await api.delete(`/products/${id}`);
    },
  };
}
