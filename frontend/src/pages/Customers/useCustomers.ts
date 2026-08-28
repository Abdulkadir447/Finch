/**
 * Customers data hook — same architecture as Products (Task 6):
 * list/search/paginate + create/update/soft-delete through the
 * Clerk-authenticated API client. No data is ever invented.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, useApiClient } from '../../services/api/client';
import { makeCustomerRepo } from '../../repositories';

export interface Customer {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  company: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CustomerListResponse {
  items: Customer[];
  total: number;
  page: number;
  limit: number;
}

export interface CustomerFormValues {
  full_name: string;
  email: string;
  phone?: string;
  company?: string;
  address?: string;
}

export const CUSTOMERS_PAGE_SIZE = 10;

export function useCustomers() {
  const api = useApiClient();
  // OFFLINE 2: mutations go through the repository (local-first on desktop,
  // unchanged HTTP in a browser). Reads stay server-backed until pull exists.
  const customersRepo = makeCustomerRepo(api);
  const [items, setItems] = useState<Customer[]>([]);
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(
    async (requestedPage: number, query: string) => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get<CustomerListResponse>('/customers', {
          params: {
            page: requestedPage,
            limit: CUSTOMERS_PAGE_SIZE,
            ...(query ? { search: query } : {}),
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
    const timer = setTimeout(() => load(1, search.trim()), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [search, load]);

  // Local-first mutations (ADR-002): write to SQLite + sync queue on desktop,
  // otherwise the existing HTTP call. Components await these and reload.
  const createCustomer = (values: CustomerFormValues) => customersRepo.create(values);

  const updateCustomer = (id: number, values: Partial<CustomerFormValues>) =>
    customersRepo.update(id, values);

  const deleteCustomer = (id: number) => customersRepo.remove(id);

  return {
    items,
    total,
    page,
    pageSize: CUSTOMERS_PAGE_SIZE,
    search,
    setSearch,
    loading,
    error,
    reload: () => load(page, search.trim()),
    goToPage: (p: number) => load(p, search.trim()),
    createCustomer,
    updateCustomer,
    deleteCustomer,
  };
}
