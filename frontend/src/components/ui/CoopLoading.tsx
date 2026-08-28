/**
 * CoopLoading — the shared "working" state.
 *
 * Centered branded spinner with an optional label, used for full-panel
 * loads (Settings, reports). In-row and table loading keeps antd's native
 * table spinner (it must not break row layout).
 */
import React from 'react';
import { Spin } from 'antd';
import { spacing, type } from '../../theme';
import { useCoopTheme } from '../../theme-provider';

export interface CoopLoadingProps {
  label?: string;
  /** Height of the centered area. Defaults to a comfortable 200px. */
  height?: number;
}

const CoopLoading: React.FC<CoopLoadingProps> = ({ label, height = 200 }) => {
  const { colors } = useCoopTheme();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        minHeight: height,
      }}
      role="status"
      aria-live="polite"
    >
      <Spin size="large" />
      {label && <div style={{ ...type.bodyCompact, color: colors.onSurfaceVariant }}>{label}</div>}
    </div>
  );
};

export default CoopLoading;
