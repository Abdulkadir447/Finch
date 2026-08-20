import React from 'react';
import {
  DollarOutlined,
  InboxOutlined,
  LineChartOutlined,
  RocketOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { brand, semantic } from '../../theme';
import { getCurrency } from '../../services/currency';

/**
 * KPI definitions for the Dashboard first row (UXDS 9.7):
 * Profit • Revenue • Orders • Inventory • Customer Growth • Forecast.
 *
 * These are static card definitions (title, icon, accent, route). Live values
 * are injected from /dashboard/summary at render time; the `value`/`sparkData`
 * fields below are the honest empty-state defaults shown while data loads or
 * when a backend value does not exist yet (UXDS 9.22).
 */
export interface KpiDefinition {
  key: string;
  title: string;
  icon: React.ReactNode;
  accent: string;
  /** UXDS 9.9 — KPI click navigates to the associated module (when it exists). */
  route?: string;
  /** Empty-state default; replaced by live data when available. */
  value: string;
  trend: null;
  sparkData: number[];
}

export const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    key: 'profit',
    title: 'Profit',
    icon: <DollarOutlined />,
    accent: semantic.success,
    value: '—',
    trend: null,
    sparkData: [],
  },
  {
    key: 'revenue',
    title: 'Revenue',
    icon: <LineChartOutlined />,
    accent: brand.primary,
    value: '—',
    trend: null,
    sparkData: [],
  },
  {
    key: 'orders',
    title: 'Orders',
    icon: <ShoppingCartOutlined />,
    accent: semantic.info,
    route: '/orders',
    value: '—',
    trend: null,
    sparkData: [],
  },
  {
    key: 'inventory',
    title: 'Inventory',
    icon: <InboxOutlined />,
    accent: semantic.warning,
    route: '/products',
    value: '—',
    trend: null,
    sparkData: [],
  },
  {
    key: 'customer-growth',
    title: 'Customer Growth',
    icon: <TeamOutlined />,
    accent: brand.primaryActive,
    route: '/customers',
    value: '—',
    trend: null,
    sparkData: [],
  },
  {
    key: 'forecast',
    title: 'Forecast',
    icon: <RocketOutlined />,
    accent: brand.primaryHover,
    value: '—',
    trend: null,
    sparkData: [],
  },
];

/**
 * Shared currency formatter. Defaults to the business currency from the
 * Settings store (Task 9) so money formatting follows the company setting;
 * pass an explicit code to override.
 */
export const formatCurrency = (value: number, currency?: string): string =>
  value.toLocaleString(undefined, { style: 'currency', currency: currency ?? getCurrency() });
