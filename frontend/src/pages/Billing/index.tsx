import React, { useState } from 'react';
import { message } from 'antd';
import {
  CreditCardOutlined,
  CustomerServiceOutlined,
  ExclamationCircleFilled,
  FileTextOutlined,
  InfoCircleFilled,
  ReloadOutlined,
} from '@ant-design/icons';
import { radius, type } from '../../theme';
import { useCoopTheme } from '../../theme-provider';
import { displayPrice } from '../../billing/plans';
import { useBilling } from '../../billing/useBilling';
import PageHeader from '../../components/layout/PageHeader';
import {
  CoopButton,
  CoopCard,
  CoopBadge,
  SparkleIcon,
} from '../../components/ui';
import PricingView from './PricingView';

/**
 * Billing & Subscription (Stitch finch_billing_subscription_qa_polished +
 * pricing/comparison views) — Stage 2.3.
 *
 * Honest by construction:
 *  - No billing backend exists, so the screen runs in PREVIEW mode: plan
 *    preference is local, no charges, and the UI says so in one banner.
 *  - Usage shown is REAL: Ask Co-op queries/conversations this month.
 *  - Payment method / billing cycle / invoice history show truthful
 *    not-connected states rather than invented cards.
 *  - The seam is the BillingProvider (src/billing/useBilling.ts) — a real
 *    billing model + credit economics plug in there, not in components.
 */

