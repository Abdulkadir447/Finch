/**
 * Orders data hook — same architecture as Products/Customers (Task 7).
 * Stock deduction, transition rules and rollback live on the server; this
 * hook only transports data through the Clerk-authenticated API client.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, useApiClient } from '../../services/api/client';

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

/** Status labels (display chrome lives in the page's CoopBadge variants). */
export const STATUS_META: Record<OrderStatus, { label: string }> = {
  pending: { label: 'Pending' },
  confirmed: { label: 'Confirmed' },
  shipped: { label: 'Shipped' },
  delivered: { label: 'Delivered' },
  cancelled: { label: 'Cancelled' },
};

export function useOrders() {
  const api = useApiClient();
  const [items, setItems] = useState<Order[]>([]);
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
