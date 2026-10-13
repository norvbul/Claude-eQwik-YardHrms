import { useQueryClient } from '@tanstack/react-query';
import { forgotPasswordSchema, loginSchema, passwordSchema, registerSchema, resetPasswordSchema } from '@yardhrms/types';
import { Alert, ApiError, Button, Checkbox, Field, Input, Spinner, errorMessage, useToast } from '@yardhrms/ui';
import { Building2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { AuthCard } from '@/layouts/PublicLayout';
import { api } from '@/lib/api';
import { applyServerErrors, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';

export function Login() {
  const form = useZodForm<z.input<typeof loginSchema>>(loginSchema);
  const [error, setError] = useState<ApiError | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me } = useSession();
  if (me?.activeTenant && !me.mfaRequired) return <Navigate to="/app" replace />;
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await api.post<{ mfaRequired: boolean }>('/auth/login', v);
      await qc.invalidateQueries({ queryKey: ['me'] });
      const next = params.get('next');
      navigate(r.mfaRequired ? `/mfa${next ? `?next=${encodeURIComponent(next)}` : ''}` : next && next.startsWith('/app') ? next : '/app');
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', errorMessage(e)));
    }
  });
  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back to eQwik YardHRMS"
      footer={
        <>
          New company?{' '}
          <Link to="/register" className="font-semibold text-accent hover:underline">
            Start Free
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <Alert tone="error">
            {error.message}
            {error.details?.reason === 'EMAIL_NOT_VERIFIED' && (
              <ResendVerification email={form.getValues('email')} />
            )}
          </Alert>
        )}
        <Field label="Email" error={form.formState.errors.email?.message} required>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register('password')} />}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

function ResendVerification({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  return sent ? (
    <p className="mt-1">If the address needs verification, a new link has been sent.</p>
  ) : (
    <button
      type="button"
      className="mt-1 block font-medium underline"
      onClick={async () => {
        await api.post('/auth/resend-verification', { email }).catch(() => undefined);
        setSent(true);
      }}
    >
      Resend verification email
    </button>
  );
}

export function Register() {
  const form = useZodForm<z.input<typeof registerSchema>>(registerSchema, { defaultValues: { acceptTerms: false as any } });
  const [done, setDone] = useState<string | null>(null);
  const toast = useToast();
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/register', v);
      setDone(v.email);
    } catch (e) {
      if (!applyServerErrors(form, e)) toast.error('Registration failed', errorMessage(e));
    }
  });
  if (done)
    return (
      <AuthCard title="Check your email" subtitle="One more step to activate your company workspace">
        <div className="flex gap-3 text-sm text-slate-600">
          <CheckCircle2 className="h-6 w-6 flex-none text-emerald-600" />
          <p>
            We sent a verification link to <strong>{done}</strong>. Open it to activate your account, then sign in. Your company starts on the <strong>Free plan</strong> (up to 5 employees and 2 users).
          </p>
        </div>
        <Link to="/login">
          <Button className="mt-6 w-full">Go to sign in</Button>
        </Link>
      </AuthCard>
    );
  const e = form.formState.errors;
  return (
    <AuthCard title="Start Free" subtitle="Create your company workspace — no payment or code required" footer={<>Already registered? <Link to="/login" className="font-semibold text-accent hover:underline">Sign in</Link></>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Building2 className="h-4 w-4 text-brand" /> Company
        </div>
        <Field label="Registered (legal) name" error={e.companyLegalName?.message} required>
          {(p) => <Input {...p} {...form.register('companyLegalName')} placeholder="e.g. Blue Mountain Traders Limited" />}
        </Field>
        <Field label="Display name" hint="Shown in the app header, payslips and reports" error={e.companyDisplayName?.message} required>
          {(p) => <Input {...p} {...form.register('companyDisplayName')} placeholder="e.g. Blue Mountain Traders" />}
        </Field>
        <div className="flex items-center gap-2 pt-2 text-sm font-medium text-slate-700">
          <ShieldCheck className="h-4 w-4 text-brand" /> Administrator
        </div>
        <Field label="Your full name" error={e.fullName?.message} required>
          {(p) => <Input {...p} autoComplete="name" {...form.register('fullName')} />}
        </Field>
        <Field label="Work email" error={e.email?.message} required>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
        </Field>
        <Field label="Password" hint="At least 12 characters with upper- and lower-case letters and a number" error={e.password?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
        </Field>
        <div>
          <Checkbox
            label={
              <span>
                I accept the{' '}
                <Link to="/terms" target="_blank" className="text-brand underline">
                  Terms of Service
                </Link>
                , have read the{' '}
                <Link to="/privacy" target="_blank" className="text-brand underline">
                  Privacy Notice
                </Link>{' '}
                and the{' '}
                <Link to="/disclaimer" target="_blank" className="text-brand underline">
                  payroll disclaimer
                </Link>
              </span>
            }
            {...form.register('acceptTerms')}
          />
          {e.acceptTerms && <p className="mt-1 text-xs text-red-600">{e.acceptTerms.message}</p>}
        </div>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create company workspace
        </Button>
      </form>
    </AuthCard>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [msg, setMsg] = useState('');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke guard: tokens are single-use
    ran.current = true;
    api
      .post('/auth/verify-email', { token: params.get('token') ?? '' })
      .then(() => setState('ok'))
      .catch((e) => {
        setMsg(errorMessage(e));
        setState('error');
      });
  }, [params]);
  return (
    <AuthCard title="Email verification">
      {state === 'pending' && <Spinner label="Verifying" />}
      {state === 'ok' && <Alert tone="success" title="Email verified">Your account is active. You can now sign in.</Alert>}
      {state === 'error' && <Alert tone="error" title="Verification failed">{msg}</Alert>}
      {state !== 'pending' && (
        <Link to="/login">
          <Button className="mt-6 w-full">Continue to sign in</Button>
        </Link>
      )}
    </AuthCard>
  );
}

