/**
 * CoopErrorState — the shared error banner (UXDS 9.23 pattern, restyled).
 *
 * Errors surface as a banner with a Retry action; the widgets underneath
 * stay visible so a failed fetch never blanks the screen.
 */
import React from 'react';
import { CloseCircleFilled } from '@ant-design/icons';
import { radius, spacing, type } from '../../theme';
import { tint } from '../../theme/colors';
import { useCoopTheme } from '../../theme-provider';
import CoopButton from './CoopButton';

export interface CoopErrorStateProps {
  /** Short title, e.g. "Unable to load products". */
  title: string;
  /** Detail from the API response. */
  detail?: string;
  /** Provide to render the Retry action. */
  onRetry?: () => void;
  retryLabel?: string;
}

const CoopErrorState: React.FC<CoopErrorStateProps> = ({
  title,
  detail,
  onRetry,
  retryLabel = 'Retry',
}) => {
  const { colors, isDark } = useCoopTheme();
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: spacing.sm,
        padding: `${spacing.sm + 4}px ${spacing.md}px`,
        borderRadius: radius.lg,
        background: tint(colors.error, isDark ? 0.16 : 0.07),
        border: `1px solid ${tint(colors.error, isDark ? 0.4 : 0.25)}`,
      }}
    >
      <CloseCircleFilled style={{ color: colors.error, fontSize: 18, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...type.bodyDefault, fontWeight: 600, color: colors.onSurface, fontSize: 14 }}>
          {title}
        </div>
        {detail && (
          <div style={{ ...type.bodyCompact, color: colors.onSurfaceVariant, marginTop: 2, wordBreak: 'break-word' }}>
            {detail}
          </div>
        )}
      </div>
      {onRetry && (
        <CoopButton size="sm" variant="danger" onClick={onRetry}>
          {retryLabel}
        </CoopButton>
      )}
    </div>
  );
};

export default CoopErrorState;
