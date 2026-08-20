/**
 * Products data hook — list/search/paginate + create/update/soft-delete,
 * all through the Clerk-authenticated API client. No data is ever invented:
 * an empty tenant produces an honest empty envelope.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, useApiClient } from '../../services/api/client';

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

export function useProducts() {
  const api = useApiClient();
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(
    async (requestedPage: number, query: string) => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get<ProductListResponse>('/products', {
          params: {
            page: requestedPage,
            limit: PRODUCTS_PAGE_SIZE,
            ...(query ? { search: query } : {}),
          },
        });
        setItems(data.items);
        setTotal(data.total);
        setPage(data.page);
      } catch (e) {
        setError(
          e instanceof ApiError ? e : new ApiError('Unable to reach the Finch API.'),
        );
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  // Debounced search always returns to page 1.
  useEffect(() => {
    const timer = setTimeout(() => load(1, search.trim()), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [search, load]);

  const createProduct = (values: ProductFormValues) =>
    api.post<Product>('/products', values);

  const updateProduct = (id: number, values: Partial<ProductFormValues>) =>
    api.put<Product>(`/products/${id}`, values);

  const deleteProduct = (id: number) => api.delete(`/products/${id}`);

  return {
    items,
    total,
    page,
    pageSize: PRODUCTS_PAGE_SIZE,
    search,
    setSearch,
    loading,
    error,
    reload: () => load(page, search.trim()),
    goToPage: (p: number) => load(p, search.trim()),
    createProduct,
    updateProduct,
    deleteProduct,
  };
}
