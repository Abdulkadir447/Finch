/**
 * Products data hook — list/search/paginate + create/update/soft-delete,
 * all through the Clerk-authenticated API client. No data is ever invented:
 * an empty tenant produces an honest empty envelope.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, useApiClient } from '../../services/api/client';
import { makeProductRepo } from '../../repositories';

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit_price: number;
  cost_price: number | null;
  current_stock: number;
  reorder_level: number;
  created_at: string;
  updated_at: string | null;
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  limit: number;
}

export interface ProductFormValues {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit_price: number;
  cost_price?: number;
  current_stock: number;
  reorder_level: number;
}

export const PRODUCTS_PAGE_SIZE = 10;

export type ProductStockFilter = 'all' | 'low' | 'out';

export function useProducts() {
  const api = useApiClient();
  // OFFLINE 2: mutations go through the repository (local-first on desktop,
  // unchanged HTTP in a browser). Reads stay server-backed until pull exists.
  const productsRepo = makeProductRepo(api);
  const [items, setItems] = useState<Product[]>([]);
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

  // Catalog tabs (Stage 5): All Products / Low Stock / Out of Stock — maps
  // to the backend's existing `stock` filter param (no new queries).
  const [stockFilter, setStockFilter] = useState<ProductStockFilter>('all');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(
    async (requestedPage: number, query: string, filter: ProductStockFilter) => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get<ProductListResponse>('/products', {
          params: {
            page: requestedPage,
            limit: PRODUCTS_PAGE_SIZE,
            ...(query ? { search: query } : {}),
            ...(filter !== 'all' ? { stock: filter } : {}),
          },
        });
        setItems(data.items);
        setTotal(data.total);
        setPage(data.page);
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

  // Debounced search always returns to page 1.
  useEffect(() => {
    const timer = setTimeout(() => load(1, search.trim(), stockFilter), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [search, stockFilter, load]);

  // Local-first mutations (ADR-002): write to SQLite + sync queue on desktop,
  // otherwise the existing HTTP call. Components await these and reload.
  const createProduct = (values: ProductFormValues) => productsRepo.create(values);

  const updateProduct = (id: number, values: Partial<ProductFormValues>) =>
    productsRepo.update(id, values);

  const deleteProduct = (id: number) => productsRepo.remove(id);

  return {
    items,
    total,
    page,
    pageSize: PRODUCTS_PAGE_SIZE,
    search,
    setSearch,
    stockFilter,
    setStockFilter,
    loading,
    error,
    reload: () => load(page, search.trim(), stockFilter),
    goToPage: (p: number) => load(p, search.trim(), stockFilter),
    createProduct,
    updateProduct,
    deleteProduct,
  };
}
