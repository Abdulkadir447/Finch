import React, { useMemo } from 'react';
import { Alert, Button, Col, Row, theme as antdTheme } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { ApexOptions } from 'apexcharts';
import DashboardHeader from './DashboardHeader';
import { KPI_DEFINITIONS, formatCurrency } from './kpiConfig';
import { useDashboardData } from './useDashboardData';
import KpiCard, { KpiTrend } from '../../components/dashboard/KpiCard';
import ChartCard from '../../components/dashboard/ChartCard';
import RecentOrdersTable, { OrderRow, OrderStatus } from '../../components/dashboard/RecentOrdersTable';
import { brand, semantic } from '../../theme';

/**
 * Finch Dashboard — LIVE DATA WIRING (UXDS Chapter 9).
 *
 * Sections:
 *   1. DashboardHeader        — title / greeting / date (UXDS 9.5)
 *   2. KPI grid               — six stat cards fed by /dashboard/summary
 *   3. Charts row             — Revenue area (/dashboard/revenue/timeseries)
 *                               + Inventory donut (/dashboard/inventory/by-category)
 *   4. Recent Orders table    — /orders (latest 8)
 *
 * Honesty rule: no fabricated numbers. Real zeros are shown as zeros;
 * empty series keep the native ApexCharts noData state; the Forecast KPI
 * stays empty until the AI module exists. Errors surface as a banner with
 * Retry (UXDS 9.23) without replacing the widgets.
 */

const DAYS_IN_CHART = 30;
const DAYS_IN_SPARK = 14;

