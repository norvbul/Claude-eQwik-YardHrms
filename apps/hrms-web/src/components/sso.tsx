import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, CardBody, CardHeader, Spinner, errorMessage, formatDateTime, useToast } from '@yardhrms/ui';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';

type Provider = { id: 'google' | 'microsoft'; name: string };

const SSO_ERRORS: Record<string, string> = {
  no_account: 'No eQwik YardHRMS account uses that email. Ask your administrator for an invitation, or register your company.',
  email_not_verified: 'Your Google account’s email address is not verified.',
  link_required: 'Sign in with your password first, then link your Microsoft account under Account & security.',
  identity_in_use: 'That account is already linked to a different eQwik YardHRMS user.',
  account_disabled: 'Your account is disabled.',
  no_organization: 'Your account is not an active member of any organization.',
  directory_not_allowed: 'Your Microsoft directory is not allowed to sign in here.',
  cancelled: 'Sign-in was cancelled.',
  session_expired: 'The sign-in took too long. Please try again.',
  invalid_state: 'The sign-in could not be verified. Please try again.',
  invalid_token: 'The sign-in could not be verified. Please try again.',
};
export const ssoErrorMessage = (code: string | null) => (code ? (SSO_ERRORS[code] ?? 'Single sign-on failed. Please try again or use your password.') : null);

function Logo({ id }: { id: Provider['id'] }) {
  return id === 'google' ? (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  ) : (
    <svg viewBox="0 0 23 23" className="h-4 w-4" aria-hidden="true">
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}

/** "Continue with Google / Microsoft" — shown only for providers the operator has configured. */
export function SsoButtons({ next }: { next?: string | null }) {
  const q = useQuery({ queryKey: ['sso-providers'], queryFn: () => api.get<Provider[]>('/auth/sso/providers'), staleTime: 300_000 });
  if (!q.data?.length) return null;
  const n = next && next.startsWith('/app') ? `?next=${encodeURIComponent(next)}` : '';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
      </div>
      {q.data.map((p) => (
        <a key={p.id} href={`/api/v1/auth/sso/${p.id}/start${n}`} className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <Logo id={p.id} /> Continue with {p.name}
        </a>
      ))}
    </div>
  );
}

/** Landing route after a successful provider callback: refresh the session and continue. */
export function SsoComplete() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    const next = params.get('next');
    qc.invalidateQueries({ queryKey: ['me'] }).then(() => navigate(next && next.startsWith('/app') ? next : '/app', { replace: true }));
  }, [params, navigate, qc]);
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner />
    </div>
  );
}

/** Account page: linked Google/Microsoft sign-ins. */
export function LinkedSignIns() {
  const providers = useQuery({ queryKey: ['sso-providers'], queryFn: () => api.get<Provider[]>('/auth/sso/providers'), staleTime: 300_000 });
  const ids = useQuery({ queryKey: ['sso-identities'], queryFn: () => api.get<{ id: string; provider: string; email: string; createdAt: string; lastUsedAt: string | null }[]>('/auth/sso/identities') });
  const [params] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  if (!providers.data?.length) return null;
  const err = ssoErrorMessage(params.get('sso_error'));
  return (
    <Card>
      <CardHeader title="Single sign-on" description="Sign in with your organization’s Google or Microsoft account. Multi-factor authentication still applies to privileged roles." />
      <CardBody className="space-y-3">
        {params.get('sso_linked') && <Alert tone="success">Your {params.get('sso_linked')} account is now linked.</Alert>}
        {err && <Alert tone="error">{err}</Alert>}
        {ids.data?.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <Logo id={i.provider as Provider['id']} /> {i.email}
              <span className="text-xs text-slate-400">{i.lastUsedAt ? `last used ${formatDateTime(i.lastUsedAt)}` : 'not used yet'}</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  await api.del(`/auth/sso/identities/${i.id}`);
                  await qc.invalidateQueries({ queryKey: ['sso-identities'] });
                } catch (e) {
                  toast.error('Could not remove', errorMessage(e));
                }
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {providers.data
            .filter((p) => !ids.data?.some((i) => i.provider === p.id))
            .map((p) => (
              <Button
                key={p.id}
                variant="outline"
                icon={<Logo id={p.id} />}
                onClick={async () => {
                  try {
                    const r = await api.post<{ url: string }>(`/auth/sso/${p.id}/link`);
                    window.location.assign(r.url);
                  } catch (e) {
                    toast.error('Could not start linking', errorMessage(e));
                  }
                }}
              >
                Link {p.name}
              </Button>
            ))}
        </div>
      </CardBody>
    </Card>
  );
}
