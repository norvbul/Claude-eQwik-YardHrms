import { Button } from '@yardhrms/ui';
import { Link, Outlet } from 'react-router-dom';
import { useSession } from '@/lib/session';

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="eQwik YardHRMS home">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand font-black text-accent">Q</span>
      <span className={`text-base font-semibold ${dark ? 'text-white' : 'text-slate-900'}`}>
        eQwik YardHRMS<sup className="text-[10px]">™</sup>
      </span>
    </Link>
  );
}

export function PublicLayout() {
  const { me } = useSession();
  // HR-002: after tenant resolution the CTA shows the company name.
  const tenantName = me?.activeTenant?.displayName;
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav className="flex items-center gap-2">
            <Link to="/about" className="hidden px-3 text-sm text-slate-600 hover:text-slate-900 sm:block">
              About
            </Link>
            {me ? (
              <Link to="/app">
                <Button>{tenantName ? `Open ${tenantName}` : 'Open app'}</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost">Sign in</Button>
                </Link>
                <Link to="/register">
                  <Button>Start Free</Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-[#062b1d] text-emerald-100">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3">
          <div>
            <Logo dark />
            <p className="mt-3 text-sm text-emerald-100/70">HR & payroll built for Jamaican businesses.</p>
          </div>
          <div className="text-sm">
            <p className="mb-2 font-semibold text-white">Product</p>
            <ul className="space-y-1">
              <li>
                <Link to="/about" className="hover:text-white">
                  About
                </Link>
              </li>
              <li>
                <Link to="/register" className="hover:text-white">
                  Start Free
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-white">
                  Sign in
                </Link>
              </li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="mb-2 font-semibold text-white">Legal</p>
            <ul className="space-y-1">
              <li>
                <Link to="/licence" className="hover:text-white">
                  Licence
                </Link>
              </li>
              <li>
                <Link to="/disclaimer" className="hover:text-white">
                  Disclaimer
                </Link>
              </li>
              <li>
                <Link to="/copyright" className="hover:text-white">
                  Copyright
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs text-emerald-100/60">© {new Date().getFullYear()} Qwik Business Solutions™. eQwik YardHRMS™ is a product of Qwik Business Solutions™.</div>
      </footer>
    </div>
  );
}

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#062b1d] via-[#0b5d3b] to-[#0e7a4d] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link to="/" className="flex items-center gap-2" aria-label="Home">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-lg font-black text-slate-900">Q</span>
            <span className="text-lg font-semibold text-white">
              eQwik YardHRMS<sup className="text-[10px]">™</sup>
            </span>
          </Link>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-emerald-50">{footer}</div>}
        <p className="mt-6 text-center text-xs text-emerald-100/70">© {new Date().getFullYear()} Qwik Business Solutions™</p>
      </div>
    </div>
  );
}
