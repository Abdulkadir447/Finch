/**
 * Dashboard data loader — fetches every Dashboard surface in one parallel
 * round from the Co-op backend (Clerk-authenticated via useApiClient).
 *
 * Honesty rule: nothing here fabricates data. Missing backend rows simply
 * produce real zeros / empty arrays, and a failed fetch surfaces as an
 * error state (UXDS 9.23) without replacing the widgets.
 *
 * Stage 4 (Stitch dashboard) added two read-only surfaces to the SAME
 * parallel round — `topProducts` (/dashboard/top-products) and `business`
 * (company name + currency for the page header) — plus a `lastUpdated`
 * timestamp. All existing fields are unchanged.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, useApiClient } from '../../services/api/client';
import { isLocalModeActive } from '../../repositories';
import { getLocalBundle } from '../../analytics/localData';
import {
  byCategory,
  recentOrders,
  summary as localSummary,
  timeseries as localTimeseries,
  topProducts as localTopProducts,
} from '../../analytics/localDashboard';

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
  out_of_stock_count: number;
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
  /** Owning customer (exact-match key for per-customer stats). */
  customer_id: number;
  customer: { full_name: string } | null;
  status: string;
  total_amount: number;
  order_date: string;
  created_at: string;
}

export interface TopProduct {
  product_id: number;
  product_name: string;
  total_quantity: number;
  total_revenue: number;
}

export interface BusinessIdentity {
  name: string;
  currency: string;
}

export interface DashboardData {
  loading: boolean;
  error: ApiError | null;
  summary: DashboardSummary | null;
  timeseries: TimeseriesPoint[];
  categories: CategoryValue[];
  orders: ApiOrder[];
  /** /dashboard/top-products — best sellers by units sold (Stage 4). */
  topProducts: TopProduct[];
  /** Company name + currency for the page header (Stage 4). */
  business: BusinessIdentity | null;
  /** When the last successful load finished (null until first load). */
  lastUpdated: Date | null;
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
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [business, setBusiness] = useState<BusinessIdentity | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // OFFLINE 3.5: local mode — the same KPIs from the SQLite mirror
      // (verbatim port of the server's dashboard endpoints).
      if (isLocalModeActive()) {
        const b = await getLocalBundle();
        setSummary(localSummary(b));
        setTimeseries(localTimeseries(b, 30));
        setCategories(byCategory(b));
        setOrders(recentOrders(b, 8));
        setTopProducts(localTopProducts(b, 5));
        setBusiness({ name: b.business.name, currency: b.business.currency });
        setLastUpdated(new Date());
        return;
      }
      const [s, ts, cats, ords, tops, biz] = await Promise.all([
        api.get<DashboardSummary>('/dashboard/summary'),
        api.get<TimeseriesPoint[]>('/dashboard/revenue/timeseries', {
          params: { days: 30 },
        }),
        api.get<CategoryValue[]>('/dashboard/inventory/by-category'),
        api.get<{ items: ApiOrder[] }>('/orders', { params: { limit: 8 } }),
        api.get<TopProduct[]>('/dashboard/top-products', { params: { limit: 5 } }),
        // Header identity is best-effort: a failed settings fetch should not
        // blank the whole dashboard — the core surfaces stay authoritative.
        api.get<BusinessIdentity>('/business/settings').catch(() => null),
      ]);
      setSummary(s.data);
      setTimeseries(ts.data);
      setCategories(cats.data);
      setOrders(Array.isArray(ords.data?.items) ? ords.data.items : []);
      setTopProducts(Array.isArray(tops.data) ? tops.data : []);
      setBusiness(biz?.data ?? null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('Unable to reach the Co-op API.'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    error,
    summary,
    timeseries,
    categories,
    orders,
    topProducts,
    business,
    lastUpdated,
    retry: load,
  };
}
