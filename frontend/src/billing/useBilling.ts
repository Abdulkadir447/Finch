/**
 * Co-op Billing — state/service layer (Real Billing phase).
 *
 * What is REAL now (server-side state, shared across devices):
 *   - the active plan (subscriptions)
 *   - credits granted (plan allowance, config-driven)
 *   - credits used (the ai_usage ledger — single source of truth)
 *   - remaining balance (computed: allowance − ledger)
 *   - plan changes (enforcement updates immediately)
 *
 * What is still preview (by design, until a payment provider connects):
 *   - collecting payment — nothing is charged; the UI says so honestly.
 *
 * The UI never knows where plans or credits come from — it renders what
 * the backend reports. Selecting a plan is async and can succeed/fail, so
 * both result screens exist and are wired.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '../services/api/client';
import { PLAN_CATALOG, PlanId, getPlan, type Plan } from './plans';

// ---------------------------------------------------------------------------
// Backend contract
// ---------------------------------------------------------------------------

export interface BillingSummary {
  plan: PlanId;
  label: string;
  unlimited: boolean;
  granted: number | null;
  used: number;
  remaining: number | null;
  period: { start: string; end: string };
  plans: Array<{ key: PlanId; label: string; credits_per_month: number | null }>;
  usage_month: {
    requests: number;
    input_tokens: number;
    output_tokens: number;
    credits_used: number;
  };
  payment_connected: boolean;
}

// Local (this device) conversation activity — real, but not metered billing.
export interface LocalAiUsage {
  month: string;
  aiQueries: number;
  conversations: number;
}

export type BillingResult = { ok: true } | { ok: false; reason: string };

const AI_CONVERSATIONS_KEY = 'coop:ai-conversations';

function readLocalAiUsage(): LocalAiUsage {
  const now = new Date();
  const month = now.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let aiQueries = 0;
  let conversations = 0;
  try {
    const raw = localStorage.getItem(AI_CONVERSATIONS_KEY);
    if (raw) {
      const convs = JSON.parse(raw) as Array<{ created: number; messages: Array<{ role: string }> }>;
      for (const c of convs) {
        if (c.created >= startOfMonth) conversations++;
        aiQueries += c.messages.filter((m) => m.role === 'user').length;
      }
    }
  } catch {
    /* corrupted store → zero usage, not a crash */
  }
  return { month, aiQueries, conversations };
}

// ---------------------------------------------------------------------------
// Hook — the only surface the billing UI consumes
// ---------------------------------------------------------------------------

export type PlanActionState =
  | { status: 'idle' }
  | { status: 'processing'; target: PlanId | 'free' }
  | { status: 'success'; target: PlanId | 'free' }
  | { status: 'failure'; target: PlanId | 'free'; reason: string };

export function useBilling() {
  const api = useApiClient();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localUsage, setLocalUsage] = useState<LocalAiUsage>(readLocalAiUsage);
  const [action, setAction] = useState<PlanActionState>({ status: 'idle' });

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const { data } = await api.get<BillingSummary>('/billing/summary');
      setSummary(data);
      setLocalUsage(readLocalAiUsage());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load billing.');
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyPlan = useCallback(async (plan: PlanId | 'free') => {
    setAction({ status: 'processing', target: plan });
    try {
      const { data } = await api.post<BillingSummary>('/billing/plan', { plan });
      setSummary(data);
      setAction({ status: 'success', target: plan });
    } catch (e) {
      setAction({
        status: 'failure',
        target: plan,
        reason: e instanceof Error ? e.message : 'Plan change failed.',
      });
    }
  }, [api]);

  const selectPlan = useCallback((plan: PlanId) => applyPlan(plan), [applyPlan]);
  const cancelToFree = useCallback(() => applyPlan('free'), [applyPlan]);

  const dismissResult = useCallback(() => setAction({ status: 'idle' }), []);
  const retry = useCallback(async () => {
    if (action.status !== 'failure') return;
    await applyPlan(action.target);
  }, [action, applyPlan]);

  const currentPlan: PlanId = summary?.plan ?? 'free';
  const plan: Plan = getPlan(currentPlan);
  // Payment collection is the only preview concern left; plans/credits are real.
  const paymentConnected = summary?.payment_connected ?? false;

  return {
    plans: PLAN_CATALOG,
    plan,
    currentPlan,
    summary,
    localUsage,
    loadError,
    paymentConnected,
    action,
    selectPlan,
    cancelToFree,
    dismissResult,
    retry,
    refresh,
  };
}