const BillingPage: React.FC = () => {
  const { colors } = useCoopTheme();
  const [view, setView] = useState<'subscription' | 'pricing'>('subscription');
  const { plan, currentPlan, usage, preview, action, cancelToFree, dismissResult, retry } =
    useBilling();
  const [cancelOpen, setCancelOpen] = useState(false);

  if (view === 'pricing') {
    return <PricingView onBack={() => setView('subscription')} />;
  }

  const price = displayPrice(plan, true);
  const processing = action.status === 'processing';
  const result =
    action.status === 'success' || action.status === 'failure'
      ? { target: action.target, ok: action.status === 'success', reason: action.status === 'failure' ? action.reason : undefined }
      : null;

  const stat = (label: string, value: React.ReactNode, sub?: string) => (
    <div key={label}>
      <div style={{ ...type.bodyCompact, fontSize: 12.5, color: colors.outline, marginBottom: 4 }}>{label}</div>
      <div style={{ ...type.sectionHeading, fontSize: 20, color: colors.onSurface, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ ...type.bodyCompact, fontSize: 11.5, color: colors.outline, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Billing & Subscription"
        subtitle="Manage your current plan, view usage, and update payment methods."
        actions={
          <CoopButton variant="secondary" onClick={() => setView('pricing')}>
            View Pricing
          </CoopButton>
        }
      />

      {/* Preview-mode honesty banner (hidden if a live provider exists) */}
      {preview && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 16px',
            borderRadius: radius.lg,
            background: colors.surfaceContainerLow,
            border: `1px solid ${colors.outlineVariant}`,
            marginBottom: 16,
            ...type.bodyCompact,
            color: colors.onSurfaceVariant,
          }}
        >
          <InfoCircleFilled style={{ color: colors.primary, marginTop: 2 }} />
          <span>
            <strong style={{ color: colors.onSurface }}>Billing preview.</strong> No billing provider is
            connected yet: plan changes are saved as local preferences and nothing is charged. The finalized
            pricing & AI-credit model plugs into this screen through the billing service layer.
          </span>
        </div>
      )}

      {/* Result (success/failure) after a plan change */}
      {result && (
        <div
          role={result.ok ? 'status' : 'alert'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderRadius: radius.lg,
            marginBottom: 16,
            background: result.ok ? 'rgba(46,158,91,0.1)' : 'rgba(186,26,26,0.08)',
            border: `1px solid ${result.ok ? 'rgba(46,158,91,0.3)' : 'rgba(186,26,26,0.25)'}`,
          }}
        >
          {result.ok ? (
            <span style={{ color: colors.success, fontSize: 18 }}><InfoCircleFilled /></span>
          ) : (
            <span style={{ color: colors.error, fontSize: 18 }}><ExclamationCircleFilled /></span>
          )}
          <div style={{ flex: 1, ...type.bodyCompact, color: colors.onSurfaceVariant }}>
            {result.ok
              ? result.target === 'free'
                ? 'Subscription cancelled — you are on the Free plan.'
                : `Plan preference updated to ${result.target}. ${preview ? 'No payment was taken.' : ''}`
              : `Plan change failed: ${result.reason ?? 'unknown reason'}`}
          </div>
          {!result.ok && (
            <CoopButton size="sm" variant="secondary" icon={<ReloadOutlined />} onClick={retry}>
              Try Again
            </CoopButton>
          )}
          <CoopButton size="sm" variant="ghost" onClick={dismissResult}>
            Dismiss
          </CoopButton>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Current plan */}
          <CoopCard
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                {plan.name} Plan
                <CoopBadge variant={currentPlan === 'free' ? 'neutral' : 'primary'}>
                  {currentPlan === 'free' ? 'Free' : 'Active'}
                </CoopBadge>
              </span>
            }
            extra={
              <div style={{ textAlign: 'right' }}>
                <div style={{ ...type.sectionHeading, fontSize: 24, color: colors.onSurface, fontVariantNumeric: 'tabular-nums' }}>
                  {price.amount}
                  {plan.priceMonthly != null && plan.priceMonthly > 0 && (
                    <span style={{ ...type.bodyCompact, fontSize: 12, color: colors.outline }}> /mo</span>
                  )}
                </div>
                <div style={{ ...type.bodyCompact, fontSize: 12, color: colors.outline }}>{price.note}</div>
              </div>
            }
          >
            <div style={{ ...type.bodyCompact, color: colors.onSurfaceVariant, marginBottom: 16 }}>
              {plan.tagline}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 16,
                padding: '14px 0',
                borderTop: `1px solid ${colors.borderSubtle}`,
              }}
            >
              {stat('AI queries', usage.aiQueries, usage.month)}
              {stat('Conversations', usage.conversations, 'this month')}
              {stat('AI credits used', usage.metered ? usage.creditsUsed : 0, 'metered this month')}
              {stat('Plan', plan.name, preview ? 'preview — not charged' : 'billed')}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <CoopButton icon={<CreditCardOutlined />} onClick={() => setView('pricing')} disabled={processing}>
                Manage Plan
              </CoopButton>
              {currentPlan !== 'free' && (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: colors.error,
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                    padding: '6px 4px',
                  }}
                >
                  Cancel subscription
                </button>
              )}
            </div>
          </CoopCard>

          {/* AI usage (real data from Ask Co-op) */}
          <CoopCard
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <SparkleIcon size={16} color={colors.secondaryContainer} />
                AI Usage
              </span>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Ask Co-op questions', value: usage.aiQueries, max: 0 },
                { label: 'Conversations started', value: usage.conversations, max: 0 },
                { label: 'AI requests served (metered)', value: usage.metered ? usage.aiRequests : null, max: 0 },
                { label: 'AI credits used (metered)', value: usage.metered ? usage.creditsUsed : null, max: 0 },
              ].map((row) =>
                row.value === null ? null : (
                <div key={row.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', ...type.bodyCompact, color: colors.onSurfaceVariant, marginBottom: 6 }}>
                    <span>{row.label}</span>
                    <span style={{ fontWeight: 700, color: colors.onSurface, fontVariantNumeric: 'tabular-nums' }}>{row.value}</span>
                  </div>
                  <div
                    aria-hidden
                    style={{
                      height: 6,
                      borderRadius: radius.full,
                      background: colors.surfaceContainer,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, row.value * 4)}%`,
                        background: `linear-gradient(90deg, ${colors.primaryContainer}, ${colors.secondaryContainer})`,
                        transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    />
                  </div>
                </div>
              ))}
              <div style={{ ...type.bodyCompact, fontSize: 12, color: colors.outline }}>
                Questions & conversations come from this device's conversation history ({usage.month}).
                AI requests and credits are metered by the Co-op backend — this ledger is what plan
                limits will enforce against.
              </div>
            </div>
          </CoopCard>

          {/* Invoice history — honest not-connected state */}
          <CoopCard
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <FileTextOutlined style={{ color: colors.outline }} />
                Invoice History
              </span>
            }
          >
            <div style={{ textAlign: 'center', padding: '18px 8px', ...type.bodyCompact, color: colors.onSurfaceVariant }}>
              <FileTextOutlined style={{ fontSize: 26, color: colors.outline, marginBottom: 10, display: 'inline-block' }} />
              <div style={{ marginBottom: 4 }}>No invoices yet</div>
              <div style={{ fontSize: 12.5 }}>
                Billing invoices will appear here once the billing provider connects. AI-generated
                order invoices are available from each order's detail page.
              </div>
            </div>
          </CoopCard>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Payment method — honest state */}
          <CoopCard
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <CreditCardOutlined style={{ color: colors.outline }} />
                Payment Method
              </span>
            }
          >
            <div
              style={{
                borderRadius: radius.lg,
                border: `1px dashed ${colors.outlineVariant}`,
                padding: '16px',
                ...type.bodyCompact,
                color: colors.onSurfaceVariant,
              }}
            >
              No payment method on file.
              <div style={{ fontSize: 12.5, color: colors.outline, marginTop: 4 }}>
                Payment connects together with the finalized billing model — nothing is charged in
                preview mode.
              </div>
            </div>
          </CoopCard>

          {/* Billing cycle — honest state */}
          <CoopCard
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <ReloadOutlined style={{ color: colors.outline }} />
                Billing Cycle
              </span>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...type.bodyCompact }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: colors.outline }}>Next invoice</span>
                <span style={{ color: colors.onSurface, fontWeight: 600 }}>—</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: colors.outline }}>Amount due</span>
                <span style={{ color: colors.onSurface, fontWeight: 600 }}>
                  {preview ? '$0.00 (preview)' : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: colors.outline }}>Cycle</span>
                <span style={{ color: colors.onSurface, fontWeight: 600 }}>
                  {currentPlan === 'free' ? 'Free plan' : 'Monthly (preview)'}
                </span>
              </div>
            </div>
          </CoopCard>

          {/* Support */}
          <CoopCard
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <CustomerServiceOutlined style={{ color: colors.outline }} />
                Support
              </span>
            }
          >
            <div style={{ ...type.bodyCompact, color: colors.onSurfaceVariant }}>
              Need dedicated support or a custom plan?
              <div style={{ marginTop: 12 }}>
                <CoopButton
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    message.info('Sales contact connects when billing goes live.')
                  }
                >
                  Contact Sales
                </CoopButton>
              </div>
            </div>
          </CoopCard>
        </div>
      </div>

      {/* Cancel confirmation (draft → review → execute, via the provider) */}
      {cancelOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(27,27,35,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setCancelOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 440,
              background: colors.surfaceContainerLowest,
              borderRadius: radius.xl,
              border: `1px solid ${colors.borderSubtle}`,
              borderTop: `3px solid ${colors.error}`,
              padding: 28,
            }}
          >
            <div
              aria-hidden
              style={{
                width: 46,
                height: 46,
                borderRadius: '50%',
                background: 'rgba(186,26,26,0.1)',
                color: colors.error,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                marginBottom: 14,
              }}
            >
              <ExclamationCircleFilled />
            </div>
            <div style={{ ...type.sectionHeading, color: colors.onSurface, marginBottom: 8 }}>
              Cancel {plan.name} plan?
            </div>
            <p style={{ margin: 0, ...type.bodyCompact, color: colors.onSurfaceVariant }}>
              You'll move to the Free plan. Your business data, orders and AI history stay exactly as
              they are — only the plan preference changes{preview ? ' (and no payment was ever taken in preview mode)' : ''}.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <CoopButton variant="secondary" onClick={() => setCancelOpen(false)}>
                Keep Plan
              </CoopButton>
              <CoopButton
                variant="danger"
                loading={processing}
                onClick={async () => {
                  setCancelOpen(false);
                  await cancelToFree();
                }}
              >
                Cancel Subscription
              </CoopButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingPage;
