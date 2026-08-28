/**
 * Co-op Billing — state/service layer (Stage 2.3).
 *
 * Architecture (per product direction):
 *
 *   Billing UI
 *     ↓
 *   Billing state/service  ← this file
 *     ↓
 *   BillingProvider        ← the seam. Today: LocalPreviewBillingProvider
 *                             (plan preference in localStorage, usage from
 *                             REAL Ask Co-op data). Tomorrow: a real billing
 *                             provider + finalized pricing/credit model.
 *
 * The UI never knows where plans or usage come from — it renders whatever
 * the provider reports. Selecting a plan is an async action that can
 * succeed or fail, so both result screens exist and are wired.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '../services/api/client';
import { fetchAiUsage } from '../ai/client';
import { PLAN_CATALOG, PlanId, getPlan, type Plan } from './plans';

// ---------------------------------------------------------------------------
// Provider contract — the future billing model implements this
// ---------------------------------------------------------------------------
export interface BillingUsage {
  /** Calendar month label, e.g. "Aug 2026". */
  month: string;
  /** REAL: Ask Co-op questions asked this month (local conversation store). */
  aiQueries: number;
  /** REAL: Ask Co-op conversations started this month. */
  conversations: number;
  /** REAL + metered: AI requests served by the AI backend this month. */
  aiRequests: number;
  /** REAL + metered: AI credits used this month (config-driven policy). */
  creditsUsed: number;
  /** True once the metered ledger has been read from the backend. */
  metered: boolean;
}

export type BillingResult = { ok: true } | { ok: false; reason: string };

export interface BillingProvider {
  /** 'preview' = no real charges; the UI shows the honest banner. */
  readonly mode: 'preview' | 'live';
  getCurrentPlan(): PlanId;
  selectPlan(plan: PlanId): Promise<BillingResult>;
  cancelToFree(): Promise<BillingResult>;
  getUsage(): BillingUsage;
}

// ---------------------------------------------------------------------------
// Local preview provider (the only implementation for now)
// ---------------------------------------------------------------------------
const PLAN_KEY = 'coop:billing-preview-plan';
const AI_CONVERSATIONS_KEY = 'coop:ai-conversations';

/** Read REAL Ask Co-op usage from the conversation store (no invented data). */
function readAiUsage(): BillingUsage {
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
  return { month, aiQueries, conversations, aiRequests: 0, creditsUsed: 0, metered: false };
}

function readStoredPlan(): PlanId {
  try {
    const p = localStorage.getItem(PLAN_KEY) as PlanId | null;
    if (p && (p === 'starter' || p === 'professional' || p === 'enterprise')) return p;
  } catch {
    /* fall through */
  }
  return 'free';
}

function storePlan(plan: PlanId) {
  try {
    if (plan === 'free') localStorage.removeItem(PLAN_KEY);
    else localStorage.setItem(PLAN_KEY, plan);
  } catch {
    /* storage blocked — in-memory only */
  }
}

/**
 * Preview provider: plan selection is a persisted local preference (no
 * charges, no backend). The async delay makes the processing → success
 * flow honest and testable; a real provider will do real work here.
 */
class LocalPreviewBillingProvider implements BillingProvider {
  readonly mode = 'preview' as const;
  private plan: PlanId = readStoredPlan();

  getCurrentPlan(): PlanId {
    return this.plan;
  }

  async selectPlan(plan: PlanId): Promise<BillingResult> {
    await new Promise((r) => setTimeout(r, 600)); // simulated processing
    storePlan(plan);
    this.plan = plan;
    return { ok: true };
  }

  async cancelToFree(): Promise<BillingResult> {
    await new Promise((r) => setTimeout(r, 600));
    storePlan('free');
    this.plan = 'free';
    return { ok: true };
  }

  getUsage(): BillingUsage {
    return readAiUsage();
  }
}

const provider: BillingProvider = new LocalPreviewBillingProvider();

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
  const [currentPlan, setCurrentPlan] = useState<PlanId>(provider.getCurrentPlan());
  const [usage, setUsage] = useState<BillingUsage>({
    ...provider.getUsage(),
    aiRequests: 0,
    creditsUsed: 0,
    metered: false,
  });
  const [action, setAction] = useState<PlanActionState>({ status: 'idle' });

  const refresh = useCallback(() => {
    setCurrentPlan(provider.getCurrentPlan());
    setUsage((u) => ({ ...provider.getUsage(), aiRequests: u.aiRequests, creditsUsed: u.creditsUsed, metered: u.metered }));
    // Metered AI usage comes from the real ledger (billing's source of truth).
    fetchAiUsage(api)
      .then((m) => setUsage((u) => ({ ...u, month: m.month, aiRequests: m.requests, creditsUsed: m.credits_used, metered: true })))
      .catch(() => undefined); // ledger unreachable → keep local-only usage
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectPlan = useCallback(
    async (plan: PlanId) => {
      setAction({ status: 'processing', target: plan });
      const result = await provider.selectPlan(plan);
      if (result.ok) {
        refresh();
        setAction({ status: 'success', target: plan });
      } else {
        setAction({ status: 'failure', target: plan, reason: result.reason });
      }
    },
    [refresh],
  );

  const cancelToFree = useCallback(async () => {
    setAction({ status: 'processing', target: 'free' });
    const result = await provider.cancelToFree();
    if (result.ok) {
      refresh();
      setAction({ status: 'success', target: 'free' });
    } else {
      setAction({ status: 'failure', target: 'free', reason: result.reason });
    }
  }, [refresh]);

  const dismissResult = useCallback(() => setAction({ status: 'idle' }), []);
  const retry = useCallback(async () => {
    if (action.status !== 'failure') return;
    const target = action.target;
    if (target === 'free') await cancelToFree();
    else await selectPlan(target);
  }, [action, cancelToFree, selectPlan]);

  const plan: Plan = getPlan(currentPlan);
  const preview = provider.mode === 'preview';

  return {
    plans: PLAN_CATALOG,
    plan,
    currentPlan,
    usage,
    preview,
    action,
    selectPlan,
    cancelToFree,
    dismissResult,
    retry,
    refresh,
  };
}
