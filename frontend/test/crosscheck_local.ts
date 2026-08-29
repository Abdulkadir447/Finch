/**
 * Cross-check (TS side): the local analytics engines on the SAME fixture as
 * /tmp/crosscheck_server.py. Outputs are diffed field-for-field by the
 * compare script — dates resolve identically on the same day.
 *
 *   tsc test/crosscheck_local.ts --outDir /tmp/anatest --module commonjs \
 *     --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck
 *   node /tmp/anatest/test/crosscheck_local.js > /tmp/local_out.json
 */
import {
  addDays,
  dayOf,
  monthStart,
  todayIso,
} from '../src/analytics/localTypes';
import type { LCustomer, LOrder, LOrderItem, LProduct, LocalBundle } from '../src/analytics/localTypes';
import {
  byCategory,
  inventorySummary,
  recentOrders,
  summary,
  timeseries,
  topProducts,
} from '../src/analytics/localDashboard';
import { buildLocalReport, parseFilters } from '../src/analytics/localReports';
import { buildLocalBriefing } from '../src/analytics/localBriefing';

const today = todayIso();
const D = (n: number) => addDays(today, -n);

const products: LProduct[] = [
  { id: 11, name: 'Chair', sku: 'C1', category: 'Furniture', unit_price: 100, cost_price: 40, current_stock: 10, reorder_level: 3 },
  { id: 12, name: 'Cup', sku: 'K1', category: 'Kitchen', unit_price: 10, cost_price: null, current_stock: 5, reorder_level: 2 },
];
const customers: LCustomer[] = [
  { id: 1, full_name: 'Grace', email: 'g@x.com', created_at: today },
  { id: 2, full_name: 'Sam', email: 's@x.com', created_at: today },
];

const mkOrder = (id: number, customer_id: number, date: string, status: string, total: number): LOrder => ({
  id, customer_id, status, total_amount: total, order_date: date, created_at: date,
});
const mkItem = (id: number, order_id: number, product_id: number, quantity: number, unit_price: number): LOrderItem => ({
  id, order_id, product_id, quantity, unit_price, total_price: quantity * unit_price,
});

const orders: LOrder[] = [
  mkOrder(1, 1, D(0), 'shipped', 210),
  mkOrder(2, 2, D(1), 'delivered', 100),
  mkOrder(3, 1, D(0), 'cancelled', 500),
];
const items: LOrderItem[] = [
  mkItem(1, 1, 11, 2, 100),
  mkItem(2, 1, 12, 1, 10),
  mkItem(3, 2, 11, 1, 100),
  mkItem(4, 3, 11, 5, 100),
];

const bundle: LocalBundle = {
  business: { id: 1, name: 'Test Co', currency: 'USD' },
  products, customers, orders, items,
  movements: [],
};

const f = parseFilters({ from: D(29), to: today, compare: 'previous_period' });

const out: Record<string, unknown> = {
  sales: buildLocalReport(bundle, 'sales', f),
  'profit-loss': buildLocalReport(bundle, 'profit-loss', f),
  inventory: buildLocalReport(bundle, 'inventory', f),
  customers: buildLocalReport(bundle, 'customers', f),
  summary: summary(bundle),
  briefing: buildLocalBriefing(bundle),
  timeseries: timeseries(bundle, 30),
  by_category: byCategory(bundle),
  top_products: topProducts(bundle, 5),
};

// Normalize for the diff: generated_at is a timestamp (differs by definition).
for (const key of ['sales', 'profit-loss', 'inventory', 'customers'] as const) {
  (out[key] as { generated_at?: string }).generated_at = 'X';
}

console.log(JSON.stringify(out, null, 1));
void dayOf;
void monthStart;
void recentOrders;
void inventorySummary;
