/**
 * OFFLINE 3.5 — local reporting engine.
 *
 * A verbatim port of the server's reporting engine (backend/reports/
 * service.py + filters.py): same filter contract, same line-level scoping,
 * same bucketing, same rounding, same table/notes content. In local mode the
 * Reports page renders these numbers from the SQLite mirror — identical to
 * what the server computes online (the server stays authoritative whenever
 * the app uses the remote path).
 *
 * One documented deviation: order lines whose product row is no longer in
 * the (non-deleted) local product list are skipped — the server inner-joins
 * products without a deleted filter, so this only differs for lines of
 * soft-deleted products.
 */
import type { ReportChart, ReportData, ReportKpi, ReportTable, ReportFiltersDict } from '../pages/Reports/reportConfig';
import type { LOrder, LocalBundle } from './localTypes';
import { dayDiff, dayOf, fmtDay, fmtDayYear, fmtMonth, todayIso } from './localTypes';

// ---------------------------------------------------------------------------
// Filter contract (port of backend/reports/filters.py)
// ---------------------------------------------------------------------------

export class LocalFilterError extends Error {}

export interface LocalReportFilters {
  from: string; // YYYY-MM-DD
  to: string;
  compare: 'none' | 'previous_period' | 'previous_month' | 'previous_year';
  category: string | null;
  product_id: number | null;
  customer_id: number | null;
}

const VALID_COMPARES = ['none', 'previous_period', 'previous_month', 'previous_year'] as const;

function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10))) throw new LocalFilterError(`Invalid date '${s}' — use YYYY-MM-DD.`);
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new LocalFilterError(`Invalid date '${s}' — use YYYY-MM-DD.`);
  }
  return s.slice(0, 10);
}

function shiftYearBack(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  try {
    const dt = new Date(Date.UTC(y - 1, m - 1, d));
    if (dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) return day.replace(String(y), String(y - 1));
  } catch {
    /* fall through */
  }
  return `${y - 1}-${String(m).padStart(2, '0')}-28`; // Feb 29 -> Feb 28
}

/** Port of ReportFilters.from_query (defaults + validation). */
export function parseFilters(input: {
  from?: string | null;
  to?: string | null;
  compare?: string | null;
  category?: string | null;
  product_id?: number | null;
  customer_id?: number | null;
}): LocalReportFilters {
  const today = todayIso();
  const to = parseDate(input.to) ?? today;
  let from = parseDate(input.from);
  if (!from) {
    const [y, m, d] = to.split('-').map(Number);
    from = new Date(Date.UTC(y, m - 1, d - 29)).toISOString().slice(0, 10);
  }
  if (from > to) throw new LocalFilterError("'from' must be on or before 'to'.");
  if (dayDiff(from, to) > 730) throw new LocalFilterError('Report range is limited to 2 years.');
  const compare = ((input.compare ?? 'none').trim().toLowerCase() || 'none') as LocalReportFilters['compare'];
  if (!VALID_COMPARES.includes(compare)) {
    throw new LocalFilterError(`compare must be one of: ${VALID_COMPARES.join(', ')}`);
  }
  const category = (input.category ?? '').trim() || null;
  return { from, to, compare, category, product_id: input.product_id ?? null, customer_id: input.customer_id ?? null };
}

/** Port of ReportFilters.previous_range. */
export function previousRange(f: LocalReportFilters): [string, string] | null {
  if (f.compare === 'none') return null;
  if (f.compare === 'previous_period') {
    const span = dayDiff(f.from, f.to) + 1;
    const end = addDaysIso(f.from, -1);
    return [addDaysIso(end, -(span - 1)), end];
  }
  if (f.compare === 'previous_month') {
    const firstThis = monthStartOf(f.to);
    const lastPrev = addDaysIso(firstThis, -1);
    return [monthStartOf(lastPrev), lastPrev];
  }
  return [shiftYearBack(f.from), shiftYearBack(f.to)];
}

function monthStartOf(day: string): string {
  return day.slice(0, 7) + '-01';
}

