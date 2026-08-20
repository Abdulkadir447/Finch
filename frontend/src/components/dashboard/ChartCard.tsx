import React from 'react';
import Chart from './chart';
import { Card, Space, Typography, theme as antdTheme } from 'antd';
import type {
  ApexAxisChartSeries,
  ApexNonAxisChartSeries,
  ApexOptions,
} from 'apexcharts';

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Optional header-extra node (e.g. range switch — left as a slot for later phases). */
  extra?: React.ReactNode;
  type: 'line' | 'area' | 'bar' | 'donut' | 'pie';
  options: ApexOptions;
  series: ApexAxisChartSeries | ApexNonAxisChartSeries;
  height?: number;
}

/** True when a hex color reads as "dark" (WCAG-style luminance heuristic). */
function isDarkColor(hex?: string): boolean {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

function isSeriesEmpty(series: ChartCardProps['series']): boolean {
  if (!series || series.length === 0) return true;
  return series.every((s) => {
    const data = (s as { data?: unknown[] }).data;
    return !data || data.length === 0;
  });
}

/**
 * Theme-aware ApexCharts card for the Dashboard (UXDS 9.10 Charts Section).
 *
 * - Picks chart text/grid/tooltip colors from the ACTIVE antd theme tokens,
 *   so light/dark switching (Finch theme.ts) works with zero extra wiring.
 * - Empty state is handled natively by ApexCharts' `chart.noData` option —
 *   no custom chart implementation, per project convention.
 */
const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  extra,
  type,
  options,
  series,
  height = 320,
}) => {
  const { token } = antdTheme.useToken();
  const dark = isDarkColor(token.colorBgBase);
  const empty = isSeriesEmpty(series);

  const baseOptions: ApexOptions = {
    chart: {
      fontFamily: token.fontFamily,
      foreColor: token.colorTextSecondary,
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: true, speed: 220 }, // UXDS 9.25
    },
    // ApexCharts v6: `noData` is a top-level option — native empty state.
    noData: {
      text: 'No data available yet',
      align: 'center',
      verticalAlign: 'middle',
      // Secondary (not tertiary) text: keeps AA contrast on dark surfaces.
      style: { color: token.colorTextSecondary, fontSize: `${token.fontSize}px` },
    },
    grid: { borderColor: token.colorBorderSecondary, strokeDashArray: 4 },
    dataLabels: { enabled: false },
    tooltip: { theme: dark ? 'dark' : 'light' },
    xaxis: {
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: token.colorTextTertiary } },
    },
    yaxis: { labels: { style: { colors: token.colorTextTertiary } } },
  };

  // Shallow-merge per chart group so caller options win where provided.
  const merged: ApexOptions = { ...baseOptions, ...options };
  merged.chart = { ...baseOptions.chart, ...options.chart };
  merged.grid = { ...baseOptions.grid, ...options.grid };
  merged.tooltip = { ...baseOptions.tooltip, ...options.tooltip };
  if (options.xaxis) merged.xaxis = { ...baseOptions.xaxis, ...options.xaxis };
  if (options.yaxis) merged.yaxis = { ...baseOptions.yaxis, ...options.yaxis };

  return (
    <Card
      title={
        <Space size={8}>
          <Typography.Text
            strong
            style={{ color: token.colorText, fontSize: token.fontSizeHeading4 }}
          >
            {title}
          </Typography.Text>
          {subtitle && (
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, fontWeight: 400 }}>
              {subtitle}
            </Typography.Text>
          )}
        </Space>
      }
      extra={extra}
      styles={{ body: { padding: 16 } }}
    >
      <Chart options={merged} series={series} type={type} height={height} />
    </Card>
  );
};

export default ChartCard;
