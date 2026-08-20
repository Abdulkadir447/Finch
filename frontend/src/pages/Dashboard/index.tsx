import React from 'react';
import { Col, Row, theme as antdTheme } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { ApexOptions } from 'apexcharts';
import DashboardHeader from './DashboardHeader';
import { KPI_DEFINITIONS } from './kpiConfig';
import KpiCard from '../../components/dashboard/KpiCard';
import ChartCard from '../../components/dashboard/ChartCard';
import RecentOrdersTable from '../../components/dashboard/RecentOrdersTable';
import { brand, semantic } from '../../theme';

/**
 * Finch Dashboard — FOUNDATION (UXDS Chapter 9).
 *
 * Sections implemented in this phase:
 *   1. DashboardHeader        — title / greeting / date (UXDS 9.5)
 *   2. KPI grid               — six stat cards, ApexCharts sparklines,
 *                               empty states (UXDS 9.7–9.9)
 *   3. Charts row             — Revenue + Inventory Value scaffolding with
 *                               native ApexCharts noData states (UXDS 9.10)
 *   4. Recent Orders table    — empty-state table (UXDS 9.15)
 *
 * Responsive grid follows UXDS 9.26: KPIs are 2 columns on small desktops
 * and 6 on standard; charts stack on small screens. Outer margin (24px) is
 * provided by the app shell's Content padding; gutters are 16px and section
 * spacing is 24px per UXDS 9.4.
 *
 * AI summary/recommendations, tasks, calendar, quick actions, floating AI,
 * and the status bar (UXDS 9.13–9.19) are deliberately NOT built yet.
 */
const DashboardPage: React.FC = () => {
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();

  // Revenue trend (UXDS 9.11) — empty until backend analytics are connected.
  const revenueOptions: ApexOptions = {
    chart: { type: 'area' },
    colors: [brand.primary],
    stroke: { curve: 'monotoneCubic', width: 2.5 },
    fill: {
      type: 'gradient',
      gradient: { opacityFrom: 0.28, opacityTo: 0.02 },
    },
    xaxis: { categories: [] },
  };

  // Inventory value by category (UXDS 9.12) — empty for now.
  const inventoryOptions: ApexOptions = {
    chart: { type: 'donut' },
    colors: [brand.primary, semantic.info, semantic.success, semantic.warning],
    labels: [],
    legend: {
      position: 'bottom',
      labels: { colors: token.colorTextSecondary },
    },
    stroke: { colors: [token.colorBgContainer], width: 2 },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <DashboardHeader />

      {/* KPI cards: 2 cols (small) → 3 cols (medium) → 6 cols (standard) */}
      <section aria-label="Key performance indicators">
        <Row gutter={[16, 16]}>
          {KPI_DEFINITIONS.map((kpi) => (
            <Col xs={12} md={8} xl={4} key={kpi.key}>
              <KpiCard
                title={kpi.title}
                icon={kpi.icon}
                value={kpi.value}
                accent={kpi.accent}
                trend={kpi.trend}
                sparkData={kpi.sparkData}
                isEmpty
                onClick={kpi.route ? () => navigate(kpi.route as string) : undefined}
              />
            </Col>
          ))}
        </Row>
      </section>

      {/* Charts row: primary Revenue, secondary Inventory (UXDS 9.10 / 9.26) */}
      <section aria-label="Analytics charts">
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <ChartCard
              title="Revenue"
              subtitle="Awaiting data"
              type="area"
              options={revenueOptions}
              series={[{ name: 'Revenue', data: [] }]}
            />
          </Col>
          <Col xs={24} xl={8}>
            <ChartCard
              title="Inventory Value"
              subtitle="Awaiting data"
              type="donut"
              options={inventoryOptions}
              series={[]}
            />
          </Col>
        </Row>
      </section>

      {/* Recent activity / orders (UXDS 9.15) */}
      <section aria-label="Recent orders">
        <RecentOrdersTable orders={[]} />
      </section>
    </div>
  );
};

export default DashboardPage;
