/**
 * Dashboard data loader — fetches every Dashboard surface in one parallel
 * round from the Finch backend (Clerk-authenticated via useApiClient).
 *
 * Honesty rule: nothing here fabricates data. Missing backend rows simply
 * produce real zeros / empty arrays, and a failed fetch surfaces as an
 * error state (UXDS 9.23) without replacing the widgets.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, useApiClient } from '../../services/api/client';

export interface DashboardSummary {
  revenue_today: number;
  orders_today: number;
  revenue_month: number;
  orders_month: number;
  revenue_growth_percent: number | null;
  profit_month: number;
  products_count: number;
  inventory_value: number;
  low_stock_count: number;
  customers_total: number;
  customers_new_month: number;
}

export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
}

export interface CategoryValue {
  category: string;
  value: number;
}

export interface ApiOrder {
  id: number;
  customer_id: number;
  customer: { full_name: string } | null;
  status: string;
  total_amount: number;
  order_date: string;
  created_at: string;
}

export interface DashboardData {
  loading: boolean;
  error: ApiError | null;
  summary: DashboardSummary | null;
  timeseries: TimeseriesPoint[];
  categories: CategoryValue[];
  orders: ApiOrder[];
  retry: () => void;
}

export function useDashboardData(): DashboardData {
  const api = useApiClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [categories, setCategories] = useState<CategoryValue[]>([]);
  const [orders, setOrders] = useState<ApiOrder[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, ts, cats, ords] = await Promise.all([
        api.get<DashboardSummary>('/dashboard/summary'),
        api.get<TimeseriesPoint[]>('/dashboard/revenue/timeseries', {
          params: { days: 30 },
        }),
        api.get<CategoryValue[]>('/dashboard/inventory/by-category'),
        api.get<{ items: ApiOrder[] }>('/orders', { params: { limit: 8 } }),
      ]);
      setSummary(s.data);
      setTimeseries(ts.data);
      setCategories(cats.data);
      setOrders(Array.isArray(ords.data?.items) ? ords.data.items : []);
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError('Unable to reach the Finch API.'),
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  return { loading, error, summary, timeseries, categories, orders, retry: load };
}
