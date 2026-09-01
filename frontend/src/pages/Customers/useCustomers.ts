/**
 * Customers data hook — same architecture as Products (Task 6):
 * list/search/paginate + create/update/soft-delete through the
 * Clerk-authenticated API client. No data is ever invented.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, useApiClient } from '../../services/api/client';
import { makeCustomerRepo, localBusinessIdLocal, isLocalModeActive, useLocalModeActivated } from '../../repositories';
import { getLocalDb } from '../../sync/localDb';

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

  /** Local read path (OFFLINE 3): SQLite mirror, server list semantics
   *  (search: name/email/company; id desc; same page envelope). */
  const loadLocal = useCallback(
    async (requestedPage: number, query: string) => {
      const biz = await localBusinessIdLocal();
      const db = getLocalDb();
      if (!db) throw new ApiError('Local data layer unavailable.');
      const rows = await db.customerList({ business_id: biz, opts: { limit: 10000 } });
      const mapped: Customer[] = rows.map((r) => ({
        id: Number(r.id),
        full_name: String(r.full_name ?? ''),
        email: String(r.email ?? ''),
        phone: (r.phone as string | null) ?? null,
        address: (r.address as string | null) ?? null,
        company: (r.company as string | null) ?? null,
        created_at: String(r.created_at ?? r.updated_at ?? ''),
        updated_at: (r.updated_at as string | null) ?? null,
      }));
      let list = mapped;
      const q = query.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (c) =>
            c.full_name.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q) ||
            (c.company ?? '').toLowerCase().includes(q),
        );
      }
      list = [...list].sort((a, b) => b.id - a.id);
      setTotal(list.length);
      const start = (requestedPage - 1) * CUSTOMERS_PAGE_SIZE;
      setItems(list.slice(start, start + CUSTOMERS_PAGE_SIZE));
      setPage(requestedPage);
    },
    [],
  );

  const load = useCallback(
    async (requestedPage: number, query: string) => {
      setLoading(true);
      setError(null);
      try {
        if (isLocalModeActive()) {
          await loadLocal(requestedPage, query);
          return;
        }
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
    [api, loadLocal],
  );

  // Debounced search always returns to page 1.
  useEffect(() => {
    const timer = setTimeout(() => load(1, search.trim()), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [search, load]);

  // The mirror became ready (initial pull): reload from the local mirror.
  useLocalModeActivated(() => {
    void load(page, search.trim());
  });

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
