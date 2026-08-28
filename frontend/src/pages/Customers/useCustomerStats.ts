/**
 * Per-customer purchase stats — derived from the EXISTING orders endpoint.
 *
 * The backend has no /customers/{id}/orders route (and none is added — this
 * stage is a UI refactor), so stats come from `GET /orders?search=<name>`
 * with a client-side filter on `order.customer.id`. That keeps the numbers
 * exact even when two customers share a name, and uses only the current API.
 *
 *   Orders count  = orders for that customer
 *   Total spent   = Σ total_amount
 *   Avg order     = total / count
 *   Last order    = max(order_date)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../services/api/client';
import type { ApiOrder } from '../Dashboard/useDashboardData';
import type { Customer } from './useCustomers';

export interface CustomerStats {
  orders: number;
  total: number;
  aov: number | null;
  lastOrderAt: string | null;
}

const EMPTY: CustomerStats = { orders: 0, total: 0, aov: null, lastOrderAt: null };

export function useCustomerStats(customers: Customer[]): {
  stats: Record<number, CustomerStats>;
  statsLoading: boolean;
} {
  const api = useApiClient();
  const [stats, setStats] = useState<Record<number, CustomerStats>>({});
  const [statsLoading, setStatsLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (list: Customer[]) => {
      if (list.length === 0) {
        setStats({});
        return;
      }
      const mySeq = ++seq.current;
      setStatsLoading(true);
      try {
        const results = await Promise.all(
          list.map(async (c): Promise<[number, CustomerStats] | null> => {
            try {
              const { data } = await api.get<{ items: ApiOrder[] }>(
                `/orders?search=${encodeURIComponent(c.full_name)}&limit=100`,
              );
              // Exact match on the order's customer_id (guards against
              // shared customer names).
              const theirs = (data.items ?? []).filter((o) => o.customer_id === c.id);
              if (theirs.length === 0) return null;
              const total = theirs.reduce((sum, o) => sum + o.total_amount, 0);
              const lastOrderAt = theirs.reduce<string | null>(
                (latest, o) => (!latest || o.order_date > latest ? o.order_date : latest),
                null,
              );
              return [
                c.id,
                {
                  orders: theirs.length,
                  total: Math.round(total * 100) / 100,
                  aov: Math.round((total / theirs.length) * 100) / 100,
                  lastOrderAt,
                },
              ];
            } catch {
              return null; // one customer's stats failing must not blank the page
            }
          }),
        );
        if (mySeq !== seq.current) return;
        const next: Record<number, CustomerStats> = {};
        for (const c of list) next[c.id] = EMPTY;
        for (const r of results) {
          if (r != null) next[r[0]] = r[1];
        }
        setStats(next);
      } finally {
        if (mySeq === seq.current) setStatsLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void load(customers);
  }, [customers, load]);

  return { stats, statsLoading };
}

/**
 * Customer activity status (catalog "Status" column) — derived from real
 * data, no status field invented:
 *   new      → created within the last 30 days
 *   active   → an order within the last 90 days
 *   inactive → no recent orders
 */
export type CustomerActivity = 'new' | 'active' | 'inactive';

const DAY = 24 * 60 * 60 * 1000;

export function customerActivity(customer: Customer, stats?: CustomerStats): CustomerActivity {
  const now = Date.now();
  if (now - new Date(customer.created_at).getTime() <= 30 * DAY) return 'new';
  if (stats?.lastOrderAt && now - new Date(stats.lastOrderAt).getTime() <= 90 * DAY) return 'active';
  return 'inactive';
}

/** "Key Account" tier (PRD: identify VIP customers via total spent). */
export const KEY_ACCOUNT_THRESHOLD = 10_000;
