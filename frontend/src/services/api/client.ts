/**
 * Co-op API client — the single place for authenticated backend requests.
 *
 * Auth model: the Clerk SESSION token (from `useAuth().getToken()`) is sent
 * as `Authorization: Bearer <token>`; the backend verifies it against
 * Clerk's public JWKS. No Clerk secret key ever exists in the frontend.
 *
 * Base URL: defaults to the relative `/api`, which the Vite dev server
 * proxies to the FastAPI backend (this is what makes embedded previews
 * work). Production / Electron builds can override via VITE_API_URL
 * (e.g. `http://localhost:8000`).
 */
import axios, { AxiosError, AxiosInstance } from 'axios';
import { useMemo } from 'react';
import { useAuth } from '@clerk/react';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export function createApiClient(
  getToken: () => Promise<string | null>,
): AxiosInstance {
  const client = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
    timeout: 30_000,
  });

  // Attach the Clerk session token to every request.
  client.interceptors.request.use(async (config) => {
    const token = await getToken();
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  // Centralized error normalization — callers only ever see ApiError.
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError<{ detail?: string | { message?: string } }>) => {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      // A 401 means the Clerk session token was rejected (expired / revoked).
      // Notify the session guard so it can sign the user out and route them
      // to /sign-in. The guard de-duplicates, so repeated 401s are harmless.
      if (status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('coop:unauthorized'));
      }
      // Some endpoints (e.g. 402 insufficient credits) return a structured
      // detail object — surface its human message.
      const detailMessage =
        typeof detail === 'string'
          ? detail
          : detail && typeof detail === 'object' && typeof detail.message === 'string'
            ? detail.message
            : undefined;
      const message =
        detailMessage ||
        (status === 401
          ? 'Your session needs to be refreshed — please sign in again.'
          : error.code === 'ECONNABORTED'
            ? 'The request timed out.'
            : error.message || 'Request failed');
      return Promise.reject(new ApiError(message, status));
    },
  );

  return client;
}

/**
 * Hook: memoized, Clerk-authenticated API client.
 *
 *   const api = useApiClient();
 *   const { data } = await api.get('/dashboard/summary');
 */
export function useApiClient(): AxiosInstance {
  const { getToken } = useAuth();
  return useMemo(() => createApiClient(getToken), [getToken]);
}
