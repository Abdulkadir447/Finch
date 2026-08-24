/**
 * Orders data hook — same architecture as Products/Customers (Task 7).
 * Stock deduction, transition rules and rollback live on the server; this
 * hook only transports data through the Clerk-authenticated API client.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, useApiClient } from '../../services/api/client';
import { brand, semantic } from '../../theme';

export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderItem {
  id: number;
  product_id: number;
  product_name: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface Order {
  id: number;
  customer_id: number;
  customer: { full_name: string } | null;
  status: OrderStatus;
  /** Legal next statuses, published by the backend (Task 12 / M4). */
  allowed_transitions: OrderStatus[];
  total_amount: number;
  order_date: string;
  created_at: string;
  items: OrderItem[];
}

export interface OrderListResponse {
  items: Order[];
  total: number;
  page: number;
  limit: number;
}

export interface OrderItemInput {
  product_id: number;
  quantity: number;
  unit_price: number;
}

export interface OrderCreateInput {
  customer_id: number;
  items: OrderItemInput[];
}

export const ORDERS_PAGE_SIZE = 10;

/** Tag colors from the Finch semantic palette. */
export const STATUS_META: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: semantic.warning, bg: semantic.warningBg },
  confirmed: { label: 'Confirmed', color: semantic.info, bg: semantic.infoBg },
  shipped: { label: 'Shipped', color: brand.primary, bg: brand.primarySurface },
  delivered: { label: 'Delivered', color: semantic.success, bg: semantic.successBg },
  cancelled: { label: 'Cancelled', color: semantic.error, bg: semantic.errorBg },
};

export function useOrders() {
  const api = useApiClient();
  const [items, setItems] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(
    async (requestedPage: number, query: string, status: OrderStatus | 'all') => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get<OrderListResponse>('/orders', {
          params: {
            page: requestedPage,
            limit: ORDERS_PAGE_SIZE,
            ...(query ? { search: query } : {}),
            ...(status !== 'all' ? { status } : {}),
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

  // Debounced search/filter changes return to page 1.
  useEffect(() => {
    const timer = setTimeout(
      () => load(1, search.trim(), statusFilter),
      search ? 350 : 0,
    );
    return () => clearTimeout(timer);
  }, [search, statusFilter, load]);

  const createOrder = (input: OrderCreateInput) => api.post<Order>('/orders', input);

  const updateStatus = (id: number, status: OrderStatus) =>
    api.put<Order>(`/orders/${id}/status`, { status });

  const deleteOrder = (id: number) => api.delete(`/orders/${id}`);

  return {
    items,
    total,
    page,
    pageSize: ORDERS_PAGE_SIZE,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    loading,
    error,
    reload: () => load(page, search.trim(), statusFilter),
    goToPage: (p: number) => load(p, search.trim(), statusFilter),
    createOrder,
    updateStatus,
    deleteOrder,
  };
}
