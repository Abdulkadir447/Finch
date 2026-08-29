/**
 * OFFLINE 3.5 — local dashboard calculations.
 *
 * A verbatim port of the server's dashboard endpoints (backend/main.py):
 *   /dashboard/summary               -> summary()
 *   /dashboard/revenue/timeseries    -> timeseries()
 *   /dashboard/inventory/by-category -> byCategory()
 *   /dashboard/top-products          -> topProducts()
 *   /inventory/summary               -> inventorySummary()
 *
 * Same filters, same rounding, same statuses — the Dashboard shows identical
 * numbers online and offline. Key semantics preserved exactly:
 *   * "today" KPI counts DELIVERED orders only; "this month" counts
 *     shipped + delivered (_ACTIVE_STATUSES);
 *   * low stock is STRICTLY low (0 < stock <= reorder); out is stock == 0;
 *   * the timeseries OMITS missing days (the chart fills zeros, never data);
 *   * top products aggregate ALL order items (the server joins items without
 *     an order-status filter) and rank by units.
 */
import type { LocalBundle } from './localTypes';
import { dayOf, monthStart, previousMonthStart, todayIso } from './localTypes';

const ACTIVE_STATUSES = ['shipped', 'delivered'];

export interface LDashboardSummary {
  revenue_today: number;
  orders_today: number;
  revenue_month: number;
  orders_month: number;
  revenue_growth_percent: number | null;
  profit_month: number;
  products_count: number;
  inventory_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
  customers_total: number;
  customers_new_month: number;
}

export interface LTimeseriesPoint {
  date: string;
  revenue: number;
  orders: number;
}

export interface LCategoryValue {
  category: string;
  value: number;
}

export interface LTopProduct {
  product_id: number;
  product_name: string;
  total_quantity: number;
  total_revenue: number;
}

export interface LRecentOrder {
  id: number;
  /** The orders table column is NOT NULL server-side; local rows always carry it. */
  customer_id: number;
  customer: { full_name: string } | null;
  status: string;
  total_amount: number;
  order_date: string;
  created_at: string;
}

export interface LInventorySummary {
  products_count: number;
  inventory_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
  categories_count: number;
}

function inMonth(day: string, monthFirst: string): boolean {
  return day >= monthFirst && day < previousMonthStartAddOne(monthFirst);
}

/** The day AFTER the last day of the month starting at `monthFirst`. */
function previousMonthStartAddOne(monthFirst: string): string {
  // next month start = add one month; computed by monthStart of (first + ~30d)? No —
  // precise: first of next month = previousMonthStart applied to the NEXT month.
  const [y, m] = monthFirst.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return next + '-01';
}

export function summary(b: LocalBundle): LDashboardSummary {
  const today = todayIso();
  const firstThis = monthStart(today);
  const firstLast = previousMonthStart(firstThis);
  const firstNext = previousMonthStartAddOne(firstThis);

  let revenueToday = 0;
  let ordersToday = 0;
  let revenueMonth = 0;
  let ordersMonth = 0;
  let lastMonthRevenue = 0;
  for (const o of b.orders) {
    const day = dayOf(o.order_date);
    if (!day) continue;
    const active = ACTIVE_STATUSES.includes(o.status);
    if (o.status === 'delivered' && day >= today) {
      revenueToday += o.total_amount;
      ordersToday += 1;
    }
    if (active && inMonth(day, firstThis)) {
      revenueMonth += o.total_amount;
      ordersMonth += 1;
    }
    if (active && inMonth(day, firstLast)) lastMonthRevenue += o.total_amount;
  }

  const growth =
    lastMonthRevenue > 0 ? Math.round(((revenueMonth - lastMonthRevenue) / lastMonthRevenue) * 100 * 100) / 100 : null;

  // Profit this month: Σ (unit_price − coalesce(cost,0)) × qty over the period's lines.
  const activeOrders = new Set(
    b.orders.filter((o) => {
      const day = dayOf(o.order_date);
      return day != null && ACTIVE_STATUSES.includes(o.status) && inMonth(day, firstThis);
    }).map((o) => o.id),
  );
  const costById = new Map(b.products.map((p) => [p.id, p.cost_price]));
  let profit = 0;
  for (const it of b.items) {
    if (activeOrders.has(it.order_id)) {
      profit += (it.unit_price - (costById.get(it.product_id) ?? 0)) * it.quantity;
    }
  }

  let lowCount = 0;
  let outCount = 0;
  let inventoryValue = 0;
  for (const p of b.products) {
    if (p.current_stock === 0) outCount += 1;
    else if (p.current_stock <= p.reorder_level) lowCount += 1;
    inventoryValue += p.current_stock * (p.cost_price ?? p.unit_price ?? 0);
  }

  let customersNewMonth = 0;
  for (const c of b.customers) {
    const day = dayOf(c.created_at);
    if (day && inMonth(day, firstThis)) customersNewMonth += 1;
  }

  return {
    revenue_today: revenueToday,
    orders_today: ordersToday,
    revenue_month: revenueMonth,
    orders_month: ordersMonth,
    revenue_growth_percent: growth,
    profit_month: Math.round(profit * 100) / 100,
    products_count: b.products.length,
    inventory_value: inventoryValue,
    low_stock_count: lowCount,
    out_of_stock_count: outCount,
    customers_total: b.customers.length,
    customers_new_month: customersNewMonth,
  };
}

