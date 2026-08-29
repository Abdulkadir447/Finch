/**
 * Inventory data hook (Task 8) — same architecture as the other modules.
 * Stock itself mutates ONLY through adjustStock() here (orders do their own
 * server-side movements); the ledger is read via fetchMovements().
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, useApiClient } from '../../services/api/client';
import { makeInventoryRepo, localBusinessId, isLocalModeActive, useLocalModeActivated } from '../../repositories';
import { getLocalDb } from '../../sync/localDb';

export type StockStatus = 'in' | 'low' | 'out';

export interface InventoryProduct {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit_price: number;
  cost_price: number | null;
  current_stock: number;
  reorder_level: number;
  version: number;
  created_at: string;
  updated_at: string | null;
}

export interface InventorySummary {
  products_count: number;
  inventory_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
  categories_count: number;
}

export type MovementReason =
  | 'initial'
  | 'purchase'
  | 'sale'
  | 'damaged'
  | 'returned'
  | 'correction'
  | 'order'
  | 'order_cancelled'
  | 'order_deleted';

export interface StockMovement {
  id: number;
  product_id: number;
  change: number;
  reason: MovementReason;
  note: string | null;
  order_id: number | null;
  actor: string | null;
  created_at: string;
}

export interface MovementListResponse {
  items: StockMovement[];
  total: number;
  page: number;
  limit: number;
}

export interface AdjustInput {
  change: number;
  reason: 'purchase' | 'sale' | 'damaged' | 'returned' | 'correction';
  note?: string;
}

export const INVENTORY_PAGE_SIZE = 10;

/** UXDS 11.11 manual adjustment reasons. */
export const ADJUST_REASONS: { value: AdjustInput['reason']; label: string }[] = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'sale', label: 'Sale' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'returned', label: 'Returned' },
  { value: 'correction', label: 'Manual Correction' },
];

/** Labels for every ledger reason (manual + automatic). */
export const MOVEMENT_LABELS: Record<MovementReason, string> = {
  initial: 'Initial stock',
  purchase: 'Purchase',
  sale: 'Sale',
  damaged: 'Damaged',
  returned: 'Returned',
  correction: 'Manual Correction',
  order: 'Order created',
  order_cancelled: 'Order cancelled',
  order_deleted: 'Order deleted',
};

/** Stock status labels (display chrome lives in the page's CoopBadge variants). */
export const STOCK_STATUS_META: Record<StockStatus, { label: string }> = {
  in: { label: 'In Stock' },
  low: { label: 'Low Stock' },
  out: { label: 'Out of Stock' },
};

/** UXDS 11.6 mutually exclusive stock status. */
export function stockStatusOf(p: InventoryProduct): StockStatus {
  if (p.current_stock <= 0) return 'out';
  if (p.current_stock <= p.reorder_level) return 'low';
  return 'in';
}

/** Inventory value per unit: cost price, falling back to unit price. */
export const unitValueOf = (p: InventoryProduct): number =>
  p.cost_price ?? p.unit_price;

