/**
 * Co-op repositories — Customers (OFFLINE 2, item 1).
 *
 * The UI calls these instead of FastAPI directly (ADR-002 rule). Each
 * operation branches:
 *   - local (desktop): write to SQLite immediately + enqueue a sync op.
 *   - remote (browser / no local layer): the existing HTTP call, unchanged.
 *
 * Reads remain server-backed for now (local reads + pull are OFFLINE 2 item 5
 * + OFFLINE 3). A local write is safe: it's stored and will sync later.
 */
import type { AxiosInstance } from 'axios';
import { getLocalDb } from '../sync/localDb';
import { localBusinessId } from './identity';
import { isLocalModeActive } from './localMode';

export interface CustomerValues {
  full_name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  address?: string | null;
}

export interface CustomerRepo {
  create(values: CustomerValues): Promise<unknown>;
  update(id: number, values: Partial<CustomerValues>): Promise<unknown>;
  remove(id: number): Promise<unknown>;
  /** True when the write went to the local layer (pending sync). */
  readonly isLocal: boolean;
}

export function makeCustomerRepo(api: AxiosInstance): CustomerRepo {
  const isLocal = isLocalModeActive();
  return {
    isLocal,
    async create(values) {
      if (isLocal) {
        const biz = await localBusinessId(api);
        const row = await getLocalDb()!.customerCreate({ business_id: biz, data: values });
        // Local row exposes id + full_name + email, like the server CustomerOut.
        return row as unknown as { id: number; full_name: string; email: string };
      }
      return (await api.post('/customers', values)).data;
    },
    async update(id, values) {
      if (isLocal) {
        await getLocalDb()!.customerUpdate({ id, data: values });
        return { local: true, pending: true };
      }
      return (await api.put(`/customers/${id}`, values)).data;
    },
    async remove(id) {
      if (isLocal) {
        await getLocalDb()!.customerDelete(id);
        return { local: true, pending: true };
      }
      await api.delete(`/customers/${id}`);
    },
  };
}
