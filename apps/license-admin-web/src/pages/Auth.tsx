import { useQueryClient } from '@tanstack/react-query';
import { loginSchema, passwordSchema } from '@yardhrms/types';
import { Alert, Button, Field, Input, Spinner, errorMessage } from '@yardhrms/ui';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#1e1b4b] px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-xl font-black text-[#1e1b4b]">Q</span>
          <p className="text-lg font-semibold">Qwik Licence & Subscription Manager</p>
          <p className="text-xs uppercase tracking-widest text-indigo-200">Authorized Qwik Business Solutions staff only</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const form = useZodForm<z.input<typeof loginSchema>>(loginSchema);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { me, mfaPending } = useSession();
  if (me && !mfaPending) return <Navigate to="/" replace />;
  const submit = form.handleSubmit(async (v) => {
    setErr(null);
    try {
      await api.post('/platform/auth/login', v);
      await qc.invalidateQueries({ queryKey: ['platform-me'] });
      navigate(`/mfa${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`);
    } catch (e) {
      setErr(errorMessage(e));
    }
  });
  return (
    <Shell title="Staff sign in">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Email" error={form.formState.errors.email?.message} required>
          {(p) => <Input {...p} type="email" autoComplete="username" {...form.register('email')} />}
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register('password')} />}
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Continue
        </Button>
        <p className="text-center text-xs text-slate-500">Multi-factor authentication is mandatory for all platform staff.</p>
      </form>
    </Shell>
  );
}

export function Mfa() {
  const { me, loading, refresh, logout } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const started = useRef(false);
  const needsSetup = !!me?.mfaSetupRequired;
  useEffect(() => {
    if (!needsSetup || started.current) return;
    started.current = true;
    api.post<{ qrDataUrl: string; secret: string }>('/platform/auth/mfa/setup').then(setSetup).catch((e) => setErr(errorMessage(e)));
  }, [needsSetup]);
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.mfaVerified && !me.mfaSetupRequired) return <Navigate to="/" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await api.post(needsSetup ? '/platform/auth/mfa/confirm' : '/platform/auth/mfa/challenge', { code });
      await refresh();
      const next = params.get('next');
      navigate(next && next.startsWith('/') ? next : '/');
    } catch (x) {
      setErr(errorMessage(x));
      setCode('');
    }
  };
  return (
    <Shell title={needsSetup ? 'Enrol multi-factor authentication' : 'Two-step verification'} subtitle={me.user.email}>
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        {needsSetup && setup && (
          <div className="flex flex-col items-center gap-2">
            <img src={setup.qrDataUrl} alt="Authenticator QR code" className="h-44 w-44 rounded-lg border" />
            <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{setup.secret}</code>
          </div>
        )}
        <Field label="Authenticator code" required>
          {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus className="text-center text-2xl tracking-[0.5em]" />}
        </Field>
        <Button type="submit" className="w-full" disabled={code.length !== 6} icon={<ShieldCheck className="h-4 w-4" />}>
          {needsSetup ? 'Enable & continue' : 'Verify'}
        </Button>
        <button type="button" className="w-full text-center text-sm text-slate-500 hover:underline" onClick={() => logout()}>
          Sign out
        </button>
      </form>
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [pw, setPw] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Shell title="Set your password">
      {done ? (
        <>
          <Alert tone="success">Password set. Sign in and enrol MFA.</Alert>
          <Link to="/login">
            <Button className="mt-4 w-full">Sign in</Button>
          </Link>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            const parsed = passwordSchema.safeParse(pw);
            if (!parsed.success) return setErr(parsed.error.issues[0].message);
            try {
              await api.post('/platform/auth/reset-password', { token: params.get('token'), password: pw });
              setDone(true);
            } catch (x) {
              setErr(errorMessage(x));
            }
          }}
        >
          {err && <Alert tone="error">{err}</Alert>}
          <Field label="New password" hint="At least 12 characters with upper/lower-case and a number" required>
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
          </Field>
          <Button type="submit" className="w-full">
            Save password
          </Button>
        </form>
      )}
    </Shell>
  );
}
