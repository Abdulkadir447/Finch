/**
 * Co-op AI — data bundle (Stage 2.2).
 *
 * One parallel round over EXISTING endpoints only. The AI layer never talks
 * to the database; this is its entire data path.
 *
 *   /dashboard/summary            — KPIs, growth
 *   /dashboard/revenue/timeseries — 30-day daily revenue (trends/forecast)
 *   /dashboard/top-products       — best sellers (concentration, table)
 *   /inventory/summary            — stock health counts
 *   /products?stock=low|out       — the actual at-risk SKUs
 *   /customers?limit=100          — base list (recency analysis window)
 *   /orders?limit=100             — recent orders (recency, counts)
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, useApiClient } from '../services/api/client';
import type { DashboardSummary, TimeseriesPoint, TopProduct } from '../pages/Dashboard/useDashboardData';
import type { InventorySummary } from '../pages/Inventory/useInventory';
import type { Product } from '../pages/Products/useProducts';
import type { Customer } from '../pages/Customers/useCustomers';
import type { Order } from '../pages/Orders/useOrders';

export interface AiDataBundle {
  summary: DashboardSummary | null;
  timeseries: TimeseriesPoint[];
  topProducts: TopProduct[];
  inventory: InventorySummary | null;
  lowStock: Product[];
  outOfStock: Product[];
  customers: Customer[];
  recentOrders: Order[];
  /** True when there is enough signal to compute insights at all. */
  sufficient: boolean;
}

const EMPTY: AiDataBundle = {
  summary: null,
  timeseries: [],
  topProducts: [],
  inventory: null,
  lowStock: [],
  outOfStock: [],
  customers: [],
  recentOrders: [],
  sufficient: false,
};

export function useAiData() {
  const api = useApiClient();
  const [bundle, setBundle] = useState<AiDataBundle>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, ts, tops, inv, low, out, cust, ords] = await Promise.all([
        api.get<DashboardSummary>('/dashboard/summary'),
        api.get<TimeseriesPoint[]>('/dashboard/revenue/timeseries', { params: { days: 30 } }),
        api.get<TopProduct[]>('/dashboard/top-products', { params: { limit: 5 } }),
        api.get<InventorySummary>('/inventory/summary').catch(() => null),
        api.get<{ items: Product[] }>('/products', { params: { stock: 'low', limit: 5 } }).catch(() => null),
        api.get<{ items: Product[] }>('/products', { params: { stock: 'out', limit: 5 } }).catch(() => null),
        api.get<{ items: Customer[] }>('/customers', { params: { limit: 100 } }).catch(() => null),
        api.get<{ items: Order[] }>('/orders', { params: { limit: 100 } }).catch(() => null),
      ]);
      setBundle({
        summary: summary.data,
        timeseries: ts.data ?? [],
        topProducts: tops.data ?? [],
        inventory: inv?.data ?? null,
        lowStock: low?.data.items ?? [],
        outOfStock: out?.data.items ?? [],
        customers: cust?.data.items ?? [],
        recentOrders: ords?.data.items ?? [],
        sufficient:
          (summary.data.products_count ?? 0) > 0 || (ords?.data.items?.length ?? 0) > 0,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('Unable to load business data.'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return { bundle, loading, error, retry: load };
}
