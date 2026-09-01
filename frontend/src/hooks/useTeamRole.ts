/**
 * Current user's team role from the cached identity (/auth/me).
 *
 * Client-side mirror of the backend role matrix (TRD Ch17 §17.7:
 * authorization enforced at both client and backend). The backend remains
 * the hard gate; this only hides/read-only's what the backend refuses.
 */
import { useEffect, useState } from 'react';
import { fetchIdentity } from '../repositories/identity';
import { useApiClient } from '../services/api/client';

export function useTeamRole(): string | null {
  const api = useApiClient();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchIdentity(api)
      .then((me) => !cancelled && setRole(me.role))
      .catch(() => !cancelled && setRole('owner'));
    return () => {
      cancelled = true;
    };
  }, [api]);

  return role;
}

/** True when the current user may manage the team (owner only). */
export function useIsTeamOwner(): boolean {
  return useTeamRole() === 'owner';
}
