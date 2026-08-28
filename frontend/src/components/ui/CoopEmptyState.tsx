/**
 * CoopEmptyState — the shared no-data / no-results voice (Stage R1).
 *
 * Quiet circular icon tile on surface-container, title in title-md,
 * muted body-compact description, optional primary CTA. Used by every
 * table, panel and module so "nothing here yet" looks the same app-wide.
 */
import React from 'react';
import { InboxOutlined } from '@ant-design/icons';
import { radius, spacing, type } from '../../theme';
import { useCoopTheme } from '../../theme-provider';
import CoopButton from './CoopButton';

export interface CoopEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Renders the smaller variant (tables) vs the large one (pages). */
  compact?: boolean;
  style?: React.CSSProperties;
}

const CoopEmptyState: React.FC<CoopEmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  compact = false,
  style,
}) => {
  const { colors } = useCoopTheme();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: spacing.sm,
        padding: compact ? '32px 16px' : '64px 24px',
        ...style,
      }}
    >
      <div
        aria-hidden
        style={{
          width: compact ? 44 : 56,
          height: compact ? 44 : 56,
          borderRadius: radius.full,
          background: colors.surfaceContainer,
          color: colors.outline,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: compact ? 20 : 24,
        }}
      >
        {icon ?? <InboxOutlined />}
      </div>
      <div style={{ ...type.titleMd, color: colors.onSurface, marginTop: compact ? 4 : 8 }}>{title}</div>
      {description && (
        <div style={{ ...type.bodyCompact, color: colors.onSurfaceVariant, maxWidth: 380 }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: compact ? 8 : 12 }}>{action}</div>}
    </div>
  );
};

export default CoopEmptyState;

/** Convenience: empty state with a primary CTA (the modules' default). */
export const EmptyWithCta: React.FC<CoopEmptyStateProps & { ctaLabel: string; onCta: () => void }> = ({
  ctaLabel,
  onCta,
  ...rest
}) => (
  <CoopEmptyState
    {...rest}
    action={
      <CoopButton size="sm" onClick={onCta}>
        {ctaLabel}
      </CoopButton>
    }
  />
);
