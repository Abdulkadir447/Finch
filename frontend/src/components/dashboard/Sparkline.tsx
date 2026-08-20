import React from 'react';
import Chart from './chart';
import { theme as antdTheme } from 'antd';
import type { ApexOptions } from 'apexcharts';
import { brand } from '../../theme';

export interface SparklineProps {
  /** Trend points for the KPI mini chart (UXDS 9.8 "Mini Chart"). */
  data: number[];
  /** Line/fill accent. Defaults to the Finch brand primary. */
  color?: string;
  /** Render height in px. */
  height?: number;
}

/**
 * KPI mini trend graph rendered with ApexCharts sparkline mode.
 *
 * Empty state: when there is no data yet (backend not connected), a quiet
 * placeholder band keeps the card layout stable (UXDS 9.21 — skeletons
 * preserve layout) instead of rendering a misleading chart.
 */
const Sparkline: React.FC<SparklineProps> = ({
  data,
  color = brand.primary,
  height = 42,
}) => {
  const { token } = antdTheme.useToken();

  if (!data || data.length === 0) {
    return (
      <div
        aria-hidden
        style={{
          height,
          borderRadius: token.borderRadiusSM,
          background: token.colorBgLayout,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      />
    );
  }

  const options: ApexOptions = {
    chart: {
      type: 'area',
      sparkline: { enabled: true },
      fontFamily: token.fontFamily,
      animations: { enabled: true, speed: 220 }, // UXDS 9.25: 180–220 ms
    },
    stroke: { curve: 'monotoneCubic', width: 2 },
    fill: {
      type: 'gradient',
      gradient: { opacityFrom: 0.25, opacityTo: 0.02 },
    },
    colors: [color],
    tooltip: { enabled: false },
    xaxis: { labels: { show: false }, axisBorder: { show: false } },
    yaxis: { labels: { show: false } },
  };

  return (
    <Chart
      options={options}
      series={[{ name: 'trend', data }]}
      type="area"
      height={height}
    />
  );
};

export default Sparkline;