const DashboardPage: React.FC = () => {
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const { loading, error, summary, timeseries, categories, orders, retry } =
    useDashboardData();

  // ------------------------------------------------------------------
  // Series construction. Days without sales are filled with REAL zeros;
  // when the backend reports no points at all the series stays empty so
  // the chart shows its honest "No data available yet" state.
  // ------------------------------------------------------------------
  const revenueSeries = useMemo(() => {
    if (timeseries.length === 0) return { categories: [] as string[], data: [] as number[] };
    const byDate = new Map(timeseries.map((p) => [p.date, p.revenue]));
    const days = Array.from({ length: DAYS_IN_CHART }, (_, i) =>
      dayjs().subtract(DAYS_IN_CHART - 1 - i, 'day').format('YYYY-MM-DD'),
    );
    return {
      categories: days.map((d) => dayjs(d).format('MMM D')),
      data: days.map((d) => byDate.get(d) ?? 0),
    };
  }, [timeseries]);

  const revenueSpark = useMemo(() => {
    if (timeseries.length === 0) return [] as number[];
    const byDate = new Map(timeseries.map((p) => [p.date, p.revenue]));
    return Array.from({ length: DAYS_IN_SPARK }, (_, i) => {
      const d = dayjs().subtract(DAYS_IN_SPARK - 1 - i, 'day').format('YYYY-MM-DD');
      return byDate.get(d) ?? 0;
    });
  }, [timeseries]);

  // ------------------------------------------------------------------
  // KPI values from the summary payload.
  // ------------------------------------------------------------------
  const kpiLive = useMemo(() => {
    if (!summary) return null;
    const growthTrend: KpiTrend | null =
      summary.revenue_growth_percent !== null
        ? { percent: summary.revenue_growth_percent, comparisonLabel: 'Compared to last month' }
        : null;
    return {
      profit: { value: formatCurrency(summary.profit_month), caption: 'This month' },
      revenue: {
        value: formatCurrency(summary.revenue_month),
        trend: growthTrend,
        caption: 'This month',
        sparkData: revenueSpark,
      },
      orders: { value: String(summary.orders_month), caption: `${summary.orders_today} today` },
      inventory: {
        value: formatCurrency(summary.inventory_value),
        caption: `${summary.low_stock_count} low stock · ${summary.products_count} products`,
      },
      'customer-growth': {
        value: String(summary.customers_total),
        caption: `${summary.customers_new_month} new this month`,
      },
    } as Record<string, { value: string; trend?: KpiTrend | null; caption?: string; sparkData?: number[] }>;
  }, [summary, revenueSpark]);

  // ------------------------------------------------------------------
  // Chart options (theme-aware via tokens; series injected below).
  // ------------------------------------------------------------------
  const revenueOptions: ApexOptions = useMemo(
    () => ({
      chart: { type: 'area' },
      colors: [brand.primary],
      stroke: { curve: 'monotoneCubic', width: 2.5 },
      fill: { type: 'gradient', gradient: { opacityFrom: 0.28, opacityTo: 0.02 } },
      xaxis: { categories: revenueSeries.categories },
      yaxis: { labels: { formatter: (v: number) => formatCurrency(v) } },
      tooltip: { y: { formatter: (v: number) => formatCurrency(v) } },
    }),
    [revenueSeries.categories],
  );

  const inventoryOptions: ApexOptions = useMemo(
    () => ({
      chart: { type: 'donut' },
      colors: [brand.primary, semantic.info, semantic.success, semantic.warning, brand.primaryHover],
      labels: categories.map((c) => c.category),
      legend: { position: 'bottom', labels: { colors: token.colorTextSecondary } },
      stroke: { colors: [token.colorBgContainer], width: 2 },
      tooltip: { y: { formatter: (v: number) => formatCurrency(v) } },
    }),
    [categories, token],
  );

  const orderRows: OrderRow[] = useMemo(
    () =>
      orders.map((o) => ({
        id: o.id,
        orderNumber: `#ORD-${String(o.id).padStart(4, '0')}`,
        customer: o.customer?.full_name ?? '—',
        date: dayjs(o.order_date).format('MMM D, YYYY'),
        status: (o.status as OrderStatus) ?? 'pending',
        total: o.total_amount,
      })),
    [orders],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <DashboardHeader />

      {/* Error banner (UXDS 9.23): widgets underneath stay visible. */}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error.isAuthError ? 'Authentication required' : 'Unable to load dashboard data'}
          description={error.message}
          action={
            <Button size="small" danger onClick={retry}>
              Retry
            </Button>
          }
        />
      )}

      {/* KPI cards: 2 cols (small) → 3 cols (medium) → 6 cols (standard) */}
      <section aria-label="Key performance indicators">
        <Row gutter={[16, 16]}>
          {KPI_DEFINITIONS.map((kpi) => {
            const isForecast = kpi.key === 'forecast';
            const live = !isForecast && kpiLive ? kpiLive[kpi.key] : undefined;
            return (
              <Col xs={12} md={8} xl={4} key={kpi.key}>
                <KpiCard
                  title={kpi.title}
                  icon={kpi.icon}
                  accent={kpi.accent}
                  value={live?.value ?? '—'}
                  trend={live?.trend ?? null}
                  caption={live?.caption}
                  sparkData={live?.sparkData ?? []}
                  isEmpty={!live}
                  loading={!isForecast && loading}
                  onClick={kpi.route ? () => navigate(kpi.route as string) : undefined}
                />
              </Col>
            );
          })}
        </Row>
      </section>

      {/* Charts row: primary Revenue, secondary Inventory (UXDS 9.10 / 9.26) */}
      <section aria-label="Analytics charts">
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <ChartCard
              title="Revenue"
              subtitle={revenueSeries.data.length ? `Last ${DAYS_IN_CHART} days` : 'Awaiting data'}
              type="area"
              options={revenueOptions}
              series={
                revenueSeries.data.length
                  ? [{ name: 'Revenue', data: revenueSeries.data }]
                  : [{ name: 'Revenue', data: [] }]
              }
            />
          </Col>
          <Col xs={24} xl={8}>
            <ChartCard
              title="Inventory Value"
              subtitle={categories.length ? 'By category, at cost' : 'Awaiting data'}
              type="donut"
              options={inventoryOptions}
              series={categories.map((c) => c.value)}
            />
          </Col>
        </Row>
      </section>

      {/* Recent activity / orders (UXDS 9.15) */}
      <section aria-label="Recent orders">
        <RecentOrdersTable orders={orderRows} />
      </section>
    </div>
  );
};

export default DashboardPage;
