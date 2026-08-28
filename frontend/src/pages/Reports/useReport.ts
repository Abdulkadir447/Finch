/**
 * Reports — data hook (Reports phase).
 *
 * Single fetch path for the report dataset: the same filters the screen uses
 * are sent to the reporting engine, which is ALSO what exports and the AI
 * read — so the KPIs, the file and the explanation always agree.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '../../services/api/client';
import {
  presetDates,
  type CompareMode,
  type PeriodPreset,
  type ReportData,
  type ReportFilterState,
} from './reportConfig';

export interface ReportMeta {
  reports: Array<{ key: string; title: string }>;
  categories: string[];
  compare_options: string[];
}

function defaultFilters(): ReportFilterState {
  const { from, to } = presetDates('30d');
  return { preset: '30d', from, to, compare: 'none', category: '', product_id: null, customer_id: null };
}

function toParams(f: ReportFilterState): Record<string, string | number> {
  const p: Record<string, string | number> = { from: f.from, to: f.to, compare: f.compare };
  if (f.category) p.category = f.category;
  if (f.product_id) p.product_id = f.product_id;
  if (f.customer_id) p.customer_id = f.customer_id;
  return p;
}

export function useReport(key: string) {
  const api = useApiClient();
  const [filters, setFilters] = useState<ReportFilterState>(defaultFilters);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<ReportMeta | null>(null);

  // Meta (categories etc.) once.
  useEffect(() => {
    api.get<ReportMeta>('/reports/meta').then((r) => setMeta(r.data)).catch(() => undefined);
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<ReportData>(`/reports/${key}`, { params: toParams(filters) });
      setData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the report.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, key, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const setPreset = useCallback((preset: PeriodPreset) => {
    setFilters((f) => ({ ...f, preset, ...presetDates(preset) }));
  }, []);
  const setCustomRange = useCallback((from: string, to: string) => {
    setFilters((f) => ({ ...f, preset: 'custom', from, to }));
  }, []);
  const setCompare = useCallback((compare: CompareMode) => {
    setFilters((f) => ({ ...f, compare }));
  }, []);
  const setCategory = useCallback((category: string) => {
    setFilters((f) => ({ ...f, category }));
  }, []);
  const setProduct = useCallback((product_id: number | null) => {
    setFilters((f) => ({ ...f, product_id }));
  }, []);
  const setCustomer = useCallback((customer_id: number | null) => {
    setFilters((f) => ({ ...f, customer_id }));
  }, []);
  const reset = useCallback(() => setFilters(defaultFilters()), []);

  return {
    data,
    loading,
    error,
    retry: load,
    meta,
    filters,
    setPreset,
    setCustomRange,
    setCompare,
    setCategory,
    setProduct,
    setCustomer,
    reset,
  };
}
