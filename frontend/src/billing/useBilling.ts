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

/**
 * Free-trial position, as reported by the server. The trial is a window,
 * never a plan mutation — so `plan` below is the EFFECTIVE plan (the
 * trialled one while the window is open) and `base_plan` is what the
 * business actually owns. The UI must never compute expiry itself.
 */
export interface TrialState {
  /** Can a trial be started right now? (never used + feature enabled) */
  available: boolean;
  active: boolean;
  used: boolean;
  /** The window has closed — say so instead of silently reverting. */
  expired: boolean;
  plan: PlanId | null;
  label: string | null;
  days: number;
  days_remaining: number;
  started_at: string | null;
  ends_at: string | null;
}

export interface BillingSummary {
  /** Effective plan — includes an active trial grant. */
  plan: PlanId;
  label: string;
  unlimited: boolean;
  granted: number | null;
  used: number;
  remaining: number | null;
  period: { start: string; end: string };
  /** The plan owned regardless of any trial. */
  base_plan: PlanId;
  trial: TrialState | null;
  trial_days: number;
  plans: Array<{
    key: PlanId;
    label: string;
    credits_per_month: number | null;
    trialable: boolean;
  }>;
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

export type PlanActionKind = 'plan' | 'trial';

export type PlanActionState =
  | { status: 'idle' }
  | { status: 'processing'; target: PlanId | 'free'; kind: PlanActionKind }
  | { status: 'success'; target: PlanId | 'free'; kind: PlanActionKind }
  | { status: 'failure'; target: PlanId | 'free'; kind: PlanActionKind; reason: string };

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
    setAction({ status: 'processing', target: plan, kind: 'plan' });
    try {
      const { data } = await api.post<BillingSummary>('/billing/plan', { plan });
      setSummary(data);
      setAction({ status: 'success', target: plan, kind: 'plan' });
    } catch (e) {
      setAction({
        status: 'failure',
        target: plan,
        kind: 'plan',
        reason: e instanceof Error ? e.message : 'Plan change failed.',
      });
    }
  }, [api]);

  /**
   * Start the business's one free trial. The server is the only authority
   * on eligibility (409 when already used / not on Free), so we surface its
   * message rather than pre-judging it here.
   */
  const startTrial = useCallback(async (plan: PlanId) => {
    setAction({ status: 'processing', target: plan, kind: 'trial' });
    try {
      const { data } = await api.post<BillingSummary>('/billing/trial', { plan });
      setSummary(data);
      setAction({ status: 'success', target: plan, kind: 'trial' });
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: { message?: string } } } })
        ?.response?.data?.detail;
      setAction({
        status: 'failure',
        target: plan,
        kind: 'trial',
        reason: detail?.message ?? (e instanceof Error ? e.message : 'Could not start trial.'),
      });
    }
  }, [api]);

  const selectPlan = useCallback((plan: PlanId) => applyPlan(plan), [applyPlan]);
  const cancelToFree = useCallback(() => applyPlan('free'), [applyPlan]);

  const dismissResult = useCallback(() => setAction({ status: 'idle' }), []);
  const retry = useCallback(async () => {
    if (action.status !== 'failure') return;
    if (action.kind === 'trial' && action.target !== 'free') {
      await startTrial(action.target);
      return;
    }
    await applyPlan(action.target);
  }, [action, applyPlan, startTrial]);

  const currentPlan: PlanId = summary?.plan ?? 'free';
  const plan: Plan = getPlan(currentPlan);
  const trial: TrialState | null = summary?.trial ?? null;
  const trialDays = summary?.trial_days ?? 10;
  /** Trial-aware CTA label for a pricing card. */
  const ctaFor = useCallback((id: PlanId): string => {
    if (id === currentPlan) return 'Current Plan';
    if (id === 'enterprise') return 'Contact Sales';
    if (trial?.available) return `Start ${trialDays}-Day Free Trial`;
    return getPlan(id).cta;
  }, [currentPlan, trial, trialDays]);
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
    trial,
    trialDays,
    ctaFor,
    action,
    startTrial,
    selectPlan,
    cancelToFree,
    dismissResult,
    retry,
    refresh,
  };
}
