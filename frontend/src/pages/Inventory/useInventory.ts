/**
 * Inventory data hook (Task 8) — same architecture as the other modules.
 * Stock itself mutates ONLY through adjustStock() here (orders do their own
 * server-side movements); the ledger is read via fetchMovements().
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, useApiClient } from '../../services/api/client';

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

  const load = useCallback(
    async (requestedPage: number, query: string, filter: StockStatus | 'all') => {
      setLoading(true);
      setError(null);
      try {
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
    [api],
  );

  // Debounced search/filter changes return to page 1.
  useEffect(() => {
    const timer = setTimeout(
      () => load(1, search.trim(), stockFilter),
      search ? 350 : 0,
    );
    return () => clearTimeout(timer);
  }, [search, stockFilter, load]);

  const adjustStock = (productId: number, input: AdjustInput) =>
    api.post<InventoryProduct>(`/products/${productId}/adjust`, input);

  const fetchMovements = (productId: number, limit = 20) =>
    api.get<MovementListResponse>(`/products/${productId}/movements`, {
      params: { limit },
    });

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
