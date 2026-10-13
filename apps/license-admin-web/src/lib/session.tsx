import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformMeResponse } from '@yardhrms/types';
import { ApiError } from '@yardhrms/ui';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { api, setCsrf } from './api';

interface Session {
  me: PlatformMeResponse | null;
  loading: boolean;
  mfaPending: boolean;
  can: (p: string) => boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

/** Platform (Qwik staff) session — separate cookie, separate authentication, MFA always required. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['platform-me'],
    queryFn: async () => {
      try {
        const me = await api.get<PlatformMeResponse>('/platform/auth/me');
        setCsrf(me.csrfToken); // synchronously, before any child effect issues a write
        return me;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
  const me = q.data ?? null;
  useEffect(() => setCsrf(me?.csrfToken ?? null), [me?.csrfToken]);
  const logout = useCallback(async () => {
    try {
      await api.post('/platform/auth/logout');
    } finally {
      setCsrf(null);
      qc.clear();
      window.location.assign('/login');
    }
  }, [qc]);
  const perms = new Set(me?.permissions ?? []);
  return (
    <Ctx.Provider
      value={{
        me,
        loading: q.isLoading,
        mfaPending: !!me && (!me.mfaVerified || me.mfaSetupRequired),
        can: (p) => perms.has(p),
        refresh: () => qc.invalidateQueries({ queryKey: ['platform-me'] }),
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside provider');
  return c;
}
