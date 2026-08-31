/**
 * Daily Business Summary — types + hook (PRD v1 daily notification).
 *
 * The backend computes this on demand from the existing reporting/briefing
 * layer (no second calculation path, no persistence, no scheduler). The
 * hook just fetches and exposes it; the presentation lives in
 * NotificationsPopover.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '../services/api/client';
import { getNotificationPrefs, subscribeNotificationPrefs } from './prefs';

export interface DailySummaryInsight {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  evidence: string;
  link: string;
}

export interface DailySummary {
  date: string;
  generated_at: string;
  business: { name: string; currency: string };
  has_data: boolean;
  notable: boolean;
  empty_message: string | null;
  today: { revenue: number; orders: number };
  comparison: {
    vs_yesterday: { revenue: number; orders: number; change_percent: number | null };
    month_to_date: {
      revenue: number;
      orders: number;
      previous_period_revenue: number | null;
      change_percent: number | null;
    };
  };
  notable_change: {
    direction: 'up' | 'down';
    period: 'yesterday' | 'month_to_date';
    message: string;
  } | null;
  inventory: {
    low_count: number;
    out_count: number;
    low_items: Array<{ name: string; sku: string; stock: number; reorder_level: number }>;
    out_items: Array<{ name: string; sku: string }>;
  };
  customers: { new_today: number; new_names: string[] };
  insights: DailySummaryInsight[];
}

export interface DailySummaryState {
  status: 'loading' | 'ready' | 'error';
  data: DailySummary | null;
}

export function useDailySummary(): DailySummaryState & { reload: () => void; enabled: boolean } {
  const api = useApiClient();
  const [state, setState] = useState<DailySummaryState>({ status: 'loading', data: null });
  const [enabled, setEnabled] = useState<boolean>(() => getNotificationPrefs().dailySummary);

  // The Settings → Notifications toggle gates the fetch itself.
  useEffect(() => subscribeNotificationPrefs(() => setEnabled(getNotificationPrefs().dailySummary)), []);

  const reload = useCallback(async () => {
    if (!getNotificationPrefs().dailySummary) {
      setState({ status: 'loading', data: null });
      return;
    }
    try {
      const { data } = await api.get<DailySummary>('/notifications/daily-summary');
      setState({ status: 'ready', data });
    } catch {
      // Keep a previously loaded summary; only surface error if we have none.
      setState((s) => (s.data ? s : { status: 'error', data: null }));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload, enabled]);

  return { ...state, reload, enabled };
}
