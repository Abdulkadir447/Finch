/**
 * Co-op Notifications (Stage 2) — the bell popover.
 *
 * Grounded in real business data: inventory alerts derived from
 * /products?stock=low|out (no invented notifications). Low-stock and
 * out-of-stock products surface as actionable rows that jump to the
 * Inventory module with the matching filter pre-applied.
 *
 * Badge semantics: a red dot while unread alerts exist; cleared the first
 * time the panel is opened (session-only — no server notification state yet).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Popover, Skeleton } from 'antd';
import { CheckCircleFilled, ExclamationCircleFilled, InboxOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { radius, spacing, type } from '../../theme';
import { tint } from '../../theme/colors';
import { useCoopTheme } from '../../theme-provider';
import { useApiClient } from '../../services/api/client';

interface AlertItem {
  id: number;
  name: string;
  sku: string;
  current_stock: number;
  reorder_level: number;
}

interface AlertsData {
  low: AlertItem[];
  out: AlertItem[];
}

type PanelState = AlertsData | 'loading' | 'error';

const NotificationsPanel: React.FC<{ data: PanelState }> = ({ data }) => {
  const { colors } = useCoopTheme();
  const navigate = useNavigate();

  const go = (stock: 'low' | 'out') => {
    navigate(`/inventory?stock=${stock}`);
  };

  if (data === 'loading') {
    return (
      <div style={{ padding: spacing.md, width: 320 }}>
        <Skeleton active paragraph={{ rows: 3 }} />
      </div>
    );
  }

  if (data === 'error') {
    return (
      <div style={{ padding: spacing.lg, width: 320, textAlign: 'center' }}>
        <InboxOutlined style={{ fontSize: 24, color: colors.outline }} />
        <div style={{ ...type.bodyCompact, color: colors.onSurfaceVariant, marginTop: 8 }}>
          Unable to load notifications right now.
        </div>
      </div>
    );
  }

  const rows: Array<{ key: string; item: AlertItem; kind: 'low' | 'out' }> = [
    ...data.out.map((item) => ({ key: `out-${item.id}`, item, kind: 'out' as const })),
    ...data.low.map((item) => ({ key: `low-${item.id}`, item, kind: 'low' as const })),
  ];

  return (
    <div style={{ width: 340 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${spacing.sm + 2}px ${spacing.md}px ${spacing.sm}px`,
        }}
      >
        <span style={{ ...type.titleMd, color: colors.onSurface }}>Notifications</span>
        <span style={{ ...type.labelCaps, color: colors.outline }}>{rows.length} alerts</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: `${spacing.lg}px ${spacing.md}px`, textAlign: 'center' }}>
          <CheckCircleFilled style={{ fontSize: 26, color: colors.success }} />
          <div style={{ ...type.titleMd, color: colors.onSurface, marginTop: 8 }}>You're all caught up</div>
          <div style={{ ...type.bodyCompact, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 4 }}>
            No low-stock or out-of-stock items right now.
          </div>
        </div>
      ) : (
        <>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {rows.slice(0, 8).map(({ key, item, kind }) => (
              <button
                key={key}
                type="button"
                onClick={() => go(kind)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  width: '100%',
                  padding: `10px ${spacing.md}px`,
                  border: 'none',
                  borderBottom: `1px solid ${colors.borderSubtle}`,
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 120ms',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceContainerLow)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span
                  aria-hidden
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: radius.md,
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    background: kind === 'out' ? tint(colors.error, 0.1) : tint(colors.warning, 0.14),
                    color: kind === 'out' ? colors.error : colors.warning,
                  }}
                >
                  {kind === 'out' ? <ExclamationCircleFilled /> : <InboxOutlined />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontWeight: 600,
                      fontSize: 13,
                      color: colors.onSurface,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {kind === 'out' ? 'Out of stock' : 'Low stock'} — {item.name}
                  </span>
                  <span style={{ ...type.bodyCompact, fontSize: 12, color: colors.onSurfaceVariant, display: 'block' }}>
                    {item.sku} · {item.current_stock} left · reorder at {item.reorder_level}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div style={{ padding: `8px ${spacing.md}px 10px` }}>
            <button
              type="button"
              onClick={() => go('low')}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                color: colors.primary,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                padding: 6,
                borderRadius: radius.md,
              }}
            >
              View in Inventory →
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const NotificationsPopover: React.FC = () => {
  const { colors } = useCoopTheme();
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PanelState>('loading');
  const [seen, setSeen] = useState(false);
  const [hover, setHover] = useState(false);

  const load = useCallback(async () => {
    try {
      const [low, out] = await Promise.all([
        api.get('/products', { params: { stock: 'low', limit: 4 } }).then((r) => r.data.items as AlertItem[]),
        api.get('/products', { params: { stock: 'out', limit: 4 } }).then((r) => r.data.items as AlertItem[]),
      ]);
      setData({ low, out });
    } catch {
      setData('error');
    }
  }, [api]);

  // Initial load (badge count) + refresh each time the panel opens.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (open && (data === 'loading' || data === 'error')) void load();
  }, [open, data, load]);

  const hasAlerts = data !== 'loading' && data !== 'error' && (data.low.length > 0 || data.out.length > 0);
  const showDot = hasAlerts && !seen;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSeen(true);
      }}
      trigger={['click']}
      placement="bottomRight"
      arrow={false}
      overlayInnerStyle={{ padding: 0, borderRadius: radius.lg }}
      content={<NotificationsPanel data={data} />}
    >
      <button
        type="button"
        aria-label={showDot ? 'Notifications (unread alerts)' : 'Notifications'}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative',
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          background: hover ? colors.surfaceContainerLow : 'transparent',
          color: colors.onSurfaceVariant,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 150ms',
        }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3a6 6 0 0 0-6 6v3.2l-1.2 2.4A1 1 0 0 0 5.7 16h12.6a1 1 0 0 0 .9-1.4L18 12.2V9a6 6 0 0 0-6-6Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {showDot && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 8,
              right: 9,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: colors.error,
              border: `1.5px solid ${colors.surfaceContainerLowest}`,
            }}
          />
        )}
      </button>
    </Popover>
  );
};

export default NotificationsPopover;