export function ForgotPassword() {
  const form = useZodForm<z.input<typeof forgotPasswordSchema>>(forgotPasswordSchema);
  const [sent, setSent] = useState(false);
  const onSubmit = form.handleSubmit(async (v) => {
    await api.post('/auth/forgot-password', v).catch(() => undefined);
    setSent(true);
  });
  return (
    <AuthCard title="Reset your password" subtitle="We’ll email you a reset link" footer={<Link to="/login" className="hover:underline">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success">If an account exists for that email, a reset link is on its way. It expires in 1 hour.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" error={form.formState.errors.email?.message} required>
            {(p) => <Input {...p} type="email" {...form.register('email')} />}
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

const resetForm = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ResetPassword() {
  const [params] = useSearchParams();
  const form = useZodForm<z.input<typeof resetForm>>(resetForm);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onSubmit = form.handleSubmit(async (v) => {
    setErr(null);
    try {
      resetPasswordSchema.parse({ token: params.get('token') ?? '', password: v.password });
      await api.post('/auth/reset-password', { token: params.get('token'), password: v.password });
      setDone(true);
    } catch (e) {
      setErr(errorMessage(e));
    }
  });
  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <>
          <Alert tone="success">Password changed. All existing sessions were signed out.</Alert>
          <Link to="/login">
            <Button className="mt-6 w-full">Sign in</Button>
          </Link>
        </>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {err && <Alert tone="error">{err}</Alert>}
          <Field label="New password" error={form.formState.errors.password?.message} required>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
          </Field>
          <Field label="Confirm password" error={form.formState.errors.confirm?.message} required>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('confirm')} />}
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [info, setInfo] = useState<{ email: string; fullName: string; tenantName: string; needsPassword: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const schema = z.object({ fullName: z.string().trim().min(2), password: info?.needsPassword ? passwordSchema : z.string().optional() });
  const form = useZodForm<{ fullName: string; password?: string }>(schema);
  useEffect(() => {
    api
      .get<typeof info>(`/auth/invitations/preview`, { token })
      .then((d) => {
        setInfo(d);
        form.reset({ fullName: d!.fullName, password: '' });
      })
      .catch((e) => setErr(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/invitations/accept', { token, fullName: v.fullName, password: info?.needsPassword ? v.password : undefined });
      setDone(true);
    } catch (e) {
      setErr(errorMessage(e));
    }
  });
  return (
    <AuthCard title="Accept invitation" subtitle={info ? `Join ${info.tenantName} on eQwik YardHRMS` : undefined}>
      {err && <Alert tone="error">{err}</Alert>}
      {!info && !err && <Spinner />}
      {done ? (
        <>
          <Alert tone="success">You’re in! Sign in with {info?.email}.</Alert>
          <Link to="/login">
            <Button className="mt-6 w-full">Sign in</Button>
          </Link>
        </>
      ) : (
        info && (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Email">{(p) => <Input {...p} value={info.email} disabled />}</Field>
            <Field label="Full name" error={form.formState.errors.fullName?.message} required>
              {(p) => <Input {...p} {...form.register('fullName')} />}
            </Field>
            {info.needsPassword && (
              <Field label="Choose a password" hint="At least 12 characters with upper/lower-case letters and a number" error={form.formState.errors.password?.message} required>
                {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
              </Field>
            )}
            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
              Accept & activate
            </Button>
          </form>
        )
      )}
    </AuthCard>
  );
}
