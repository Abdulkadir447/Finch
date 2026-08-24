/**
 * Remote, searchable catalog lookup for the New Order modal (Task 12 / M1).
 *
 * A tenant can have far more than 100 products/customers, so the catalogs are
 * no longer loaded once with a hard cap. Instead each Select loads an initial
 * page and then queries the backend `?search=` endpoint (debounced) as the
 * user types. A persistent `known` map keeps every record ever fetched — so a
 * selected record never loses its label/price/stock when the query changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, useApiClient } from '../../services/api/client';

export interface CatalogProduct {
  id: number;
  sku: string;
  name: string;
  unit_price: number;
  current_stock: number;
}

export interface CatalogCustomer {
  id: number;
  full_name: string;
  email: string;
}

const PAGE_SIZE = 50;

interface CatalogState<T extends { id: number }> {
  /** Results for the current query (the Select dropdown). */
  results: T[];
  /** Persistent, merge-only map of everything fetched so far. */
  known: Map<number, T>;
  loading: boolean;
  error: string | null;
  search: string;
  setSearch: (value: string) => void;
  reload: () => void;
}

function useCatalog<T extends { id: number }>(path: string): CatalogState<T> {
  const api = useApiClient();
  const [results, setResults] = useState<T[]>([]);
  const [known, setKnown] = useState<Map<number, T>>(new Map());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (query: string) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get<{ items: T[] }>(path, {
          params: { limit: PAGE_SIZE, ...(query ? { search: query } : {}) },
        });
        if (seq !== requestSeq.current) return; // stale response, drop it
        setResults(data.items);
        setKnown((prev) => {
          const next = new Map(prev);
          data.items.forEach((item) => next.set(item.id, item));
          return next;
        });
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setError(
          e instanceof ApiError ? e.message : 'Unable to load catalog data.',
        );
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [api, path],
  );

  // Debounced search reload (300 ms).
  useEffect(() => {
    const timer = setTimeout(() => load(search.trim()), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, load]);

  return {
    results,
    known,
    loading,
    error,
    search,
    setSearch,
    reload: () => load(search.trim()),
  };
}

export function useProductCatalog() {
  return useCatalog<CatalogProduct>('/products');
}

export function useCustomerCatalog() {
  return useCatalog<CatalogCustomer>('/customers');
}

/**
 * Dropdown options = current results, plus any records currently selected in a
 * line so their labels render correctly even when they fall outside the
 * current query results.
 */
export function withSelected<T extends { id: number }>(
  results: T[],
  known: Map<number, T>,
  selectedIds: Iterable<number>,
): T[] {
  const out = [...results];
  const seen = new Set(out.map((o) => o.id));
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    const record = known.get(id);
    if (record) {
      out.push(record);
      seen.add(id);
    }
  }
  return out;
}

/** Merge the two catalogs' error state into a single user-facing message. */
export function useCatalogError(
  product: { error: string | null },
  customer: { error: string | null },
): string | null {
  return useMemo(
    () => product.error ?? customer.error ?? null,
    [product.error, customer.error],
  );
}
