import { Alert, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, StatCard, StatusBadge, Tabs, formatDate, formatMoney, formatNumber } from '@yardhrms/ui';
import { CalendarClock, ClipboardCheck, Clock, Gauge, Receipt, Timer, UserCheck, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DownloadButton } from '@/components/common';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

const COLORS = ['#0b5d3b', '#f2b705', '#0ea5e9', '#8b5cf6', '#f43f5e', '#14b8a6', '#64748b'];

interface HrDash {
  scope: 'org' | 'self';
  subscription: { planName: string; status: string; activeEmployees: number; employeeLimit: number; activeUsers: number; userLimit: number };
  mine: null | {
    leaveBalances: { leaveTypeName: string; balance: string; available: string; pending: string }[];
    pendingLeave: number;
    pendingTimesheets: number;
    pendingOvertime: number;
    latestPayslip: null | { id: string; payDate: string; runEmployee: { netPay: string; grossPay: string } };
  };
  totals?: { total: number; active: number; inactive: number; onLeave: number; pendingApprovals: number; pendingLeave: number; pendingTimesheets: number; pendingOvertime: number };
  workforceByDepartment?: { name: string; value: number }[];
  workforceByType?: { name: string; value: number }[];
  workforceByFrequency?: { name: string; value: number }[];
  timesheetsThisMonth?: { status: string; count: number; hours: string }[];
  overtimeLast30Days?: { requests: number; hours: string };
  latestPayroll?: { id: string; runNumber: string; status: string; payDate: string; net: string } | null;
  leaveTrend?: { month: string; days: number }[];
}

interface PayrollDash {
  year: number;
  complianceCertified: boolean;
  totals: { runs: number; gross: string; net: string; employeeDeductions: string; employerContributions: string; statutoryEmployee: string };
  statutoryByComponent: { code: string; employee: string; employer: string }[];
  byPeriod: { runNumber: string; payDate: string; gross: string; net: string; employer: string }[];
  byDepartment: { department: string; gross: string; employer: string }[];
  runStatus: { status: string; count: number }[];
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium tabular-nums">
          {used} / {limit}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-2 rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Dashboard() {
  const { me, can } = useSession();
  const [tab, setTab] = useState<'hr' | 'payroll'>('hr');
  const hr = useApi<HrDash>(['dashboard', 'hr'], '/dashboard/hr');
  const payroll = useApi<PayrollDash>(['dashboard', 'payroll'], can('payroll.read') && tab === 'payroll' ? '/dashboard/payroll' : null);
  const tenant = me!.activeTenant!;
  const d = hr.data;
  return (
    <>
      <PageHeader title={`Welcome, ${me!.user.fullName.split(' ')[0]}`} description={`${tenant.displayName} · ${new Date().toLocaleDateString('en-JM', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`} />
      {can('payroll.read') && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'hr', label: 'HR overview' },
            { value: 'payroll', label: 'Payroll' },
          ]}
        />
      )}
      {tab === 'hr' && (hr.isLoading ? <Spinner /> : d && <HrView d={d} />)}
      {tab === 'payroll' && (payroll.isLoading ? <Spinner /> : payroll.data && <PayrollView d={payroll.data} />)}
    </>
  );
}

