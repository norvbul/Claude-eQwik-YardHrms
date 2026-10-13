import { Button, Spinner, cn, initials } from '@yardhrms/ui';
import { Activity, BadgeCheck, Building2, CalendarClock, CreditCard, FileKey2, Gauge, KeyRound, Layers, LogOut, Menu, Package, ScrollText, Settings, X, ShieldOff } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from './lib/session';

interface Item {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  perm?: string;
}

const NAV: Item[] = [
  { to: '/', label: 'Dashboard', icon: Gauge, perm: 'platform.dashboard.read' },
  { to: '/customers', label: 'Customers', icon: Building2, perm: 'platform.customers.read' },
  { to: '/products', label: 'Products', icon: Package, perm: 'platform.customers.read' },
  { to: '/plans', label: 'Plans & Features', icon: Layers, perm: 'platform.customers.read' },
  { to: '/payments', label: 'Manual Payments', icon: CreditCard, perm: 'platform.payments.read' },
  { to: '/subscriptions', label: 'Subscriptions', icon: BadgeCheck, perm: 'platform.subscriptions.read' },
  { to: '/licences', label: 'Licences', icon: FileKey2, perm: 'platform.subscriptions.read' },
  { to: '/codes', label: 'Authorization Codes', icon: KeyRound, perm: 'platform.subscriptions.read' },
  { to: '/renewals', label: 'Renewals / Expirations', icon: CalendarClock, perm: 'platform.subscriptions.read' },
  { to: '/usage', label: 'Usage Monitoring', icon: Activity, perm: 'platform.usage.read' },
  { to: '/audit', label: 'Platform Audit', icon: ScrollText, perm: 'platform.audit.read' },
  { to: '/data-requests', label: 'Closures & Legal Holds', icon: ShieldOff, perm: 'platform.tenants.lifecycle' },
  { to: '/settings', label: 'Settings', icon: Settings, perm: 'platform.dashboard.read' },
];

export function RequirePlatform() {
  const { me, loading, mfaPending } = useSession();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (mfaPending) return <Navigate to="/mfa" replace />;
  return <Outlet />;
}

export function Layout() {
  const { me, can, logout } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const side = (
    <aside className="flex h-full w-64 flex-col bg-[#1e1b4b] text-indigo-100" aria-label="Licence manager navigation">
      <div className="flex h-16 items-center gap-2 px-5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-black text-[#1e1b4b]">Q</span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">Qwik Licence Manager</p>
          <p className="text-[10px] uppercase tracking-wider text-indigo-300">Platform · Staff only</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV.filter((i) => !i.perm || can(i.perm)).map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-white/15 font-medium text-white' : 'text-indigo-100/80 hover:bg-white/10 hover:text-white')}
          >
            <i.icon className="h-4 w-4" />
            {i.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4 text-xs text-indigo-300">
        Manual payment verification only — no payment gateway.
        <p className="mt-1">© {new Date().getFullYear()} Qwik Business Solutions™</p>
      </div>
    </aside>
  );
  return (
    <div className="flex min-h-screen">
      <div className="sticky top-0 hidden h-screen lg:block">{side}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0">
            {side}
            <button className="absolute right-3 top-4 text-white" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b-4 border-accent bg-white px-4 sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <Link to="/" className="text-sm font-semibold text-brand">
            Qwik Business Solutions™ — Licence & Subscription Manager
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{me!.user.fullName}</p>
              <p className="text-xs text-slate-500">{me!.platformRole.replace('PLATFORM_', '').replace(/_/g, ' ').toLowerCase()}</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-xs font-semibold text-white">{initials(me!.user.fullName)}</span>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => logout()}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
