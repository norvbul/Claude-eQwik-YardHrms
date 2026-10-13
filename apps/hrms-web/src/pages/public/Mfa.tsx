import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, Input, Spinner, errorMessage } from '@yardhrms/ui';
import { Building2, ChevronRight, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthCard } from '@/layouts/PublicLayout';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

function CodeForm({ onSubmit, label }: { onSubmit: (code: string) => Promise<void>; label: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await onSubmit(code);
        } catch (x) {
          setErr(errorMessage(x));
          setCode('');
        } finally {
          setBusy(false);
        }
      }}
    >
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="6-digit code" required>
        {(p) => (
          <Input
            {...p}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            className="text-center text-2xl tracking-[0.5em]"
            placeholder="••••••"
          />
        )}
      </Field>
      <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
        {label}
      </Button>
    </form>
  );
}

export function MfaChallenge() {
  const { me, loading, logout } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  if (!me.mfaRequired) return <Navigate to="/app" replace />;
  return (
    <AuthCard title="Two-step verification" subtitle="Enter the code from your authenticator app" footer={<button className="hover:underline" onClick={() => logout()}>Use a different account</button>}>
      <CodeForm
        label="Verify"
        onSubmit={async (code) => {
          await api.post('/auth/mfa/challenge', { code });
          await qc.invalidateQueries({ queryKey: ['me'] });
          const next = params.get('next');
          navigate(next && next.startsWith('/app') ? next : '/app');
        }}
      />
    </AuthCard>
  );
}

/** SEC-006: mandatory enrolment for privileged roles. */
export function MfaSetup() {
  const { me, loading, logout } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!me || me.user.mfaEnabled || started.current) return;
    started.current = true;
    api
      .post<{ qrDataUrl: string; secret: string }>('/auth/mfa/setup')
      .then(setSetup)
      .catch((e) => setErr(errorMessage(e)));
  }, [me]);
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.user.mfaEnabled) return <Navigate to="/app" replace />;
  return (
    <AuthCard title="Set up two-step verification" subtitle="Required for administrators, payroll and finance roles" footer={<button className="hover:underline" onClick={() => logout()}>Sign out</button>}>
      {err && <Alert tone="error">{err}</Alert>}
      {!setup && !err && <Spinner />}
      {setup && (
        <div className="space-y-5">
          <ol className="space-y-2 text-sm text-slate-600">
            <li className="flex gap-2">
              <Smartphone className="h-4 w-4 flex-none text-brand" /> Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).
            </li>
            <li>Scan this QR code, or enter the key manually.</li>
          </ol>
          <div className="flex flex-col items-center gap-2">
            <img src={setup.qrDataUrl} alt="Authenticator QR code" className="h-48 w-48 rounded-lg border border-slate-200" />
            <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{setup.secret}</code>
          </div>
          <CodeForm
            label="Confirm & enable"
            onSubmit={async (code) => {
              await api.post('/auth/mfa/confirm', { code });
              await qc.invalidateQueries({ queryKey: ['me'] });
              navigate('/app');
            }}
          />
        </div>
      )}
    </AuthCard>
  );
}

export function SelectOrganization() {
  const { me, loading } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  const choose = async (tenantId: string) => {
    try {
      await api.post('/auth/switch-tenant', { tenantId });
      qc.clear();
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/app');
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <AuthCard title="Choose an organization" subtitle={me.user.email}>
      {err && <Alert tone="error">{err}</Alert>}
      {me.memberships.length === 0 ? (
        <Alert tone="info">Your account is not an active member of any organization. Ask your administrator for an invitation.</Alert>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {me.memberships.map((m) => (
            <li key={m.tenantId}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" onClick={() => choose(m.tenantId)}>
                <Building2 className="h-5 w-5 text-brand" />
                <span className="flex-1">
                  <span className="block font-medium text-slate-900">{m.tenantName}</span>
                  <span className="block text-xs text-slate-500">{m.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </AuthCard>
  );
}
