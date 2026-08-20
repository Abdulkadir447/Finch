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

/**
 * KPI definitions for the Dashboard first row (UXDS 9.7):
 * Profit • Revenue • Orders • Inventory • Customer Growth • Forecast.
 *
 * The backend is not wired yet, so every card ships in its empty state
 * (value '—', no trend, no sparkline points — UXDS 9.22 / task spec item 3).
 */
export interface KpiDefinition {
  key: string;
  title: string;
  icon: React.ReactNode;
  accent: string;
  /** UXDS 9.9 — KPI click navigates to the associated module (when it exists). */
  route?: string;
  /** Placeholder until backend data arrives. */
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

/** Shared currency formatter (Business model default currency is USD). */
export const formatCurrency = (value: number, currency = 'USD'): string =>
  value.toLocaleString(undefined, { style: 'currency', currency });