function SelfPanel({ mine }: { mine: NonNullable<HrDash['mine']> }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="My leave balances" actions={<Link to="/app/leave"><Button size="sm" variant="outline">Request leave</Button></Link>} />
        <CardBody>
          {mine.leaveBalances.length === 0 ? (
            <p className="text-sm text-slate-500">No tracked leave balances yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {mine.leaveBalances.map((b) => (
                <div key={b.leaveTypeName} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm text-slate-500">{b.leaveTypeName}</p>
                  <p className="text-2xl font-semibold tabular-nums">{formatNumber(b.available)} <span className="text-sm font-normal text-slate-500">days available</span></p>
                  {Number(b.pending) > 0 && <p className="text-xs text-amber-600">{b.pending} pending</p>}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="My latest payslip" />
        <CardBody>
          {mine.latestPayslip ? (
            <div>
              <p className="text-sm text-slate-500">Paid {formatDate(mine.latestPayslip.payDate)}</p>
              <p className="mt-1 text-2xl font-semibold">{formatMoney(mine.latestPayslip.runEmployee.netPay)}</p>
              <p className="text-xs text-slate-500">Gross {formatMoney(mine.latestPayslip.runEmployee.grossPay)}</p>
              <div className="mt-3">
                <DownloadButton path={`/payslips/${mine.latestPayslip.id}/download?inline=true`} open label="View payslip" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No payslips yet.</p>
          )}
          <div className="mt-4 space-y-1 text-sm text-slate-600">
            <p>Pending leave: {mine.pendingLeave}</p>
            <p>Pending timesheets: {mine.pendingTimesheets}</p>
            <p>Pending overtime: {mine.pendingOvertime}</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function HrView({ d }: { d: HrDash }) {
  if (d.scope === 'self') {
    return (
      <div className="space-y-5">
        {d.mine ? <SelfPanel mine={d.mine} /> : <Alert tone="info">Your user account is not linked to an employee profile yet. Ask your HR administrator to link it for self-service.</Alert>}
      </div>
    );
  }
  const t = d.totals!;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active employees" value={formatNumber(t.active)} hint={`${t.total} total · ${t.inactive} inactive`} icon={<Users className="h-5 w-5" />} />
        <StatCard label="On leave today" value={t.onLeave} icon={<CalendarClock className="h-5 w-5" />} tone="sky" />
        <StatCard label="Pending approvals" value={t.pendingApprovals} hint={`${t.pendingLeave} leave · ${t.pendingTimesheets} timesheets · ${t.pendingOvertime} overtime`} icon={<ClipboardCheck className="h-5 w-5" />} tone="amber" />
        <StatCard label="Overtime (30 days)" value={`${formatNumber(d.overtimeLast30Days!.hours)} h`} hint={`${d.overtimeLast30Days!.requests} approved requests`} icon={<Timer className="h-5 w-5" />} tone="violet" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Leave trend" description="Approved leave days by start month" />
          <CardBody className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.leaveTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Line type="monotone" dataKey="days" stroke="#0b5d3b" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Subscription usage" description={`${d.subscription.planName} · ${d.subscription.status.toLowerCase()}`} />
          <CardBody className="space-y-4">
            <UsageBar label="Active employees" used={d.subscription.activeEmployees} limit={d.subscription.employeeLimit} />
            <UsageBar label="Users (incl. invited)" used={d.subscription.activeUsers} limit={d.subscription.userLimit} />
            <Link to="/app/subscription" className="block text-sm text-brand hover:underline">
              Manage subscription →
            </Link>
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Workforce by department" />
          <CardBody className="h-64">
            {d.workforceByDepartment!.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d.workforceByDepartment} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {d.workforceByDepartment!.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="No active employees" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Pay frequency mix" />
          <CardBody className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.workforceByFrequency}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" fill="#0b5d3b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Timesheets this month" />
          <CardBody className="space-y-3">
            {d.timesheetsThisMonth!.length === 0 && <p className="text-sm text-slate-500">No timesheets recorded this month.</p>}
            {d.timesheetsThisMonth!.map((s) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <StatusBadge status={s.status} />
                <span className="tabular-nums text-slate-700">
                  {s.count} entries · {formatNumber(s.hours)} h
                </span>
              </div>
            ))}
            <div className="border-t border-slate-100 pt-3">
              <p className="text-sm font-medium text-slate-700">Latest payroll</p>
              {d.latestPayroll ? (
                <Link to={`/app/payroll/runs/${d.latestPayroll.id}`} className="mt-1 flex items-center justify-between text-sm hover:underline">
                  <span>
                    {d.latestPayroll.runNumber} · {formatDate(d.latestPayroll.payDate)}
                  </span>
                  <StatusBadge status={d.latestPayroll.status} />
                </Link>
              ) : (
                <p className="mt-1 text-sm text-slate-500">No payroll runs yet.</p>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
      {d.mine && <SelfPanel mine={d.mine} />}
    </div>
  );
}

function PayrollView({ d }: { d: PayrollDash }) {
  return (
    <div className="space-y-5">
      {!d.complianceCertified && (
        <Alert tone="warning" title="Statutory payroll not yet certified">
          Payroll figures depend on statutory rates configured in Payroll Setup. They must be verified by a qualified Jamaican payroll specialist before live use.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`Gross payroll ${d.year}`} value={formatMoney(d.totals.gross)} icon={<Wallet className="h-5 w-5" />} hint={`${d.totals.runs} approved runs`} />
        <StatCard label="Net payroll" value={formatMoney(d.totals.net)} icon={<Receipt className="h-5 w-5" />} tone="emerald" />
        <StatCard label="Statutory (employee)" value={formatMoney(d.totals.statutoryEmployee)} icon={<Gauge className="h-5 w-5" />} tone="amber" />
        <StatCard label="Employer contributions" value={formatMoney(d.totals.employerContributions)} icon={<UserCheck className="h-5 w-5" />} tone="violet" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Payroll by period" description="Last 12 approved runs" />
          <CardBody className="h-72">
            {d.byPeriod.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.byPeriod.map((p) => ({ ...p, gross: Number(p.gross), net: Number(p.net), employer: Number(p.employer) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="payDate" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => formatMoney(v.toFixed(2))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="gross" fill="#0b5d3b" name="Gross" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="net" fill="#f2b705" name="Net" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="No approved payroll yet" icon={<Clock className="h-6 w-6" />} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Run status" />
          <CardBody className="space-y-2">
            {d.runStatus.map((s) => (
              <div key={s.status} className="flex justify-between text-sm">
                <StatusBadge status={s.status} />
                <span className="tabular-nums">{s.count}</span>
              </div>
            ))}
            {d.runStatus.length === 0 && <p className="text-sm text-slate-500">No runs yet.</p>}
            <Link to="/app/payroll/runs" className="block pt-2 text-sm text-brand hover:underline">
              Go to payroll runs →
            </Link>
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Statutory deductions by component" />
          <CardBody className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.statutoryByComponent.map((s) => ({ ...s, employee: Number(s.employee), employer: Number(s.employer) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="code" fontSize={12} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v: number) => formatMoney(v.toFixed(2))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="employee" name="Employee" fill="#0ea5e9" />
                <Bar dataKey="employer" name="Employer" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Payroll cost by department" />
          <CardBody className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={d.byDepartment.map((x) => ({ ...x, gross: Number(x.gross), employer: Number(x.employer) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="department" width={110} fontSize={11} />
                <Tooltip formatter={(v: number) => formatMoney(v.toFixed(2))} />
                <Bar dataKey="gross" stackId="a" name="Gross" fill="#0b5d3b" />
                <Bar dataKey="employer" stackId="a" name="Employer" fill="#f2b705" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