function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function periodLabel(f: LocalReportFilters): string {
  return `${fmtDayYear(f.from)} – ${fmtDayYear(f.to)}`;
}

export function filtersToDict(f: LocalReportFilters): ReportFiltersDict {
  return {
    from: f.from,
    to: f.to,
    compare: f.compare,
    category: f.category,
    product_id: f.product_id,
    customer_id: f.customer_id,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers (ports of the engine's private functions)
// ---------------------------------------------------------------------------

function round2(v: number | null | undefined): number | null {
  return v == null ? null : Math.round(v * 100) / 100;
}

function pctChange(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100 * 10) / 10;
}

interface LineRow {
  order_id: number;
  customer_id: number | null;
  product_id: number;
  product_name: string;
  category: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
  cost_price: number | null;
}

/** Port of _scoped_lines: window [start, end] INCLUSIVE, line-level filters. */
function scopedLines(b: LocalBundle, f: LocalReportFilters, start: string, end: string): { orders: LOrder[]; rows: LineRow[] } {
  const orderById = new Map(b.orders.map((o) => [o.id, o]));
  const productById = new Map(b.products.map((p) => [p.id, p]));
  const ordersFound = new Map<number, LOrder>();
  const rows: LineRow[] = [];
  for (const it of b.items) {
    const o = orderById.get(it.order_id);
    if (!o || o.status === 'cancelled') continue;
    const day = dayOf(o.order_date);
    if (!day || day < start || day > end) continue;
    if (f.product_id != null && it.product_id !== f.product_id) continue;
    const p = productById.get(it.product_id);
    if (!p) continue; // inner-join semantics (see module note)
    if (f.category != null && p.category !== f.category) continue;
    if (f.customer_id != null && o.customer_id !== f.customer_id) continue;
    rows.push({
      order_id: o.id,
      customer_id: o.customer_id,
      product_id: it.product_id,
      product_name: p.name,
      category: p.category,
      qty: it.quantity,
      unit_price: it.unit_price,
      line_total: it.total_price,
      cost_price: p.cost_price,
    });
    ordersFound.set(o.id, o);
  }
  return { orders: [...ordersFound.values()], rows };
}

/** Port of _bucketize: daily up to a 62-day span, monthly after. */
function bucketize(dates: string[]): { mode: 'day' | 'month'; keys: string[] } {
  if (!dates.length) return { mode: 'day', keys: [] };
  const span = dayDiff(dates.reduce((a, z) => (a < z ? a : z)), dates.reduce((a, z) => (a > z ? a : z)));
  if (span <= 62) return { mode: 'day', keys: [] };
  const months = [...new Set(dates.map((d) => monthStartOf(d)))].sort();
  return { mode: 'month', keys: months };
}

function bucketKey(day: string, mode: 'day' | 'month'): string {
  return mode === 'day' ? day : monthStartOf(day);
}

function fmtBucket(day: string, mode: 'day' | 'month'): string {
  return mode === 'day' ? fmtDay(day) : fmtMonth(day);
}

function compareLabel(f: LocalReportFilters): string {
  return {
    previous_period: 'previous period',
    previous_month: 'previous month',
    previous_year: 'previous year',
    none: 'previous',
  }[f.compare];
}

function kpi(key: string, label: string, value: number | null, format: ReportKpi['format'], good_when: ReportKpi['good_when'] = 'up'): ReportKpi {
  return { key, label, value, format, previous: null, change_percent: null, good_when };
}

// ---------------------------------------------------------------------------
// Sales report
// ---------------------------------------------------------------------------

function salesReport(b: LocalBundle, f: LocalReportFilters): ReportData {
  const { orders, rows } = scopedLines(b, f, f.from, f.to);
  const revenue = rows.reduce((s, r) => s + (r.line_total || 0), 0);
  const units = rows.reduce((s, r) => s + (r.qty || 0), 0);
  const nOrders = orders.length;
  const aov = nOrders ? revenue / nOrders : null;

  const kpis: ReportKpi[] = [
    kpi('revenue', 'Revenue', round2(revenue), 'money'),
    kpi('orders', 'Orders', nOrders, 'number'),
    kpi('units', 'Units sold', units, 'number'),
    kpi('aov', 'Average order value', round2(aov), 'money'),
  ];

  const notes: string[] = [];
  let prevKpis: Record<string, number | null> = {};
  const prevSeries = new Map<string, number>();
  if (f.compare !== 'none') {
    const prev = previousRange(f);
    if (prev) {
      const p = scopedLines(b, f, prev[0], prev[1]);
      const pRevenue = p.rows.reduce((s, r) => s + (r.line_total || 0), 0);
      const pUnits = p.rows.reduce((s, r) => s + (r.qty || 0), 0);
      const pN = p.orders.length;
      prevKpis = {
        revenue: round2(pRevenue) ?? 0,
        orders: pN,
        units: pUnits,
        aov: pN ? round2(pRevenue / pN) : null,
      };
      const mode = bucketize(p.orders.map((o) => dayOf(o.order_date)).filter(Boolean) as string[]).mode;
      for (const o of p.orders) {
        const od = dayOf(o.order_date);
        if (od) prevSeries.set(bucketKey(od, mode), (prevSeries.get(bucketKey(od, mode)) ?? 0) + (o.total_amount || 0));
      }
    }
  }

  for (const k of kpis) {
    if (k.previous == null && k.key in prevKpis) k.previous = prevKpis[k.key] ?? null;
    if (k.key !== 'units') k.change_percent = pctChange(k.value as number, k.previous);
  }
  kpis[0].change_percent = f.compare !== 'none' ? pctChange(revenue, prevKpis['revenue'] ?? null) : null;

  // Chart: order totals over time (+ comparison overlay aligned by ordinal).
  const orderDates = orders.map((o) => dayOf(o.order_date)).filter(Boolean) as string[];
  const mode = bucketize(orderDates).mode;
  const curSeries = new Map<string, number>();
  for (const o of orders) {
    const od = dayOf(o.order_date);
    if (od) curSeries.set(bucketKey(od, mode), (curSeries.get(bucketKey(od, mode)) ?? 0) + (o.total_amount || 0));
  }
  const curKeys = [...curSeries.keys()].sort();
  let series: ReportChart['series'];
  if (f.compare !== 'none' && previousRange(f)) {
    const prevKeys = [...prevSeries.keys()].sort();
    const aligned = new Map<string, number>();
    prevKeys.forEach((pk, i) => {
      if (i < curKeys.length) aligned.set(curKeys[i], prevSeries.get(pk) ?? 0);
    });
    series = [
      { name: 'Current period', data: curKeys.map((k) => round2(curSeries.get(k) ?? 0) ?? 0) },
      { name: `Previous (${compareLabel(f)})`, data: curKeys.map((k) => round2(aligned.get(k) ?? 0) ?? 0) },
    ];
  } else {
    series = [{ name: 'Revenue', data: curKeys.map((k) => round2(curSeries.get(k) ?? 0) ?? 0) }];
  }

  // Tables (line-level): top products, all categories, top customers.
  const byProduct = new Map<string, { units: number; revenue: number }>();
  const byCategory = new Map<string, { units: number; revenue: number }>();
  const byCustomer = new Map<number, { orderIds: Set<number>; revenue: number }>();
  for (const r of rows) {
    const pd = byProduct.get(r.product_name) ?? { units: 0, revenue: 0 };
    pd.units += r.qty || 0;
    pd.revenue += r.line_total || 0;
    byProduct.set(r.product_name, pd);
    const cat = r.category || 'Uncategorized';
    const cd = byCategory.get(cat) ?? { units: 0, revenue: 0 };
    cd.units += r.qty || 0;
    cd.revenue += r.line_total || 0;
    byCategory.set(cat, cd);
    const cu = byCustomer.get(r.customer_id ?? -1) ?? { orderIds: new Set(), revenue: 0 };
    cu.orderIds.add(r.order_id);
    cu.revenue += r.line_total || 0;
    byCustomer.set(r.customer_id ?? -1, cu);
  }
  const prodRows = [...byProduct.entries()]
    .map(([name, d]) => ({ name, units: d.units, revenue: round2(d.revenue) ?? 0, share: revenue ? Math.round((d.revenue / revenue) * 100 * 10) / 10 : 0 }))
    .sort((a, z) => z.revenue - a.revenue)
    .slice(0, 10);
  const catRows = [...byCategory.entries()]
    .map(([category, d]) => ({ category, units: d.units, revenue: round2(d.revenue) ?? 0, share: revenue ? Math.round((d.revenue / revenue) * 100 * 10) / 10 : 0 }))
    .sort((a, z) => z.revenue - a.revenue);
  const custNames = new Map(b.customers.map((c) => [c.id, c.full_name]));
  const custRows = [...byCustomer.entries()]
    .map(([cid, d]) => ({ name: cid >= 0 ? custNames.get(cid) ?? `Customer #${cid}` : 'Unknown', orders: d.orderIds.size, revenue: round2(d.revenue) ?? 0 }))
    .sort((a, z) => z.revenue - a.revenue)
    .slice(0, 10);

  if (rows.length === 0 && nOrders === 0) notes.push('No sales in this period (or matching these filters).');

  return {
    key: 'sales',
    title: 'Sales Report',
    period_label: periodLabel(f),
    compare: f.compare,
    filters: filtersToDict(f),
    generated_at: new Date().toISOString(),
    kpis,
    chart: { kind: 'line', labels: curKeys.map((k) => fmtBucket(k, mode)), series, money: true },
    tables: [
      {
        title: 'Top products',
        columns: ['Product', 'Units', 'Revenue', 'Share'],
        rows: prodRows.map((r) => [r.name, r.units, r.revenue, `${r.share}%`]),
        numeric_cols: [1, 2, 3],
      },
      {
        title: 'Sales by category',
        columns: ['Category', 'Units', 'Revenue', 'Share'],
        rows: catRows.map((r) => [r.category, r.units, r.revenue, `${r.share}%`]),
        numeric_cols: [1, 2, 3],
      },
      {
        title: 'Top customers',
        columns: ['Customer', 'Orders', 'Revenue'],
        rows: custRows.map((r) => [r.name, r.orders, r.revenue]),
        numeric_cols: [1, 2],
      },
    ],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Profit & Loss (gross)
// ---------------------------------------------------------------------------

function profitLossReport(b: LocalBundle, f: LocalReportFilters): ReportData {
  const { orders, rows } = scopedLines(b, f, f.from, f.to);
  const revenue = rows.reduce((s, r) => s + (r.line_total || 0), 0);
  const cogs = rows.reduce((s, r) => s + (r.cost_price != null ? (r.cost_price || 0) * (r.qty || 0) : 0), 0);
  const costCoveredValue = rows.reduce((s, r) => s + (r.cost_price != null ? (r.unit_price || 0) * (r.qty || 0) : 0), 0);
  const gross = revenue - cogs;
  const margin = revenue ? (gross / revenue) * 100 : null;
  const coverage = revenue ? (costCoveredValue / revenue) * 100 : 0.0;

  const notes: string[] = [
    'Gross P&L — Co-op does not track operating expenses yet, so this is revenue minus cost of goods, not a full accounting statement.',
  ];
  if (rows.length && coverage < 99.9) {
    notes.push(`Cost data covers ${Math.round(coverage)}% of sold-line value; products without a cost price are excluded from COGS.`);
  }

  const kpis: ReportKpi[] = [
    kpi('revenue', 'Revenue', round2(revenue), 'money'),
    kpi('cogs', 'COGS', round2(cogs), 'money', 'down'),
    kpi('gross_profit', 'Gross profit', round2(gross), 'money'),
    kpi('gross_margin', 'Gross margin', margin != null ? Math.round(margin * 10) / 10 : 0, 'percent'),
  ];
  if (f.compare !== 'none') {
    const prev = previousRange(f);
    if (prev) {
      const p = scopedLines(b, f, prev[0], prev[1]);
      const pRevenue = p.rows.reduce((s, r) => s + (r.line_total || 0), 0);
      const pCogs = p.rows.reduce((s, r) => s + (r.cost_price != null ? (r.cost_price || 0) * (r.qty || 0) : 0), 0);
      const pGross = pRevenue - pCogs;
      const pMargin = pRevenue ? (pGross / pRevenue) * 100 : null;
      kpis[0].previous = round2(pRevenue);
      kpis[0].change_percent = pctChange(revenue, pRevenue);
      kpis[1].previous = round2(pCogs);
      kpis[1].change_percent = cogs || pCogs ? pctChange(cogs, pCogs) : null;
      kpis[2].previous = round2(pGross);
      kpis[2].change_percent = pctChange(gross, pGross);
      kpis[3].previous = pMargin != null ? Math.round(pMargin * 10) / 10 : null;
      // Margin delta is expressed in percentage POINTS.
      if (margin != null && pMargin != null) kpis[3].change_percent = Math.round((margin - pMargin) * 10) / 10;
    }
  }

  const orderDates = orders.map((o) => dayOf(o.order_date)).filter(Boolean) as string[];
  const mode = bucketize(orderDates).mode;
  const revSeries = new Map<string, number>();
  const gpSeries = new Map<string, number>();
  const itemsByOrder = new Map<number, LineRow[]>();
  for (const r of rows) itemsByOrder.set(r.order_id, [...(itemsByOrder.get(r.order_id) ?? []), r]);
  for (const o of orders) {
    const od = dayOf(o.order_date);
    if (!od) continue;
    const k = bucketKey(od, mode);
    revSeries.set(k, (revSeries.get(k) ?? 0) + (o.total_amount || 0));
    const gp = (itemsByOrder.get(o.id) ?? []).reduce((s, r) => s + (r.line_total || 0) - ((r.cost_price || 0) * (r.qty || 0)), 0);
    gpSeries.set(k, (gpSeries.get(k) ?? 0) + gp);
  }
  const revKeys = [...revSeries.keys()].sort();

  const byProduct = new Map<string, { units: number; revenue: number; cogs: number }>();
  for (const r of rows) {
    const d = byProduct.get(r.product_name) ?? { units: 0, revenue: 0, cogs: 0 };
    d.units += r.qty || 0;
    d.revenue += r.line_total || 0;
    if (r.cost_price != null) d.cogs += (r.cost_price || 0) * (r.qty || 0);
    byProduct.set(r.product_name, d);
  }
  const prof = [...byProduct.entries()]
    .map(([name, d]) => ({
      name,
      units: d.units,
      revenue: round2(d.revenue) ?? 0,
      cogs: round2(d.cogs) ?? 0,
      profit: round2(d.revenue - d.cogs) ?? 0,
      margin: d.revenue ? Math.round(((d.revenue - d.cogs) / d.revenue) * 100 * 10) / 10 : null,
    }))
    .sort((a, z) => z.profit - a.profit);
  const lowest = prof.filter((p) => p.margin != null).sort((a, z) => (a.margin ?? 0) - (z.margin ?? 0));

  const tables: ReportTable[] = [
    {
      title: 'Most profitable products',
      columns: ['Product', 'Units', 'Revenue', 'COGS', 'Gross profit', 'Margin'],
      rows: prof.slice(0, 10).map((p) => [p.name, p.units, p.revenue, p.cogs, p.profit, p.margin != null ? `${p.margin.toFixed(1)}%` : '—']),
      numeric_cols: [1, 2, 3, 4, 5],
    },
    {
      title: 'Lowest-margin products',
      columns: ['Product', 'Units', 'Revenue', 'COGS', 'Gross profit', 'Margin'],
      rows: lowest.slice(0, 5).map((p) => [p.name, p.units, p.revenue, p.cogs, p.profit, `${p.margin!.toFixed(1)}%`]),
      numeric_cols: [1, 2, 3, 4, 5],
    },
  ];

  return {
    key: 'profit-loss',
    title: 'Profit & Loss (Gross)',
    period_label: periodLabel(f),
    compare: f.compare,
    filters: filtersToDict(f),
    generated_at: new Date().toISOString(),
    kpis,
    chart: {
      kind: 'bar',
      labels: revKeys.map((k) => fmtBucket(k, mode)),
      series: [
        { name: 'Revenue', data: revKeys.map((k) => round2(revSeries.get(k) ?? 0) ?? 0) },
        { name: 'Gross profit', data: revKeys.map((k) => round2(gpSeries.get(k) ?? 0) ?? 0) },
      ],
      money: true,
    },
    tables,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Inventory report (point-in-time + movement within the period)
// ---------------------------------------------------------------------------

function inventoryReport(b: LocalBundle, f: LocalReportFilters): ReportData {
  let products = b.products;
  if (f.category != null) products = products.filter((p) => p.category === f.category);
  if (f.product_id != null) products = products.filter((p) => p.id === f.product_id);

  const value = (p: { current_stock: number; cost_price: number | null; unit_price: number | null }) =>
    (p.current_stock || 0) * (p.cost_price ?? p.unit_price ?? 0);

  const totalValue = products.reduce((s, p) => s + value(p), 0);
  const unitsOnHand = products.reduce((s, p) => s + (p.current_stock || 0), 0);
  const low = products.filter((p) => 0 < (p.current_stock || 0) && (p.current_stock || 0) <= (p.reorder_level || 0));
  const out = products.filter((p) => (p.current_stock || 0) <= 0);

  const kpis: ReportKpi[] = [
    kpi('value', 'Inventory value', round2(totalValue), 'money'),
    kpi('units', 'Units on hand', unitsOnHand, 'number'),
    kpi('low', 'Low stock', low.length, 'number', 'down'),
    kpi('out', 'Out of stock', out.length, 'number', 'down'),
  ];

  const notes: string[] = [];
  if (out.length) notes.push(`${out.length} product${out.length !== 1 ? 's' : ''} out of stock — these generate no revenue until restocked.`);
  if (low.length) notes.push(`${low.length} product${low.length !== 1 ? 's' : ''} at or below reorder level.`);

  const byCat = new Map<string, number>();
  for (const p of products) {
    const c = p.category || 'Uncategorized';
    byCat.set(c, (byCat.get(c) ?? 0) + value(p));
  }
  const cats = [...byCat.entries()].sort((a, z) => z[1] - a[1]);

  const risk = [...out, ...low].sort((a, z) => {
    const aOut = (a.current_stock || 0) <= 0 ? 0 : 1;
    const zOut = (z.current_stock || 0) <= 0 ? 0 : 1;
    return aOut - zOut || (a.current_stock || 0) - (z.current_stock || 0);
  });
  const topValue = [...products].sort((a, z) => value(z) - value(a)).slice(0, 10);

  // Movement within the period (immutable stock ledger).
  const productIds = new Set(products.map((p) => p.id));
  const prodNames = new Map(products.map((p) => [p.id, p.name]));
  const mv = new Map<string, { in: number; out: number }>();
  for (const m of b.movements) {
    if (!productIds.has(m.product_id)) continue;
    const day = dayOf(m.created_at);
    if (!day || day < f.from || day > f.to) continue;
    const name = prodNames.get(m.product_id) ?? `Product #${m.product_id}`;
    const d = mv.get(name) ?? { in: 0, out: 0 };
    if ((m.change || 0) > 0) d.in += Math.abs(m.change);
    else d.out += Math.abs(m.change);
    mv.set(name, d);
  }
  const mvRows = [...mv.entries()].sort((a, z) => z[1].in + z[1].out - (a[1].in + a[1].out)).slice(0, 10);

  // Slow/fast movers: units sold in the period vs stock on hand.
  const { rows } = scopedLines(b, f, f.from, f.to);
  const sold = new Map<string, number>();
  for (const r of rows) sold.set(r.product_name, (sold.get(r.product_name) ?? 0) + (r.qty || 0));
  const movers = products
    .map((p) => [p.name, sold.get(p.name) ?? 0, p.current_stock || 0] as [string, number, number])
    .sort((a, z) => z[1] - a[1]);
  const fast = movers.filter((m) => m[1] > 0).slice(0, 5);
  const slow = movers
    .filter((m) => m[1] === 0 && m[2] > 0)
    .sort((a, z) => a[1] - z[1] || z[2] - a[2])
    .slice(0, 5);

  return {
    key: 'inventory',
    title: 'Inventory Report',
    period_label: periodLabel(f),
    compare: f.compare,
    filters: filtersToDict(f),
    generated_at: new Date().toISOString(),
    kpis,
    chart: {
      kind: 'donut',
      labels: cats.map(([c]) => c),
      series: [{ name: 'Value', data: cats.map(([, v]) => round2(v) ?? 0) }],
      money: true,
    },
    tables: [
      {
        title: 'Stock risk',
        columns: ['Product', 'SKU', 'On hand', 'Reorder level', 'Value'],
        rows: risk.slice(0, 15).map((p) => [p.name, p.sku || '—', p.current_stock, p.reorder_level || 0, round2(value(p)) ?? 0]),
        numeric_cols: [2, 3, 4],
      },
      {
        title: 'Top inventory value',
        columns: ['Product', 'Units', 'Unit cost', 'Value'],
        rows: topValue.map((p) => [p.name, p.current_stock || 0, round2(p.cost_price ?? p.unit_price ?? 0) ?? 0, round2(value(p)) ?? 0]),
        numeric_cols: [1, 2, 3],
      },
      {
        title: `Stock movement (${periodLabel(f)})`,
        columns: ['Product', 'In', 'Out', 'Net'],
        rows: mvRows.map(([n, d]) => [n, d.in, d.out, d.in - d.out]),
        numeric_cols: [1, 2, 3],
      },
      {
        title: 'Fast movers (period)',
        columns: ['Product', 'Units sold', 'On hand'],
        rows: fast.map(([n, s, h]) => [n, s, h]),
        numeric_cols: [1, 2],
      },
      {
        title: 'Slow movers (no sales in period)',
        columns: ['Product', 'Units sold', 'On hand'],
        rows: slow.map(([n, s, h]) => [n, s, h]),
        numeric_cols: [1, 2],
      },
    ],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Customers report
// ---------------------------------------------------------------------------

function customersReport(b: LocalBundle, f: LocalReportFilters): ReportData {
  const custById = new Map(b.customers.map((c) => [c.id, c]));

  const periodOrders = b.orders.filter((o) => {
    if (o.status === 'cancelled') return false;
    const day = dayOf(o.order_date);
    return day != null && day >= f.from && day <= f.to;
  });

  const totalCustomers = b.customers.length;
  const newInPeriod = b.customers.filter((c) => {
    const day = dayOf(c.created_at);
    return day != null && day >= f.from && day <= f.to;
  });

  const ordersByCust = new Map<number, number>();
  const periodRevenueByCust = new Map<number, number>();
  for (const o of periodOrders) {
    if (o.customer_id == null) continue;
    ordersByCust.set(o.customer_id, (ordersByCust.get(o.customer_id) ?? 0) + 1);
    periodRevenueByCust.set(o.customer_id, (periodRevenueByCust.get(o.customer_id) ?? 0) + (o.total_amount || 0));
  }
  const repeat = [...ordersByCust.entries()].filter(([, n]) => n >= 2).length;
  const nActive = periodRevenueByCust.size;
  const periodRevenue = [...periodRevenueByCust.values()].reduce((s, v) => s + v, 0);
  const revPerCust = nActive ? periodRevenue / nActive : null;

  // Lifetime (all-time, non-cancelled) for top customers + inactivity.
  const lifetime = new Map<number, number>();
  const lastOrder = new Map<number, string>();
  for (const o of b.orders) {
    if (o.customer_id == null || o.status === 'cancelled') continue;
    lifetime.set(o.customer_id, (lifetime.get(o.customer_id) ?? 0) + (o.total_amount || 0));
    const od = dayOf(o.order_date);
    if (od) {
      const prev = lastOrder.get(o.customer_id);
      if (!prev || od > prev) lastOrder.set(o.customer_id, od);
    }
  }

  const today = todayIso();
  const inactive: Array<[number, number, number]> = [];
  for (const [cid, last] of lastOrder) {
    const days = dayDiff(last, today);
    if (days >= 30) inactive.push([cid, days, lifetime.get(cid) ?? 0.0]);
  }
  inactive.sort((a, z) => z[2] - a[2]);

  const kpis: ReportKpi[] = [
    kpi('total', 'Total customers', totalCustomers, 'number'),
    kpi('new', 'New in period', newInPeriod.length, 'number'),
    kpi('repeat', 'Repeat customers', repeat, 'number'),
    kpi('rev_per_cust', 'Revenue per active customer', round2(revPerCust), 'money'),
  ];

  const notes: string[] = [];
  if (inactive.length) notes.push(`${inactive.length} customer${inactive.length !== 1 ? 's' : ''} haven't ordered in 30+ days — the top ones are listed below.`);

  // Chart: new customers over time (creation dates within the period).
  const newDates = newInPeriod.map((c) => dayOf(c.created_at)).filter(Boolean) as string[];
  const mode = bucketize(newDates).mode;
  const newSeries = new Map<string, number>();
  for (const d of newDates) newSeries.set(bucketKey(d, mode), (newSeries.get(bucketKey(d, mode)) ?? 0) + 1);
  const newKeys = [...newSeries.keys()].sort();

  const top = [...periodRevenueByCust.entries()]
    .filter(([cid]) => custById.has(cid))
    .sort((a, z) => z[1] - a[1])
    .slice(0, 10);
  const topRows = top.map(([cid, rev]) => [
    custById.get(cid)!.full_name,
    ordersByCust.get(cid) ?? 0,
    round2(rev) ?? 0,
    round2(lifetime.get(cid) ?? 0) ?? 0,
    lastOrder.has(cid) ? fmtDayYear(lastOrder.get(cid)!) : '—',
  ]);
  const inactiveRows = inactive.slice(0, 10).map(([cid, days, ltv]) => [
    custById.has(cid) ? custById.get(cid)!.full_name : `Customer #${cid}`,
    days,
    round2(ltv) ?? 0,
  ]);
  const newRows = [...newInPeriod]
    .sort((a, z) => (dayOf(a.created_at) ?? today).localeCompare(dayOf(z.created_at) ?? today))
    .slice(0, 10)
    .map((c) => [c.full_name, fmtDayYear(dayOf(c.created_at) ?? today), round2(periodRevenueByCust.get(c.id) ?? 0) ?? 0]);

  return {
    key: 'customers',
    title: 'Customers Report',
    period_label: periodLabel(f),
    compare: f.compare,
    filters: filtersToDict(f),
    generated_at: new Date().toISOString(),
    kpis,
    chart: {
      kind: 'bar',
      labels: newKeys.map((k) => fmtBucket(k, mode)),
      series: [{ name: 'New customers', data: newKeys.map((k) => newSeries.get(k) ?? 0) }],
      money: false,
    },
    tables: [
      {
        title: 'Top customers (period)',
        columns: ['Customer', 'Orders', 'Revenue (period)', 'Lifetime revenue', 'Last order'],
        rows: topRows,
        numeric_cols: [1, 2, 3],
      },
      {
        title: 'Inactive 30+ days',
        columns: ['Customer', 'Days since order', 'Lifetime revenue'],
        rows: inactiveRows,
        numeric_cols: [1, 2],
      },
      {
        title: 'New in period',
        columns: ['Customer', 'First seen', 'Revenue (period)'],
        rows: newRows,
        numeric_cols: [2],
      },
    ],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export const LOCAL_REPORT_KEYS = ['sales', 'profit-loss', 'inventory', 'customers'] as const;
export type LocalReportKey = (typeof LOCAL_REPORT_KEYS)[number];

export function buildLocalReport(b: LocalBundle, key: string, filters: LocalReportFilters): ReportData {
  switch (key) {
    case 'sales':
      return salesReport(b, filters);
    case 'profit-loss':
      return profitLossReport(b, filters);
    case 'inventory':
      return inventoryReport(b, filters);
    case 'customers':
      return customersReport(b, filters);
    default:
      throw new Error(`Unknown report: ${key}`);
  }
}