export function timeseries(b: LocalBundle, days = 30): LTimeseriesPoint[] {
  const today = todayIso();
  const since = addDaysIso(today, -(days - 1));
  const byDay = new Map<string, { revenue: number; orders: number }>();
  for (const o of b.orders) {
    if (!ACTIVE_STATUSES.includes(o.status)) continue;
    const day = dayOf(o.order_date);
    if (!day || day < since || day > today) continue;
    const d = byDay.get(day) ?? { revenue: 0, orders: 0 };
    d.revenue += o.total_amount;
    d.orders += 1;
    byDay.set(day, d);
  }
  return [...byDay.entries()]
    .sort((a, z) => a[0].localeCompare(z[0]))
    .map(([date, d]) => ({ date, revenue: d.revenue, orders: d.orders }));
}

function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function byCategory(b: LocalBundle): LCategoryValue[] {
  const map = new Map<string, number>();
  for (const p of b.products) {
    const cat = p.category || 'Uncategorized';
    map.set(cat, (map.get(cat) ?? 0) + p.current_stock * (p.cost_price ?? p.unit_price ?? 0));
  }
  return [...map.entries()].map(([category, value]) => ({ category, value })).sort((a, z) => z.value - a.value);
}

export function topProducts(b: LocalBundle, limit = 5): LTopProduct[] {
  const nameById = new Map(b.products.map((p) => [p.id, p.name]));
  const agg = new Map<number, { qty: number; revenue: number }>();
  // Server semantics: ALL items (no order-status filter) for this business.
  for (const it of b.items) {
    const d = agg.get(it.product_id) ?? { qty: 0, revenue: 0 };
    d.qty += it.quantity;
    d.revenue += it.quantity * it.unit_price;
    agg.set(it.product_id, d);
  }
  return [...agg.entries()]
    .map(([product_id, d]) => ({
      product_id,
      product_name: nameById.get(product_id) ?? `Product #${product_id}`,
      total_quantity: d.qty,
      total_revenue: d.revenue,
    }))
    .sort((a, z) => z.total_quantity - a.total_quantity)
    .slice(0, limit);
}

export function recentOrders(b: LocalBundle, limit = 8): LRecentOrder[] {
  const nameById = new Map(b.customers.map((c) => [c.id, c.full_name]));
  return [...b.orders]
    .sort((a, z) => z.id - a.id)
    .slice(0, limit)
    .map((o) => ({
      id: o.id,
      customer_id: o.customer_id ?? 0, // NOT NULL column; 0 never resolves (rendered as '—')
      customer: o.customer_id != null && nameById.has(o.customer_id) ? { full_name: nameById.get(o.customer_id)! } : null,
      status: o.status,
      total_amount: o.total_amount,
      order_date: o.order_date,
      created_at: o.created_at ?? o.order_date,
    }));
}

export function inventorySummary(b: LocalBundle): LInventorySummary {
  let value = 0;
  let low = 0;
  let out = 0;
  const cats = new Set<string>();
  for (const p of b.products) {
    if (p.current_stock === 0) out += 1;
    else if (p.current_stock <= p.reorder_level) low += 1;
    value += p.current_stock * (p.cost_price ?? p.unit_price ?? 0);
    if (p.category) cats.add(p.category);
  }
  return {
    products_count: b.products.length,
    inventory_value: value,
    low_stock_count: low,
    out_of_stock_count: out,
    categories_count: cats.size,
  };
}
