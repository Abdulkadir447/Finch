/**
 * Co-op repositories — tenant identity + local business bootstrap.
 *
 * Local-first writes need the current tenant's LOCAL business id (the row in
 * the desktop SQLite db). We derive it from the server identity (/auth/me):
 * one local business row per server business, keyed by a stable client_id
 * (the server business id as a string). Both the identity and the resolved
 * local id are cached so N repositories share one fetch and one bootstrap.
 *
 * Auth itself is on the "requires internet" side of the ADR boundary, so it
 * is correct to resolve identity from /auth/me; the cache keeps repeat
 * resolution free.
 */
import type { AxiosInstance } from 'axios';
import { getLocalDb } from '../sync/localDb';

export interface BusinessIdentity {
  user_id: string;
  business_id: number;
  business_name: string;
  currency: string;
}

let cachedIdentity: BusinessIdentity | null = null;
let inflight: Promise<BusinessIdentity> | null = null;
let cachedLocalBizId: number | null = null;

/** Fetch (and cache) the signed-in tenant's identity. */
export function fetchIdentity(api: AxiosInstance): Promise<BusinessIdentity> {
  if (cachedIdentity) return Promise.resolve(cachedIdentity);
  if (!inflight) {
    inflight = api
      .get<BusinessIdentity>('/auth/me')
      .then((r) => {
        cachedIdentity = r.data;
        inflight = null;
        return r.data;
      })
      .catch((e) => {
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

/**
 * Resolve (and cache) the LOCAL business id for the current tenant, ensuring
 * the local business row exists. Throws when no local db is present (callers
 * check isLocalAvailable() first).
 */
export async function localBusinessId(api: AxiosInstance): Promise<number> {
  if (cachedLocalBizId != null) return cachedLocalBizId;
  const identity = await fetchIdentity(api);
  const db = getLocalDb();
  if (!db) throw new Error('Local data layer unavailable');
  const row = await db.businessEnsure({
    client_id: String(identity.business_id),
    name: identity.business_name,
    currency: identity.currency,
  });
  cachedLocalBizId = row.id;
  return cachedLocalBizId;
}

/** Test/teardown helper: clear the module-level caches. */
export function _resetIdentityCacheForTests() {
  cachedIdentity = null;
  inflight = null;
  cachedLocalBizId = null;
}
