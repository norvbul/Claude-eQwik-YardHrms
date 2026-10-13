import type { FeatureCode } from '@yardhrms/authorization';
import { Alert, Button, Spinner, cn, formatDate, initials } from '@yardhrms/ui';
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronLeft,
  Clock,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Receipt,
  ScrollText,
  Settings2,
  ShieldCheck,
  Timer,
  UserCircle2,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { NotificationBell } from '@/components/notifications';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  perms?: string[];
  feature?: FeatureCode;
  show?: boolean;
}

const BrandMark = ({ collapsed }: { collapsed?: boolean }) => (
  <div className="flex items-center gap-2">
    <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent font-black text-slate-900">Q</span>
    {!collapsed && (
      <span className="text-sm font-semibold leading-tight text-white">
        eQwik YardHRMS<sup className="text-[9px]">™</sup>
      </span>
    )}
  </div>
);

export function RequireSession() {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.mfaRequired) return <Navigate to="/mfa" replace />;
  if (me.mfaSetupRequired) return <Navigate to="/mfa/setup" replace />;
  if (!me.activeTenant) return <Navigate to="/select-organization" replace />;
  return <Outlet />;
}

export function AppLayout() {
  const { me, can, canAny, hasFeature, logout } = useSession();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('yh.sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => localStorage.setItem('yh.sidebar', collapsed ? 'collapsed' : 'open'), [collapsed]);
  const tenant = me!.activeTenant!;
  const ent = me!.entitlements;

  const nav: { section: string; items: NavItem[] }[] = [
    {
      section: 'Overview',
      items: [
        { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/app/me', label: 'My Profile', icon: UserCircle2, show: !!tenant.employeeId },
      ],
    },
    {
      section: 'People',
      items: [
        { to: '/app/employees', label: 'Employees', icon: Users, perms: ['employees.read'], feature: 'EMPLOYEES' },
        { to: '/app/leave', label: 'Leave', icon: CalendarDays, feature: 'LEAVE', perms: ['leave.submit.self', 'leave.read.any', 'leave.submit.any'] },
        { to: '/app/timesheets', label: 'Timesheets', icon: Clock, feature: 'TIMESHEETS', perms: ['timesheets.submit.self', 'timesheets.read.any', 'timesheets.submit.any'] },
        { to: '/app/overtime', label: 'Overtime', icon: Timer, feature: 'OVERTIME', perms: ['overtime.submit.self', 'overtime.read.any', 'overtime.submit.any'] },
      ],
    },
    {
      section: 'Payroll',
      items: [
        { to: '/app/payroll/setup', label: 'Payroll Setup', icon: Settings2, feature: 'PAYROLL', perms: ['payroll.config.manage', 'statutory.manage', 'statutory.approve'] },
        { to: '/app/payroll/runs', label: 'Payroll Runs', icon: Gauge, perms: ['payroll.read'] },
        { to: '/app/payslips', label: 'Payslips', icon: Receipt, perms: ['payslips.read.self', 'payslips.print.any'] },
        { to: '/app/reports', label: 'Reports', icon: BarChart3, perms: ['reports.hr', 'reports.payroll'] },
        { to: '/app/imports', label: 'Bulk Imports', icon: FileSpreadsheet, feature: 'BULK_IMPORT', perms: ['imports.manage'] },
      ],
    },
    {
      section: 'Administration',
      items: [
        { to: '/app/users', label: 'Users & Roles', icon: UsersRound, perms: ['users.read'] },
        { to: '/app/settings', label: 'Company Settings', icon: Building2, perms: ['tenant.settings.read', 'masterdata.write'] },
        { to: '/app/subscription', label: 'Subscription', icon: CreditCard, perms: ['subscription.read'] },
        { to: '/app/audit', label: 'Audit Log', icon: ScrollText, feature: 'AUDIT_VIEW', perms: ['audit.read'] },
      ],
    },
  ];

  const visible = (i: NavItem) => (i.show ?? true) && (!i.perms || canAny(...i.perms));
  const sidebar = (isMobile: boolean) => (
    <aside className={cn('flex h-full flex-col bg-[#062b1d] text-emerald-50', isMobile ? 'w-72' : collapsed ? 'w-[72px]' : 'w-64')} aria-label="Main navigation">
      <div className="flex h-16 items-center justify-between px-4">
        <Link to="/app" aria-label="Dashboard">
          <BrandMark collapsed={!isMobile && collapsed} />
        </Link>
        {isMobile && (
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="text-emerald-100">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className={cn('mx-3 mb-3 rounded-lg bg-white/5 px-3 py-2', !isMobile && collapsed && 'hidden')}>
        <p className="text-[11px] uppercase tracking-wide text-emerald-200/70">Company</p>
        <p className="truncate text-sm font-semibold text-white" title={tenant.displayName}>
          {tenant.displayName}
        </p>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {nav.map((s) => {
          const items = s.items.filter(visible);
          if (!items.length) return null;
          return (
            <div key={s.section}>
              {(isMobile || !collapsed) && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-200/60">{s.section}</p>}
              <ul className="space-y-0.5">
                {items.map((i) => {
                  const locked = i.feature && !hasFeature(i.feature);
                  const Icon = i.icon;
                  return (
                    <li key={i.to}>
                      <NavLink
                        to={locked ? '/app/subscription' : i.to}
                        end={i.to === '/app'}
                        title={locked ? `${i.label} — not included in your plan` : i.label}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                            isActive && !locked ? 'bg-white/15 font-medium text-white' : 'text-emerald-100/85 hover:bg-white/10 hover:text-white',
                            locked && 'opacity-60',
                          )
                        }
                      >
                        <Icon className="h-4 w-4 flex-none" />
                        {(isMobile || !collapsed) && <span className="flex-1 truncate">{i.label}</span>}
                        {locked && (isMobile || !collapsed) && <Lock className="h-3.5 w-3.5" aria-label="Upgrade required" />}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className={cn('border-t border-white/10 px-4 py-3 text-[11px] text-emerald-200/70', !isMobile && collapsed && 'hidden')}>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <Link to="/about" className="hover:text-white">
            About
          </Link>
          <Link to="/licence" className="hover:text-white">
            Licence
          </Link>
          <Link to="/disclaimer" className="hover:text-white">
            Disclaimer
          </Link>
          <Link to="/copyright" className="hover:text-white">
            Copyright
          </Link>
        </div>
        <p className="mt-1">© {new Date().getFullYear()} Qwik Business Solutions™</p>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen">
      <div className="no-print sticky top-0 hidden h-screen lg:block">{sidebar(false)}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">{sidebar(true)}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <ChevronLeft className={cn('h-5 w-5 transition-transform', collapsed && 'rotate-180')} />
          </Button>
          <div className="flex min-w-0 items-center gap-3">
            {tenant.logoUrl ? (
              <img src={tenant.logoUrl} alt="" className="h-9 w-9 rounded-lg border border-slate-200 object-contain" />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-sm font-bold text-brand">{initials(tenant.displayName)}</span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{tenant.displayName}</p>
              <p className="truncate text-xs text-slate-500">
                {ent?.planName} plan · {ent?.status.toLowerCase()}
              </p>
            </div>
          </div>
          <div className="ml-auto">
            <NotificationBell />
          </div>
          <div className="relative">
            <button className="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-slate-100" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-white">{initials(me!.user.fullName)}</span>
              <span className="hidden text-sm font-medium text-slate-700 sm:block">{me!.user.fullName}</span>
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-lg" onMouseLeave={() => setMenuOpen(false)}>
                <div className="px-3 py-2 text-xs text-slate-500">
                  <p className="truncate font-medium text-slate-800">{me!.user.email}</p>
                  <p className="mt-0.5">{tenant.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}</p>
                </div>
                {me!.memberships.length > 1 && (
                  <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50" onClick={() => navigate('/select-organization')}>
                    <Building2 className="h-4 w-4" /> Switch organization
                  </button>
                )}
                <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50" onClick={() => navigate('/app/account')}>
                  <KeyRound className="h-4 w-4" /> Account & security
                </button>
                <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50" onClick={() => logout()}>
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          {ent?.readOnly && (
            <div className="mb-5">
              <Alert
                tone="error"
                title={`Subscription ${ent.status.toLowerCase()} — read-only mode`}
                action={
                  can('subscription.read') ? (
                    <Link to="/app/subscription">
                      <Button size="sm" variant="outline">
                        View subscription
                      </Button>
                    </Link>
                  ) : undefined
                }
              >
                You can view and export historical records and payslips. Changes and new payroll are blocked until the subscription is renewed. No data has been deleted.
              </Alert>
            </div>
          )}
          {ent?.status === 'GRACE' && (
            <div className="mb-5">
              <Alert tone="warning" title="Subscription in grace period">
                Your subscription ended {formatDate(ent.periodEnd)}. Renew before {formatDate(ent.graceEnd)} to avoid read-only mode.
              </Alert>
            </div>
          )}
          <Outlet />
        </main>
        <footer className="no-print border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" /> eQwik YardHRMS™ by Qwik Business Solutions™
          </span>
          <span className="mx-2">·</span>
          <FileText className="mr-1 inline h-3.5 w-3.5" />
          <Link to="/disclaimer" className="hover:underline">
            Payroll compliance notice
          </Link>
        </footer>
      </div>
    </div>
  );
}
