import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeatureCode, TenantPermission } from '@yardhrms/authorization';
import type { MeResponse } from '@yardhrms/types';
import { ApiError } from '@yardhrms/ui';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, setCsrf } from './api';

interface SessionValue {
  me: MeResponse | null;
  loading: boolean;
  /** Server-side enforcement is authoritative; these helpers only drive navigation and UI affordances. */
  can: (perm: TenantPermission | string) => boolean;
  canAny: (...perms: string[]) => boolean;
  hasFeature: (f: FeatureCode) => boolean;
  readOnly: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

function hexToRgbTriplet(hex: string): string | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api.get<MeResponse>('/auth/me');
        setCsrf(me.csrfToken); // synchronously, before any child effect issues a write
        return me;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const me = q.data ?? null;

  useEffect(() => {
    setCsrf(me?.csrfToken ?? null);
  }, [me?.csrfToken]);

  // HR-002/HR-005: tenant branding (name in title, accent colour) from the tenant record.
  useEffect(() => {
    const t = me?.activeTenant;
    document.title = t ? `${t.displayName} · eQwik YardHRMS™` : 'eQwik YardHRMS™';
    const rgb = t?.accentColor ? hexToRgbTriplet(t.accentColor) : null;
    document.documentElement.style.setProperty('--brand', rgb ?? '11 93 59');
  }, [me?.activeTenant]);

  const perms = useMemo(() => new Set(me?.activeTenant?.permissions ?? []), [me]);
  const features = useMemo(() => new Set(me?.entitlements?.features ?? []), [me]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setCsrf(null);
      qc.clear();
      window.location.assign('/login');
    }
  }, [qc]);

  const value: SessionValue = {
    me,
    loading: q.isLoading,
    can: (p) => perms.has(p),
    canAny: (...ps) => ps.some((p) => perms.has(p)),
    hasFeature: (f) => features.has(f),
    readOnly: !!me?.entitlements?.readOnly,
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    logout,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
