import { useQueryClient } from '@tanstack/react-query';
import { customerSchema, paymentSchema, planSchema, productSchema } from '@yardhrms/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Input,
  KeyValue,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  StatCard,
  StatusBadge,
  Textarea,
  errorMessage,
  formatDate,
  formatDateTime,
  formatMoney,
  todayIso,
  useConfirm,
  useToast,
} from '@yardhrms/ui';
import { BadgeCheck, Building2, CalendarClock, CheckCircle2, CreditCard, Paperclip, Plus, Users, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, usePaged, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { CreateSubscriptionModal } from './Subscriptions';

const COLORS = ['#312e81', '#f2b705', '#0ea5e9', '#10b981', '#f43f5e', '#8b5cf6'];

export function Dashboard() {
  const q = useApi<any>(['platform-dashboard'], '/platform/dashboard');
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return null;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <>
      <PageHeader title="Licence dashboard" description="All figures come from live subscription, payment and usage data" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Customers" value={d.totals.customers} hint={`${d.totals.tenants} registered tenants`} icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="Active paid subscriptions" value={d.totals.activePaid} hint={`${d.totals.grace} in grace period`} icon={<BadgeCheck className="h-5 w-5" />} tone="emerald" />
        <StatCard label="Free subscriptions" value={d.totals.free} icon={<Users className="h-5 w-5" />} tone="sky" />
        <StatCard label="Expired / suspended" value={`${d.totals.expired} / ${d.totals.suspended}`} icon={<XCircle className="h-5 w-5" />} tone="rose" />
        <StatCard label="Renewals due (30 days)" value={d.totals.upcomingRenewals} icon={<CalendarClock className="h-5 w-5" />} tone="amber" />
        <StatCard label="Pending payments" value={d.totals.pendingPayments} hint="Awaiting verification" icon={<CreditCard className="h-5 w-5" />} tone="violet" />
        <StatCard label="Employee capacity used" value={`${pct(d.capacity.employeesUsed, d.capacity.employeesLicensed)}%`} hint={`${d.capacity.employeesUsed} / ${d.capacity.employeesLicensed}`} />
        <StatCard label="User seats used" value={`${pct(d.capacity.usersUsed, d.capacity.usersLicensed)}%`} hint={`${d.capacity.usersUsed} / ${d.capacity.usersLicensed}`} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Plan distribution" description="Current subscriptions of registered tenants" />
          <CardBody className="h-64">
            {d.planDistribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d.planDistribution} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                    {d.planDistribution.map((_: unknown, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="No tenants yet" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Verified revenue by currency" description="Sum of VERIFIED manual payments (reversed payments excluded)" />
          <DataTable
            rows={d.verifiedRevenueByCurrency}
            rowKey={(r: any) => r.currency}
            empty={<EmptyState title="No verified payments" />}
            columns={[
              { key: 'cur', header: 'Currency', cell: (r: any) => r.currency },
              { key: 'n', header: 'Payments', align: 'right', cell: (r: any) => r.payments },
              { key: 'amt', header: 'Amount', align: 'right', cell: (r: any) => formatMoney(r.amount, r.currency) },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

export function Customers() {
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const q = usePaged<any>(['customers'], '/platform/customers', { page, search: search || undefined });
  return (
    <>
      <PageHeader title="Customers" description="Commercial customers and their linked YardHRMS tenants" actions={can('platform.customers.write') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New customer</Button>} />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Search customers" />
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => navigate(`/customers/${r.id}`)}
          empty={<EmptyState title="No customers" />}
          columns={[
            { key: 'name', header: 'Customer', cell: (r: any) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-slate-500">{r.email ?? r.contactName ?? ''}</p></div> },
            { key: 'tenant', header: 'Tenant', cell: (r: any) => r.tenant?.displayName ?? <span className="text-slate-400">Not registered</span> },
            { key: 'plan', header: 'Plan', cell: (r: any) => r.currentPlan ?? '—' },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.subscriptionStatus} /> },
            { key: 'end', header: 'Expires', hideOnMobile: true, cell: (r: any) => formatDate(r.periodEnd) },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
      <CustomerModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CustomerModal({ open, onClose, value }: { open: boolean; onClose: () => void; value?: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tenantSearch, setTenantSearch] = useState('');
  const tenants = useApi<any[]>(['platform-tenants', tenantSearch], open ? '/platform/tenants' : null, { search: tenantSearch || undefined });
  const form = useZodForm<any>(customerSchema, { values: value ? { ...value, tenantId: value.tenantId ?? '' } : { name: '' } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]));
    try {
      if (value) await api.patch(`/platform/customers/${value.id}`, body);
      else await api.post('/platform/customers', body);
      toast.success('Customer saved');
      await qc.invalidateQueries({ queryKey: ['customers'] });
      await qc.invalidateQueries({ queryKey: ['customer'] });
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save customer', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={value ? 'Edit customer' : 'New customer'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer / company name" error={errors.name?.message} required>
            {(p) => <Input {...p} {...form.register('name')} />}
          </Field>
          <Field label="Contact name">{(p) => <Input {...p} {...form.register('contactName')} />}</Field>
          <Field label="Email" error={errors.email?.message}>
            {(p) => <Input {...p} type="email" {...form.register('email')} />}
          </Field>
          <Field label="Phone">{(p) => <Input {...p} {...form.register('phone')} />}</Field>
          <Field label="TRN">{(p) => <Input {...p} {...form.register('trn')} />}</Field>
          <Field label="Address">{(p) => <Input {...p} {...form.register('address')} />}</Field>
        </div>
        <Field label="Link to registered tenant" hint="Search companies registered in YardHRMS (metadata only)">
          {(p) => (
            <div className="space-y-2">
              <Input id={p.id} placeholder="Search tenant name…" value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)} />
              <Select aria-label="Tenant" {...form.register('tenantId')}>
                <option value="">Not linked</option>
                {tenants.data?.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.customers.length > 0 && t.customers[0].id !== value?.id}>
                    {t.displayName} ({t.slug}){t.customers.length ? ` — linked to ${t.customers[0].name}` : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </Field>
        <Field label="Notes">{(p) => <Textarea {...p} {...form.register('notes')} />}</Field>
      </form>
    </Modal>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const { can } = useSession();
  const q = useApi<any>(['customer', id], `/platform/customers/${id}`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const navigate = useNavigate();
  if (q.isLoading) return <Spinner />;
  const c = q.data;
  if (!c) return <EmptyState title="Customer not found" />;
  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/customers" className="hover:underline">Customers</Link>}
        title={c.name}
        description={c.tenant ? `Tenant: ${c.tenant.displayName} (${c.tenant.slug}) · registered ${formatDate(c.tenant.createdAt)}` : 'Not yet registered in YardHRMS'}
        actions={
          <>
            {can('platform.customers.write') && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
            {can('platform.payments.record') && <Button variant="outline" icon={<CreditCard className="h-4 w-4" />} onClick={() => setPaying(true)}>Record payment</Button>}
            {can('platform.subscriptions.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setSubscribing(true)}>New subscription</Button>}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Contact" />
          <CardBody>
            <KeyValue columns={1} items={[{ label: 'Contact', value: c.contactName }, { label: 'Email', value: c.email }, { label: 'Phone', value: c.phone }, { label: 'TRN', value: c.trn }, { label: 'Address', value: c.address }, { label: 'Notes', value: c.notes }]} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Usage" description="Capacity counters only — no HR or payroll data is visible to platform staff" />
          <CardBody>
            {c.usage ? (
              <KeyValue
                columns={3}
                items={[
                  { label: 'Plan', value: c.usage.planName },
                  { label: 'Status', value: <StatusBadge status={c.usage.status} /> },
                  { label: 'Expires', value: formatDate(c.usage.periodEnd) },
                  { label: 'Active employees', value: `${c.usage.activeEmployees} / ${c.usage.employeeLimit}` },
                  { label: 'Users', value: `${c.usage.activeUsers} / ${c.usage.userLimit}` },
                  { label: 'Features', value: c.usage.features.join(', ') },
                ]}
              />
            ) : (
              <p className="text-sm text-slate-500">Usage appears once the customer is linked to a registered tenant.</p>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title="Subscriptions" />
        <DataTable
          rows={c.subscriptions}
          rowKey={(s: any) => s.id}
          onRowClick={(s: any) => navigate(`/subscriptions/${s.id}`)}
          empty={<EmptyState title="No subscriptions" />}
          columns={[
            { key: 'plan', header: 'Plan', cell: (s: any) => <span className="font-medium">{s.plan.name}{s.isCurrent && <Badge tone="brand" className="ml-2">current</Badge>}</span> },
            { key: 'status', header: 'Status', cell: (s: any) => <StatusBadge status={s.effectiveStatus} /> },
            { key: 'src', header: 'Source', cell: (s: any) => s.source.toLowerCase().replace('_', ' ') },
            { key: 'period', header: 'Period', cell: (s: any) => (s.periodStart ? `${formatDate(s.periodStart)} – ${s.periodEnd ? formatDate(s.periodEnd) : 'no expiry'}` : '—') },
            { key: 'lic', header: 'Licence', hideOnMobile: true, cell: (s: any) => <code className="text-xs">{s.license?.licenseKey}</code> },
          ]}
        />
      </Card>
      <Card className="mt-5">
        <CardHeader title="Manual payments" />
        <DataTable
          rows={c.payments}
          rowKey={(p: any) => p.id}
          onRowClick={(p: any) => navigate(`/payments/${p.id}`)}
          empty={<EmptyState title="No payments recorded" />}
          columns={[
            { key: 'date', header: 'Date', cell: (p: any) => formatDate(p.paymentDate) },
            { key: 'ref', header: 'Reference', cell: (p: any) => p.reference },
            { key: 'amt', header: 'Amount', align: 'right', cell: (p: any) => formatMoney(p.amount, p.currency) },
            { key: 'status', header: 'Status', cell: (p: any) => <StatusBadge status={p.status} /> },
            { key: 'used', header: 'Applied', cell: (p: any) => (p.consumedFor ? <Badge tone="blue">{p.consumedFor.toLowerCase()}</Badge> : '—') },
          ]}
        />
      </Card>
      <Card className="mt-5">
        <CardHeader title="Subscription events" description="Append-only history" />
        <DataTable
          rows={c.events}
          rowKey={(e: any) => e.id}
          empty={<EmptyState title="No events" />}
          columns={[
            { key: 'at', header: 'When', cell: (e: any) => formatDateTime(e.createdAt) },
            { key: 'type', header: 'Event', cell: (e: any) => e.type.replace(/_/g, ' ').toLowerCase() },
            { key: 'to', header: 'Status', cell: (e: any) => <StatusBadge status={e.toStatus} /> },
            { key: 'reason', header: 'Reason', cell: (e: any) => e.reason ?? '—' },
          ]}
        />
      </Card>
      <CustomerModal open={editing} onClose={() => setEditing(false)} value={c} />
      <PaymentModal open={paying} onClose={() => setPaying(false)} customerId={c.id} />
      <CreateSubscriptionModal open={subscribing} onClose={() => setSubscribing(false)} customerId={c.id} payments={c.payments.filter((p: any) => p.status === 'VERIFIED' && !p.consumedAt)} tenantLinked={!!c.tenant} />
    </>
  );
}

// ── Catalog ────────────────────────────────────────────────────────────────
export function Products() {
  const { can } = useSession();
  const q = useApi<any[]>(['products'], '/platform/products');
  const [editing, setEditing] = useState<any | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(productSchema, { values: editing ?? { active: true } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      if (editing?.id) await api.patch(`/platform/products/${editing.id}`, v);
      else await api.post('/platform/products', v);
      toast.success('Product saved');
      await qc.invalidateQueries({ queryKey: ['products'] });
      setEditing(null);
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save', errorMessage(x));
    }
  });
  return (
    <>
      <PageHeader title="Products" actions={can('platform.catalog.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ active: true })}>New product</Button>} />
      <Card>
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          onRowClick={can('platform.catalog.manage') ? setEditing : undefined}
          columns={[
            { key: 'code', header: 'Code', cell: (r: any) => <code className="text-xs">{r.code}</code> },
            { key: 'name', header: 'Product', cell: (r: any) => r.name },
            { key: 'desc', header: 'Description', cell: (r: any) => r.description ?? '—' },
            { key: 'plans', header: 'Plans', align: 'right', cell: (r: any) => r._count.plans },
            { key: 'active', header: 'Status', cell: (r: any) => <StatusBadge status={r.active ? 'ACTIVE' : 'RETIRED'} /> },
          ]}
        />
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit product' : 'New product'} footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={submit}>Save</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Code" error={errors.code?.message} required>{(p) => <Input {...p} {...form.register('code')} />}</Field>
          <Field label="Name" error={errors.name?.message} required>{(p) => <Input {...p} {...form.register('name')} />}</Field>
          <Field label="Description">{(p) => <Textarea {...p} {...form.register('description')} />}</Field>
          <Checkbox label="Active" {...form.register('active')} />
        </form>
      </Modal>
    </>
  );
}

export function Plans() {
  const { can } = useSession();
  const q = useApi<any[]>(['plans'], '/platform/plans');
  const features = useApi<any[]>(['features'], '/platform/features');
  const products = useApi<any[]>(['products'], '/platform/products');
  const [editing, setEditing] = useState<any | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(planSchema, {
    values: editing?.id ? { ...editing, price: editing.price ?? '', durationMonths: editing.durationMonths ?? '' } : { isFree: false, currency: 'JMD', gracePeriodDays: 14, durationMonths: 12, features: [], status: 'ACTIVE', productId: products.data?.[0]?.id },
  });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      const body = { ...v, price: v.price === '' ? null : v.price, durationMonths: v.isFree || v.durationMonths === '' ? null : v.durationMonths };
      if (editing?.id) await api.put(`/platform/plans/${editing.id}`, body);
      else await api.post('/platform/plans', body);
      toast.success('Plan saved', 'Changes apply to new subscriptions and plan changes; existing licences keep their snapshot until changed.');
      await qc.invalidateQueries({ queryKey: ['plans'] });
      setEditing(null);
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save plan', errorMessage(x));
    }
  });
  const selected: string[] = form.watch('features') ?? [];
  return (
    <>
      <PageHeader title="Plans & features" description="Prices are intentionally unset until approved by Qwik. All limits and entitlements are editable." actions={can('platform.catalog.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({})}>New plan</Button>} />
      <Card>
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          onRowClick={can('platform.catalog.manage') ? setEditing : undefined}
          columns={[
            { key: 'name', header: 'Plan', cell: (r: any) => <div><p className="font-medium">{r.name}</p><code className="text-xs text-slate-500">{r.code}</code></div> },
            { key: 'price', header: 'Price', cell: (r: any) => (r.isFree ? 'Free' : r.price ? formatMoney(r.price, r.currency) : <span className="text-amber-700">Not set</span>) },
            { key: 'term', header: 'Term', cell: (r: any) => (r.durationMonths ? `${r.durationMonths} months` : 'No expiry') },
            { key: 'emp', header: 'Employees', align: 'right', cell: (r: any) => r.employeeLimit },
            { key: 'users', header: 'Users', align: 'right', cell: (r: any) => r.userLimit },
            { key: 'grace', header: 'Grace', align: 'right', hideOnMobile: true, cell: (r: any) => `${r.gracePeriodDays} d` },
            { key: 'features', header: 'Features', hideOnMobile: true, cell: (r: any) => <div className="flex max-w-xs flex-wrap gap-1">{r.features.map((f: string) => <Badge key={f}>{f.replace('_', ' ').toLowerCase()}</Badge>)}</div> },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing?.id ? `Edit ${editing.name}` : 'New plan'} footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save plan</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Product" required>
              {(p) => (
                <Select {...p} {...form.register('productId')}>
                  {products.data?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Code" error={errors.code?.message} required>{(p) => <Input {...p} {...form.register('code')} />}</Field>
            <Field label="Name" error={errors.name?.message} required>{(p) => <Input {...p} {...form.register('name')} />}</Field>
            <Field label="Price" error={errors.price?.message} hint="Leave blank until approved">{(p) => <Input {...p} inputMode="decimal" {...form.register('price')} />}</Field>
            <Field label="Currency" error={errors.currency?.message}>{(p) => <Input {...p} {...form.register('currency')} />}</Field>
            <Field label="Duration (months)" error={errors.durationMonths?.message}>{(p) => <Input {...p} type="number" {...form.register('durationMonths')} />}</Field>
            <Field label="Employee limit" error={errors.employeeLimit?.message} required>{(p) => <Input {...p} type="number" {...form.register('employeeLimit')} />}</Field>
            <Field label="Active-user limit" error={errors.userLimit?.message} required>{(p) => <Input {...p} type="number" {...form.register('userLimit')} />}</Field>
            <Field label="Grace period (days)" error={errors.gracePeriodDays?.message} required>{(p) => <Input {...p} type="number" {...form.register('gracePeriodDays')} />}</Field>
          </div>
          <div className="flex gap-6">
            <Checkbox label="Free plan" {...form.register('isFree')} />
            <Field label="Status">
              {(p) => (
                <Select {...p} {...form.register('status')}>
                  <option value="ACTIVE">Active</option>
                  <option value="RETIRED">Retired</option>
                </Select>
              )}
            </Field>
          </div>
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium">Enabled features</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {features.data?.map((f) => (
                <Checkbox
                  key={f.code}
                  label={<span>{f.name} <span className="text-xs text-slate-400">— {f.description}</span></span>}
                  checked={selected.includes(f.code)}
                  onChange={(e) => form.setValue('features', e.target.checked ? [...selected, f.code] : selected.filter((x) => x !== f.code))}
                />
              ))}
            </div>
          </fieldset>
        </form>
      </Modal>
    </>
  );
}

// ── Manual payments (LIC-003/004) ──────────────────────────────────────────
export function Payments() {
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState(false);
  const navigate = useNavigate();
  const q = usePaged<any>(['payments'], '/platform/payments', { page, status: status || undefined, search: search || undefined });
  return (
    <>
      <PageHeader title="Manual payments" description="Record and verify payments received outside the system. There is no payment gateway in this release." actions={can('platform.payments.record') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setRecording(true)}>Record payment</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Reference, invoice or customer" />
          <Select className="w-40" aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All statuses</option>
            {['PENDING', 'VERIFIED', 'REJECTED', 'REVERSED'].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => navigate(`/payments/${r.id}`)}
          empty={<EmptyState title="No payments" />}
          columns={[
            { key: 'date', header: 'Paid', cell: (r: any) => formatDate(r.paymentDate) },
            { key: 'cust', header: 'Customer', cell: (r: any) => r.customer.name },
            { key: 'ref', header: 'Reference / invoice', cell: (r: any) => <div><p>{r.reference}</p><p className="text-xs text-slate-500">{r.invoiceNumber ?? ''}</p></div> },
            { key: 'method', header: 'Method', hideOnMobile: true, cell: (r: any) => r.method.toLowerCase().replace('_', ' ') },
            { key: 'amt', header: 'Amount', align: 'right', cell: (r: any) => formatMoney(r.amount, r.currency) },
            { key: 'ev', header: 'Evidence', hideOnMobile: true, cell: (r: any) => (r._count.evidence ? <Badge tone="blue">{r._count.evidence} file(s)</Badge> : '—') },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
      <PaymentModal open={recording} onClose={() => setRecording(false)} />
    </>
  );
}

export function PaymentModal({ open, onClose, customerId }: { open: boolean; onClose: () => void; customerId?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const customers = useApi<any[]>(['customers-all'], open && !customerId ? '/platform/customers' : null, { pageSize: 100 });
  const plans = useApi<any[]>(['plans'], open ? '/platform/plans' : null);
  const form = useZodForm<any>(paymentSchema, { values: { customerId: customerId ?? '', paymentDate: todayIso(), currency: 'JMD', method: 'BANK_TRANSFER' } as any });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]));
    try {
      const p = await api.post<any>('/platform/payments', body);
      toast.success('Payment recorded as PENDING', 'A different officer must verify it before it can fund a subscription.');
      await qc.invalidateQueries({ queryKey: ['payments'] });
      await qc.invalidateQueries({ queryKey: ['customer'] });
      onClose();
      navigate(`/payments/${p.id}`);
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not record payment', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Record manual payment" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Record payment</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {!customerId && (
            <Field label="Customer" error={errors.customerId?.message} required>
              {(p) => (
                <Select {...p} {...form.register('customerId')}>
                  <option value="">Select customer…</option>
                  {(customers.data as any)?.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Plan (optional)">
            {(p) => (
              <Select {...p} {...form.register('planId')}>
                <option value="">—</option>
                {plans.data?.filter((x) => !x.isFree).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Receipt / bank reference" error={errors.reference?.message} required>{(p) => <Input {...p} {...form.register('reference')} />}</Field>
          <Field label="Invoice number" error={errors.invoiceNumber?.message}>{(p) => <Input {...p} {...form.register('invoiceNumber')} />}</Field>
          <Field label="Payment date" error={errors.paymentDate?.message} required>{(p) => <Input {...p} type="date" {...form.register('paymentDate')} />}</Field>
          <Field label="Method" required>
            {(p) => (
              <Select {...p} {...form.register('method')}>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
                <option value="OTHER">Other</option>
              </Select>
            )}
          </Field>
          <Field label="Amount" error={errors.amount?.message} required>{(p) => <Input {...p} inputMode="decimal" {...form.register('amount')} />}</Field>
          <Field label="Currency" error={errors.currency?.message} required>{(p) => <Input {...p} {...form.register('currency')} />}</Field>
          <Field label="Covered period start" error={errors.periodStart?.message}>{(p) => <Input {...p} type="date" {...form.register('periodStart')} />}</Field>
          <Field label="Covered period end" error={errors.periodEnd?.message}>{(p) => <Input {...p} type="date" {...form.register('periodEnd')} />}</Field>
        </div>
        <Field label="Notes">{(p) => <Textarea {...p} {...form.register('notes')} />}</Field>
      </form>
    </Modal>
  );
}

export function PaymentDetail() {
  const { id } = useParams();
  const { can, me } = useSession();
  const q = useApi<any>(['payment', id], `/platform/payments/${id}`);
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  if (q.isLoading) return <Spinner />;
  const p = q.data;
  if (!p) return <EmptyState title="Payment not found" />;
  const act = async (action: 'verify' | 'reject' | 'reverse') => {
    const r = await confirm({
      title: action === 'verify' ? 'Verify payment' : action === 'reject' ? 'Reject payment' : 'Reverse payment',
      message: action === 'verify' ? 'Confirm the funds were received. Verified payments can fund an activation or a renewal exactly once.' : 'This is recorded permanently in the verification history.',
      tone: action === 'verify' ? 'primary' : 'danger',
      requireReason: action === 'verify' ? undefined : 'Reason',
    });
    if (!r.ok) return;
    try {
      await api.post(`/platform/payments/${id}/${action}`, { reason: r.reason ?? null });
      toast.success('Payment updated');
      await qc.invalidateQueries({ queryKey: ['payment', id] });
      await qc.invalidateQueries({ queryKey: ['payments'] });
    } catch (e) {
      toast.error('Action failed', errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/payments" className="hover:underline">Manual payments</Link>}
        title={<span className="flex items-center gap-3">{formatMoney(p.amount, p.currency)} <StatusBadge status={p.status} /></span>}
        description={`${p.customer.name} · ${p.reference}`}
        actions={
          <>
            {p.status === 'PENDING' && can('platform.payments.verify') && (
              <>
                <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => act('verify')} disabled={p.recordedById === me!.user.id} title={p.recordedById === me!.user.id ? 'A different officer must verify' : undefined}>
                  Verify
                </Button>
                <Button variant="outline" onClick={() => act('reject')}>Reject</Button>
              </>
            )}
            {p.status === 'VERIFIED' && can('platform.payments.reverse') && <Button variant="danger" onClick={() => act('reverse')}>Reverse</Button>}
          </>
        }
      />
      {p.status === 'PENDING' && p.recordedById === me!.user.id && (
        <div className="mb-5">
          <Alert tone="info">You recorded this payment. Separation of duties requires another officer to verify it.</Alert>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Payment details" />
          <CardBody>
            <KeyValue
              items={[
                { label: 'Customer', value: <Link className="text-brand underline" to={`/customers/${p.customer.id}`}>{p.customer.name}</Link> },
                { label: 'Payment date', value: formatDate(p.paymentDate) },
                { label: 'Method', value: p.method.toLowerCase().replace('_', ' ') },
                { label: 'Invoice', value: p.invoiceNumber },
                { label: 'Reference', value: p.reference },
                { label: 'Covered period', value: p.periodStart ? `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` : '—' },
                { label: 'Applied to', value: p.consumedFor ? <Link className="text-brand underline" to={`/subscriptions/${p.subscriptionId}`}>{p.consumedFor.toLowerCase()} · {formatDateTime(p.consumedAt)}</Link> : 'Not yet applied' },
                { label: 'Notes', value: p.notes },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Supporting evidence"
            actions={
              can('platform.payments.record') && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        await api.upload(`/platform/payments/${id}/evidence`, f);
                        toast.success('Evidence uploaded');
                        await qc.invalidateQueries({ queryKey: ['payment', id] });
                      } catch (x) {
                        toast.error('Upload failed', errorMessage(x));
                      } finally {
                        e.target.value = '';
                      }
                    }}
                  />
                  <Button size="sm" variant="outline" icon={<Paperclip className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                    Upload
                  </Button>
                </>
              )
            }
          />
          <CardBody className="space-y-2">
            {p.evidence.length === 0 && <p className="text-sm text-slate-500">No files attached.</p>}
            {p.evidence.map((e: any) => (
              <button key={e.id} className="block w-full truncate rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => api.download(`/platform/payments/${id}/evidence/${e.id}`).catch((x) => toast.error('Download failed', errorMessage(x)))}>
                {e.fileName} <span className="text-xs text-slate-400">· {Math.ceil(e.sizeBytes / 1024)} KB</span>
              </button>
            ))}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title="Verification history" description="Append-only — status transitions with actor, reason and time" />
        <DataTable
          rows={p.history}
          rowKey={(h: any) => h.id}
          columns={[
            { key: 'at', header: 'When', cell: (h: any) => formatDateTime(h.createdAt) },
            { key: 'from', header: 'From', cell: (h: any) => <StatusBadge status={h.fromStatus} /> },
            { key: 'to', header: 'To', cell: (h: any) => <StatusBadge status={h.toStatus} /> },
            { key: 'who', header: 'By', cell: (h: any) => h.actorEmail },
            { key: 'reason', header: 'Reason', cell: (h: any) => h.reason ?? '—' },
          ]}
        />
      </Card>
    </>
  );
}
