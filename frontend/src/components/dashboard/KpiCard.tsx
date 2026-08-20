import React, { useState } from 'react';
import { Card, Space, Typography, theme as antdTheme } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import Sparkline from './Sparkline';

export interface KpiTrend {
  /** Signed percentage vs. the comparison period (e.g. +18.4). */
  percent: number;
  /** Label such as "Compared to last month" (UXDS 9.8). */
  comparisonLabel: string;
}

export interface KpiCardProps {
  title: string;
  /** Tinted icon element (UXDS 9.8 "Icon"). */
  icon: React.ReactNode;
  /** Formatted value; pass '—' when no data exists yet. */
  value: string;
  /** Accent color for the icon tint and sparkline. */
  accent: string;
  trend?: KpiTrend | null;
  /** Sparkline points; empty array renders the empty-state band. */
  sparkData?: number[];
  /** True when backend data does not exist yet. */
  isEmpty?: boolean;
  /** UXDS 9.9 — clicking a KPI card navigates to its module. */
  onClick?: () => void;
}

/**
 * Finch KPI stat card (UXDS 9.8 anatomy: Icon • Title • Value • Trend % •
 * Mini Chart • Comparison Label).
 *
 * Interaction (UXDS 9.9 / 9.25): interactive cards lift with a shadow and an
 * accent border on hover, and expose a visible focus ring + Enter/Space
 * activation for keyboard users (UXDS 9.27/9.28). States are driven from
 * Finch theme tokens so light and dark modes keep proper contrast.
 */
const KpiCard: React.FC<KpiCardProps> = ({
  title,
  icon,
  value,
  accent,
  trend,
  sparkData = [],
  isEmpty = false,
  onClick,
}) => {
  const { token } = antdTheme.useToken();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const interactive = Boolean(onClick);
  const trendUp = (trend?.percent ?? 0) >= 0;
  // Theme-aware semantic colors: antd adjusts these per light/dark algorithm,
  // keeping contrast correct in both modes.
  const trendColor = trendUp ? token.colorSuccess : token.colorError;

  const borderColor = focused
    ? token.colorPrimary
    : hovered && interactive
      ? `${accent}66` // 40 % accent border highlight (UXDS 9.9)
      : token.colorBorderSecondary;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!interactive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.();
    }
  };

  return (
    <Card
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={`${title}: ${isEmpty ? 'no data yet' : value}`}
      styles={{ body: { padding: 20 } }}
      style={{
        height: '100%',
        cursor: interactive ? 'pointer' : 'default',
        borderColor,
        boxShadow: hovered && interactive ? token.boxShadowSecondary : undefined,
        outline: 'none',
        transition: `border-color ${token.motionDurationMid}, box-shadow ${token.motionDurationMid}`,
      }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {/* Icon + title row */}
        <Space size={10} align="center">
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: token.borderRadiusSM,
              background: `${accent}1A`, // 10 % tint of the accent color
              color: accent,
              fontSize: 16,
            }}
          >
            {icon}
          </span>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSize }}>
            {title}
          </Typography.Text>
        </Space>

        {/* Value + trend row — the value is the dominant element (UXDS 9.8) */}
        <Space align="baseline" size={8} wrap>
          <Typography.Text
            style={{
              fontSize: token.fontSizeHeading2,
              fontWeight: 600,
              color: token.colorText,
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {value}
          </Typography.Text>
          {!isEmpty && trend && (
            <Space size={4} style={{ color: trendColor, fontSize: token.fontSizeSM }}>
              {trendUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              {Math.abs(trend.percent).toFixed(1)}%
            </Space>
          )}
        </Space>

        {/* Mini chart (ApexCharts sparkline) */}
        <Sparkline data={sparkData} color={accent} />

        {/* Single comparison / empty caption (UXDS 9.8) */}
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {isEmpty ? 'No data yet' : trend?.comparisonLabel}
        </Typography.Text>
      </Space>
    </Card>
  );
};

export default KpiCard;