export function useInventory() {
  const api = useApiClient();
  // OFFLINE 2: stock is operation-based (ADR-002 rule 5) — the adjustment is a
  // signed movement applied locally + queued on desktop, else the HTTP call.
  const inventoryRepo = makeInventoryRepo(api);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [items, setItems] = useState<InventoryProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // Command-palette deep links (Stage 2): apply ?q= when the palette
  // navigates to this module — including while it is already mounted.
  const location = useLocation();
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('q');
    if (q != null) setSearch(q);
  }, [location.search]);
  useEffect(() => {
    const stock = new URLSearchParams(location.search).get('stock');
    if (stock === 'in' || stock === 'low' || stock === 'out') setStockFilter(stock);
  }, [location.search]);

  const [stockFilter, setStockFilter] = useState<StockStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  /** Local read path (OFFLINE 3): the SQLite mirror; the summary is the
   *  same calculation the server does, computed from the mirrored rows —
   *  deterministic, no network. */
  const loadLocal = useCallback(
    async (requestedPage: number, query: string, filter: StockStatus | 'all') => {
      const biz = await localBusinessId(api);
      const db = getLocalDb();
      if (!db) throw new ApiError('Local data layer unavailable.');
      const rows = await db.productList({ business_id: biz, opts: { limit: 10000 } });
      const mapped: InventoryProduct[] = rows.map((r) => ({
        id: Number(r.id),
        sku: String(r.sku ?? ''),
        name: String(r.name ?? ''),
        description: (r.description as string | null) ?? null,
        category: (r.category as string | null) ?? null,
        unit_price: Number(r.unit_price ?? 0),
        cost_price: (r.cost_price as number | null) ?? null,
        current_stock: Number(r.current_stock ?? 0),
        reorder_level: Number(r.reorder_level ?? 0),
        version: 1,
        created_at: String(r.created_at ?? r.updated_at ?? ''),
        updated_at: (r.updated_at as string | null) ?? null,
      }));

      // Summary — the server's /inventory/summary, same inputs, same math.
      setSummary({
        products_count: mapped.length,
        inventory_value: Math.round(mapped.reduce((s, p) => s + p.current_stock * unitValueOf(p), 0) * 100) / 100,
        low_stock_count: mapped.filter((p) => stockStatusOf(p) === 'low').length,
        out_of_stock_count: mapped.filter((p) => stockStatusOf(p) === 'out').length,
        categories_count: new Set(mapped.map((p) => p.category).filter(Boolean)).size,
      });

      let list = mapped;
      if (filter === 'out') list = list.filter((p) => p.current_stock === 0);
      else if (filter === 'low') list = list.filter((p) => p.current_stock > 0 && p.current_stock <= p.reorder_level);
      else if (filter === 'in') list = list.filter((p) => p.current_stock > p.reorder_level);
      const q = query.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            (p.category ?? '').toLowerCase().includes(q),
        );
      }
      list = [...list].sort((a, b) => b.id - a.id);
      setTotal(list.length);
      const start = (requestedPage - 1) * INVENTORY_PAGE_SIZE;
      setItems(list.slice(start, start + INVENTORY_PAGE_SIZE));
      setPage(requestedPage);
    },
    [api],
  );

  const load = useCallback(
    async (requestedPage: number, query: string, filter: StockStatus | 'all') => {
      setLoading(true);
      setError(null);
      try {
        if (isLocalModeActive()) {
          await loadLocal(requestedPage, query, filter);
          return;
        }
        const [list, sum] = await Promise.all([
          api.get<{ items: InventoryProduct[]; total: number; page: number }>('/products', {
            params: {
              page: requestedPage,
              limit: INVENTORY_PAGE_SIZE,
              ...(query ? { search: query } : {}),
              ...(filter !== 'all' ? { stock: filter } : {}),
            },
          }),
          api.get<InventorySummary>('/inventory/summary'),
        ]);
        setItems(list.data.items);
        setTotal(list.data.total);
        setPage(list.data.page);
        setSummary(sum.data);
      } catch (e) {
        setError(
          e instanceof ApiError ? e : new ApiError('Unable to reach the Co-op API.'),
        );
      } finally {
        setLoading(false);
      }
    },
    [api, loadLocal],
  );

  // Debounced search/filter changes return to page 1.
  useEffect(() => {
    const timer = setTimeout(
      () => load(1, search.trim(), stockFilter),
      search ? 350 : 0,
    );
    return () => clearTimeout(timer);
  }, [search, stockFilter, load]);

  // The mirror became ready (initial pull): reload from the local mirror.
  useLocalModeActivated(() => {
    void load(page, search.trim(), stockFilter);
  });

  // Local-first stock adjustment (ADR-002 rule 5): a signed movement applied
  // to the local ledger + queued on desktop, otherwise the existing HTTP call.
  const adjustStock = (productId: number, input: AdjustInput) =>
    inventoryRepo.adjust(productId, input);

  /** Movement ledger for a product — local mirror when local mode is
   *  active (OFFLINE 3), else the server endpoint. */
  const fetchMovements = useCallback(
    async (productId: number, limit = 20): Promise<MovementListResponse> => {
      if (isLocalModeActive()) {
        const biz = await localBusinessId(api);
        const db = getLocalDb();
        if (!db) throw new ApiError('Local data layer unavailable.');
        const rows = await db.stockMovements({ business_id: biz, product_id: productId });
        const items: StockMovement[] = rows.map((r) => ({
          id: Number(r.id),
          product_id: Number(r.product_id),
          change: Number(r.change),
          reason: String(r.reason) as StockMovement['reason'],
          note: (r.note as string | null) ?? null,
          order_id: r.order_id != null ? Number(r.order_id) : null,
          actor: null,
          created_at: String(r.created_at ?? ''),
        }));
        items.sort((a, b) => b.id - a.id);
        return { items: items.slice(0, limit), total: items.length, page: 1, limit };
      }
      const { data } = await api.get<MovementListResponse>(`/products/${productId}/movements`, {
        params: { limit },
      });
      return data;
    },
    [api],
  );

  return {
    summary,
    items,
    total,
    page,
    pageSize: INVENTORY_PAGE_SIZE,
    search,
    setSearch,
    stockFilter,
    setStockFilter,
    loading,
    error,
    reload: () => load(page, search.trim(), stockFilter),
    goToPage: (p: number) => load(p, search.trim(), stockFilter),
    adjustStock,
    fetchMovements,
  };
}
