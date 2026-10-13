import { useQueryClient } from '@tanstack/react-query';
import { platformMfaResetSchema, staffSchema } from '@yardhrms/types';
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
  StatusBadge,
  Textarea,
  errorMessage,
  formatDate,
  formatDateTime,
  formatMoney,
  useConfirm,
  useToast,
} from '@yardhrms/ui';
import { Copy, KeyRound, RefreshCw, ShieldAlert, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, usePaged, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';

export function CreateSubscriptionModal({ open, onClose, customerId, payments, tenantLinked }: { open: boolean; onClose: () => void; customerId: string; payments: any[]; tenantLinked: boolean }) {
  const { can } = useSession();
  const plans = useApi<any[]>(['plans'], open ? '/platform/plans' : null);
  const [planId, setPlanId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [direct, setDirect] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setPlanId('');
      setPaymentId(payments[0]?.id ?? '');
      setOverride(false);
      setOverrideReason('');
      setDirect(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setBusy(true);
    try {
      const sub = await api.post<any>('/platform/subscriptions', { customerId, planId, paymentId: override ? null : paymentId || null, override, overrideReason: override ? overrideReason : null, applyToTenantDirectly: direct });
      toast.success(direct ? 'Subscription activated for the tenant' : 'Subscription created — issue an activation code next');
      await qc.invalidateQueries({ queryKey: ['customer'] });
      onClose();
      navigate(`/subscriptions/${sub.id}`);
    } catch (e) {
      toast.error('Could not create subscription', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="New paid subscription" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!planId || (!override && !paymentId) || (override && overrideReason.trim().length < 10)} onClick={submit}>Create subscription</Button></>}>
      <div className="space-y-4">
        <Alert tone="info">A paid subscription requires a VERIFIED, unused manual payment (AC-03) — or an authorized, reasoned commercial override.</Alert>
        <Field label="Plan" required>
          {(p) => (
            <Select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Select plan…</option>
              {plans.data?.filter((x) => !x.isFree && x.status === 'ACTIVE').map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} — {x.employeeLimit} employees / {x.userLimit} users / {x.durationMonths} months
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!override && (
          <Field label="Verified payment" required hint={payments.length ? undefined : 'No verified, unused payments for this customer'}>
            {(p) => (
              <Select {...p} value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
                <option value="">Select payment…</option>
                {payments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {formatDate(x.paymentDate)} · {x.reference} · {formatMoney(x.amount, x.currency)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {can('platform.override') && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <Checkbox label="Commercial override (no payment) — audited" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            {override && <Textarea className="mt-2" placeholder="Reason for override (min 10 characters)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} aria-label="Override reason" />}
          </div>
        )}
        <Checkbox label={tenantLinked ? 'Activate immediately for the linked tenant (no code needed)' : 'Activate immediately (requires a linked tenant)'} disabled={!tenantLinked} checked={direct} onChange={(e) => setDirect(e.target.checked)} />
      </div>
    </Modal>
  );
}

export function Subscriptions() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const q = usePaged<any>(['subscriptions'], '/platform/subscriptions', { page, status: status || undefined, search: search || undefined });
  return (
    <>
      <PageHeader title="Subscriptions" description="Create subscriptions from Customers. Renewals extend an existing subscription without a new code." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Customer name" />
          <Select className="w-52" aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All stored statuses</option>
            {['PENDING_ACTIVATION', 'FREE', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'SUPERSEDED'].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase().replace('_', ' ')}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => navigate(`/subscriptions/${r.id}`)}
          empty={<EmptyState title="No subscriptions" />}
          columns={[
            { key: 'cust', header: 'Customer', cell: (r: any) => <div><p className="font-medium">{r.customer.name}</p><p className="text-xs text-slate-500">{r.tenant?.displayName ?? 'Awaiting activation'}</p></div> },
            { key: 'plan', header: 'Plan', cell: (r: any) => r.plan.name },
            { key: 'status', header: 'Effective status', cell: (r: any) => <StatusBadge status={r.effectiveStatus} /> },
            { key: 'src', header: 'Source', hideOnMobile: true, cell: (r: any) => r.source.toLowerCase().replace('_', ' ') },
            { key: 'end', header: 'Expires', cell: (r: any) => (r.periodEnd ? formatDate(r.periodEnd) : r.plan.isFree ? 'No expiry' : '—') },
            { key: 'lic', header: 'Licence', hideOnMobile: true, cell: (r: any) => <code className="text-xs">{r.license?.licenseKey}</code> },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
    </>
  );
}

export function SubscriptionDetail() {
  const { id } = useParams();
  const { can } = useSession();
  const q = useApi<any>(['subscription', id], `/platform/subscriptions/${id}`);
  const customer = useApi<any>(['customer', q.data?.customerId], q.data ? `/platform/customers/${q.data.customerId}` : null);
  const plans = useApi<any[]>(['plans'], '/platform/plans');
  const [modal, setModal] = useState<null | 'renew' | 'plan' | 'capacity' | 'code'>(null);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  if (q.isLoading) return <Spinner />;
  const s = q.data;
  if (!s) return <EmptyState title="Subscription not found" />;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['subscription', id] });
    await qc.invalidateQueries({ queryKey: ['subscriptions'] });
  };
  const stateAction = async (action: 'suspend' | 'revoke' | 'reinstate' | 'activate') => {
    const r = await confirm({
      title: action === 'activate' ? 'Activate for linked tenant' : action.charAt(0).toUpperCase() + action.slice(1) + ' subscription',
      message:
        action === 'suspend'
          ? 'The tenant becomes read-only until reinstated. No data is deleted.'
          : action === 'revoke'
            ? 'Revocation locks the tenant out of business data (licence pages stay reachable). Outstanding codes are revoked. No data is deleted.'
            : action === 'activate'
              ? 'Applies this subscription to the customer’s linked tenant without a code.'
              : 'Restores access.',
      tone: action === 'revoke' || action === 'suspend' ? 'danger' : 'primary',
      requireReason: action === 'activate' ? undefined : 'Reason',
    });
    if (!r.ok) return;
    try {
      await api.post(`/platform/subscriptions/${id}/${action}`, action === 'activate' ? {} : { reason: r.reason });
      toast.success('Subscription updated');
      await refresh();
    } catch (e) {
      toast.error('Action failed', errorMessage(e));
    }
  };
  const isPaid = !s.plan.isFree;
  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/subscriptions" className="hover:underline">Subscriptions</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{s.plan.name} · {s.customer.name} <StatusBadge status={s.effectiveStatus} />{s.isCurrent && <Badge tone="brand">current</Badge>}</span>}
        description={`Licence ${s.license?.licenseKey ?? '—'} · source ${s.source.toLowerCase().replace('_', ' ')}`}
        actions={
          <>
            {s.status === 'PENDING_ACTIVATION' && can('platform.codes.issue') && <Button icon={<KeyRound className="h-4 w-4" />} onClick={() => setModal('code')}>Generate activation code</Button>}
            {s.status === 'PENDING_ACTIVATION' && s.customer.tenantId && can('platform.subscriptions.manage') && <Button variant="outline" onClick={() => stateAction('activate')}>Activate directly</Button>}
            {isPaid && ['ACTIVE', 'GRACE', 'EXPIRED'].includes(s.status) && can('platform.subscriptions.manage') && <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => setModal('renew')}>Renew</Button>}
            {!['REVOKED', 'SUPERSEDED'].includes(s.status) && can('platform.subscriptions.manage') && (
              <>
                <Button variant="outline" onClick={() => setModal('plan')}>Change plan</Button>
                <Button variant="outline" onClick={() => setModal('capacity')}>Adjust capacity</Button>
              </>
            )}
            {can('platform.subscriptions.suspend') && ['ACTIVE', 'GRACE', 'EXPIRED', 'FREE'].includes(s.status) && <Button variant="outline" onClick={() => stateAction('suspend')}>Suspend</Button>}
            {can('platform.subscriptions.suspend') && !['REVOKED', 'SUPERSEDED'].includes(s.status) && <Button variant="danger" onClick={() => stateAction('revoke')}>Revoke</Button>}
            {can('platform.subscriptions.suspend') && ['SUSPENDED', 'REVOKED'].includes(s.status) && <Button onClick={() => stateAction('reinstate')}>Reinstate</Button>}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Subscription" />
          <CardBody>
            <KeyValue
              columns={3}
              items={[
                { label: 'Customer', value: <Link to={`/customers/${s.customerId}`} className="text-brand underline">{s.customer.name}</Link> },
                { label: 'Tenant', value: s.tenant?.displayName ?? 'Not activated' },
                { label: 'Stored status', value: s.status.toLowerCase().replace('_', ' ') },
                { label: 'Period start', value: formatDate(s.periodStart) },
                { label: 'Period end', value: s.periodEnd ? formatDate(s.periodEnd) : 'No expiry' },
                { label: 'Grace ends', value: formatDate(s.graceEnd) },
                { label: 'Employee limit', value: `${s.license?.employeeLimit ?? s.plan.employeeLimit}${s.employeeLimitOverride ? ' (override)' : ''}` },
                { label: 'User limit', value: `${s.license?.userLimit ?? s.plan.userLimit}${s.userLimitOverride ? ' (override)' : ''}` },
                { label: 'Features', value: ((s.license?.features as string[]) ?? []).join(', ') },
                { label: 'Override reason', value: s.overrideReason },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Usage" />
          <CardBody>
            {s.usage ? (
              <KeyValue columns={1} items={[{ label: 'Active employees', value: `${s.usage.activeEmployees} / ${s.usage.employeeLimit}` }, { label: 'Users', value: `${s.usage.activeUsers} / ${s.usage.userLimit}` }]} />
            ) : (
              <p className="text-sm text-slate-500">Not activated yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Activation codes" description="Raw codes are shown once at generation; only a hint is stored" />
          <DataTable
            rows={s.codes}
            rowKey={(c: any) => c.id}
            empty={<EmptyState title="No codes issued" />}
            columns={[
              { key: 'hint', header: 'Code hint', cell: (c: any) => <code className="text-xs">{c.codeHint}</code> },
              { key: 'status', header: 'Status', cell: (c: any) => <StatusBadge status={c.status} /> },
              { key: 'exp', header: 'Expires', cell: (c: any) => formatDate(c.expiresAt) },
              {
                key: 'x',
                header: '',
                cell: (c: any) =>
                  c.status === 'ISSUED' &&
                  can('platform.codes.revoke') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const r = await confirm({ title: 'Revoke code', message: 'The code can no longer be redeemed.', tone: 'danger', requireReason: 'Reason' });
                        if (!r.ok) return;
                        await api.post(`/platform/codes/${c.id}/revoke`, { reason: r.reason }).catch((e) => toast.error('Failed', errorMessage(e)));
                        await refresh();
                      }}
                    >
                      Revoke
                    </Button>
                  ),
              },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Funding payments" description="Each payment can be applied exactly once" />
          <DataTable
            rows={s.payments}
            rowKey={(p: any) => p.id}
            empty={<EmptyState title="No linked payments" />}
            columns={[
              { key: 'ref', header: 'Reference', cell: (p: any) => <Link className="text-brand underline" to={`/payments/${p.id}`}>{p.reference}</Link> },
              { key: 'amt', header: 'Amount', align: 'right', cell: (p: any) => formatMoney(p.amount, p.currency) },
              { key: 'for', header: 'Used for', cell: (p: any) => p.consumedFor?.toLowerCase() },
              { key: 'st', header: 'Status', cell: (p: any) => <StatusBadge status={p.status} /> },
            ]}
          />
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title="Subscription events" description="Append-only renewal, upgrade, downgrade, suspension, revocation and override history" />
        <DataTable
          rows={s.events}
          rowKey={(e: any) => e.id}
          columns={[
            { key: 'at', header: 'When', cell: (e: any) => formatDateTime(e.createdAt) },
            { key: 'type', header: 'Event', cell: (e: any) => e.type.replace(/_/g, ' ').toLowerCase() },
            { key: 'chg', header: 'Status', cell: (e: any) => (e.toStatus ? <span className="flex items-center gap-1"><StatusBadge status={e.fromStatus} />→<StatusBadge status={e.toStatus} /></span> : '—') },
            { key: 'reason', header: 'Reason / data', cell: (e: any) => <span className="text-xs">{e.reason ?? (e.data ? JSON.stringify(e.data) : '—')}</span> },
          ]}
        />
      </Card>
      <RenewModal open={modal === 'renew'} onClose={() => setModal(null)} subscriptionId={id!} payments={(customer.data?.payments ?? []).filter((p: any) => p.status === 'VERIFIED' && !p.consumedAt)} onDone={refresh} />
      <ChangePlanModal open={modal === 'plan'} onClose={() => setModal(null)} subscription={s} plans={plans.data ?? []} onDone={refresh} />
      <CapacityModal open={modal === 'capacity'} onClose={() => setModal(null)} subscription={s} onDone={refresh} />
      <IssueCodeModal open={modal === 'code'} onClose={() => setModal(null)} subscriptionId={id!} onIssued={async (c) => { setIssued(c); await refresh(); }} />
      <Modal open={!!issued} onClose={() => setIssued(null)} title="Activation code generated" footer={<Button onClick={() => setIssued(null)}>I have recorded the code</Button>}>
        <Alert tone="warning" title="This code is shown only once">
          <span className="flex gap-2"><ShieldAlert className="h-4 w-4 flex-none" /> Copy it now and deliver it securely to the customer. Only a one-way hash is stored; it cannot be displayed again.</span>
        </Alert>
        <div className="mt-4 flex items-center gap-2 rounded-xl border-2 border-dashed border-brand/40 bg-brand/5 p-4">
          <code className="flex-1 break-all text-center text-lg font-bold tracking-wider text-brand">{issued?.code}</code>
          <Button size="sm" variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => navigator.clipboard?.writeText(issued!.code).then(() => toast.success('Copied'))}>
            Copy
          </Button>
        </div>
        <p className="mt-3 text-sm text-slate-500">Expires {formatDateTime(issued?.expiresAt)}. Single use, bound to this customer.</p>
      </Modal>
    </>
  );
}

function RenewModal({ open, onClose, subscriptionId, payments, onDone }: { open: boolean; onClose: () => void; subscriptionId: string; payments: any[]; onDone: () => Promise<void> }) {
  const { can } = useSession();
  const [paymentId, setPaymentId] = useState('');
  const [months, setMonths] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const toast = useToast();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Renew subscription"
      description="Extends the current period end (or today, if already expired) by the plan term. No new activation code is required."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={override ? reason.trim().length < 10 : !paymentId}
            onClick={async () => {
              try {
                await api.post(`/platform/subscriptions/${subscriptionId}/renew`, { paymentId: override ? null : paymentId, months: months ? Number(months) : undefined, override, overrideReason: override ? reason : null });
                toast.success('Subscription renewed');
                await onDone();
                onClose();
              } catch (e) {
                toast.error('Renewal failed', errorMessage(e));
              }
            }}
          >
            Renew
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!override && (
          <Field label="Verified renewal payment" required hint={payments.length ? undefined : 'Record and verify a payment for this customer first'}>
            {(p) => (
              <Select {...p} value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
                <option value="">Select payment…</option>
                {payments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {formatDate(x.paymentDate)} · {x.reference} · {formatMoney(x.amount, x.currency)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Months (optional)" hint="Defaults to the plan duration">{(p) => <Input {...p} type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} />}</Field>
        {can('platform.override') && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <Checkbox label="Commercial override (no payment) — audited" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            {override && <Textarea className="mt-2" aria-label="Override reason" placeholder="Reason (min 10 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ChangePlanModal({ open, onClose, subscription, plans, onDone }: { open: boolean; onClose: () => void; subscription: any; plans: any[]; onDone: () => Promise<void> }) {
  const [planId, setPlanId] = useState('');
  const [reason, setReason] = useState('');
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Change plan" description="Updates the entitlement snapshot. Employee records are never altered or deleted on downgrade." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!planId || reason.trim().length < 3} onClick={async () => { try { await api.post(`/platform/subscriptions/${subscription.id}/change-plan`, { planId, reason }); toast.success('Plan changed'); await onDone(); onClose(); } catch (e) { toast.error('Could not change plan', errorMessage(e)); } }}>Change plan</Button></>}>
      <div className="space-y-4">
        <Field label="New plan" required>
          {(p) => (
            <Select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Select…</option>
              {plans.filter((x) => x.isFree === subscription.plan.isFree && x.id !== subscription.planId && x.status === 'ACTIVE').map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.employeeLimit} employees / {x.userLimit} users)
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reason" required>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function CapacityModal({ open, onClose, subscription, onDone }: { open: boolean; onClose: () => void; subscription: any; onDone: () => Promise<void> }) {
  const [emp, setEmp] = useState('');
  const [users, setUsers] = useState('');
  const [reason, setReason] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setEmp(subscription.employeeLimitOverride ?? '');
      setUsers(subscription.userLimitOverride ?? '');
      setReason('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title="Adjust capacity" description="Blank = use plan defaults. Reducing capacity never deletes data; over-limit tenants simply cannot add more." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={reason.trim().length < 3} onClick={async () => { try { await api.post(`/platform/subscriptions/${subscription.id}/capacity`, { employeeLimitOverride: emp ? Number(emp) : null, userLimitOverride: users ? Number(users) : null, reason }); toast.success('Capacity updated'); await onDone(); onClose(); } catch (e) { toast.error('Could not update', errorMessage(e)); } }}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Employee limit (plan: ${subscription.plan.employeeLimit})`}>{(p) => <Input {...p} type="number" value={emp} onChange={(e) => setEmp(e.target.value)} />}</Field>
        <Field label={`User limit (plan: ${subscription.plan.userLimit})`}>{(p) => <Input {...p} type="number" value={users} onChange={(e) => setUsers(e.target.value)} />}</Field>
        <Field label="Reason" required className="sm:col-span-2">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function IssueCodeModal({ open, onClose, subscriptionId, onIssued }: { open: boolean; onClose: () => void; subscriptionId: string; onIssued: (c: { code: string; expiresAt: string }) => void }) {
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate activation code"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.post<{ code: string; expiresAt: string }>('/platform/codes', { subscriptionId, expiresInDays: Number(days) });
                onClose();
                onIssued(r);
              } catch (e) {
                toast.error('Could not generate code', errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Generate
          </Button>
        </>
      }
    >
      <Field label="Valid for (days)" hint="The code expires if not redeemed within this time">{(p) => <Input {...p} type="number" min={1} max={180} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
    </Modal>
  );
}

export function Licences() {
  const [page, setPage] = useState(1);
  const q = usePaged<any>(['licenses'], '/platform/licenses', { page });
  return (
    <>
      <PageHeader title="Licences" description="Entitlement snapshots per subscription (features and capacities applied to each tenant)" />
      <Card>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          columns={[
            { key: 'key', header: 'Licence key', cell: (r: any) => <code className="text-xs">{r.licenseKey}</code> },
            { key: 'cust', header: 'Customer', cell: (r: any) => <Link className="text-brand underline" to={`/subscriptions/${r.subscriptionId}`}>{r.subscription.customer.name}</Link> },
            { key: 'tenant', header: 'Tenant', cell: (r: any) => r.subscription.tenant?.displayName ?? '—' },
            { key: 'plan', header: 'Plan', cell: (r: any) => r.planName },
            { key: 'cap', header: 'Capacity', cell: (r: any) => `${r.employeeLimit} emp / ${r.userLimit} users` },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
            { key: 'act', header: 'Activated', hideOnMobile: true, cell: (r: any) => formatDateTime(r.activatedAt) },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
    </>
  );
}

export function Codes() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const q = usePaged<any>(['codes'], '/platform/codes', { page, status: status || undefined });
  return (
    <>
      <PageHeader title="Authorization codes" description="Codes are generated from a subscription awaiting activation. Raw values are never stored or shown again." />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Select className="w-44" aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All statuses</option>
            {['ISSUED', 'REDEEMED', 'EXPIRED', 'REVOKED'].map((s) => (
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
          columns={[
            { key: 'hint', header: 'Code hint', cell: (r: any) => <code className="text-xs">{r.codeHint}</code> },
            { key: 'cust', header: 'Customer', cell: (r: any) => r.customer.name },
            { key: 'sub', header: 'Subscription', cell: (r: any) => <Link className="text-brand underline" to={`/subscriptions/${r.subscriptionId}`}>{r.productCode}</Link> },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
            { key: 'exp', header: 'Expires', cell: (r: any) => formatDateTime(r.expiresAt) },
            { key: 'red', header: 'Redeemed', hideOnMobile: true, cell: (r: any) => formatDateTime(r.redeemedAt) },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
    </>
  );
}

export function Renewals() {
  const [days, setDays] = useState('30');
  const q = useApi<any[]>(['renewals', days], '/platform/renewals', { days });
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  return (
    <>
      <PageHeader
        title="Renewals & expirations"
        description="Current paid subscriptions ending soon, in grace or expired"
        actions={
          <>
            <Select className="w-40" aria-label="Horizon" value={days} onChange={(e) => setDays(e.target.value)}>
              {['30', '60', '90', '180'].map((d) => (
                <option key={d} value={d}>
                  Next {d} days
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              onClick={async () => {
                const r = await api.post<{ grace: number; expired: number }>('/platform/renewals/sweep');
                toast.success('Status sweep complete', `${r.grace} entered grace · ${r.expired} expired`);
                await qc.invalidateQueries({ queryKey: ['renewals'] });
              }}
            >
              Run status sweep
            </Button>
          </>
        }
      />
      <Card>
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => navigate(`/subscriptions/${r.id}`)}
          empty={<EmptyState title="Nothing due in this window" />}
          columns={[
            { key: 'cust', header: 'Customer', cell: (r: any) => <div><p className="font-medium">{r.customer.name}</p><p className="text-xs text-slate-500">{[r.customer.email, r.customer.phone].filter(Boolean).join(' · ')}</p></div> },
            { key: 'tenant', header: 'Tenant', cell: (r: any) => r.tenant },
            { key: 'plan', header: 'Plan', cell: (r: any) => r.plan },
            { key: 'end', header: 'Period end', cell: (r: any) => formatDate(r.periodEnd) },
            { key: 'days', header: 'Days left', align: 'right', cell: (r: any) => <span className={r.daysRemaining < 0 ? 'text-red-600' : r.daysRemaining <= 14 ? 'text-amber-600' : ''}>{r.daysRemaining}</span> },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
    </>
  );
}

export function Usage() {
  const q = useApi<any[]>(['usage'], '/platform/usage');
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <>
      <PageHeader title="Usage monitoring" description="Capacity counters per tenant (no HR or payroll content)" />
      <Card>
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          rowKey={(r: any) => r.tenantId}
          columns={[
            { key: 'tenant', header: 'Tenant', cell: (r: any) => r.tenant },
            { key: 'plan', header: 'Plan', cell: (r: any) => r.plan },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
            { key: 'emp', header: 'Employees', align: 'right', cell: (r: any) => <span className={pct(r.employees, r.employeeLimit) >= 90 ? 'font-semibold text-red-600' : ''}>{r.employees} / {r.employeeLimit}</span> },
            { key: 'users', header: 'Users', align: 'right', cell: (r: any) => <span className={pct(r.users, r.userLimit) >= 90 ? 'font-semibold text-red-600' : ''}>{r.users} / {r.userLimit}</span> },
            { key: 'end', header: 'Expires', cell: (r: any) => (r.periodEnd ? formatDate(r.periodEnd) : '—') },
          ]}
        />
      </Card>
    </>
  );
}

export function PlatformAudit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = usePaged<any>(['platform-audit'], '/platform/audit', { page, pageSize: 50, action: action || undefined });
  return (
    <>
      <PageHeader title="Platform audit log" description="Code issuance and redemption, payment verification/reversal, renewals, plan changes, suspensions and overrides" />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Input className="w-64" aria-label="Filter by action" placeholder="Action contains…" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} />
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          columns={[
            { key: 'at', header: 'When', cell: (r: any) => formatDateTime(r.createdAt) },
            { key: 'action', header: 'Action', cell: (r: any) => <code className="text-xs">{r.action}</code> },
            { key: 'entity', header: 'Entity', cell: (r: any) => `${r.entityType} ${r.entityId?.slice(0, 8) ?? ''}` },
            { key: 'actor', header: 'Actor', cell: (r: any) => r.actorEmail ?? 'system' },
            { key: 'reason', header: 'Reason', hideOnMobile: true, cell: (r: any) => r.reason ?? '—' },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
    </>
  );
}

export function Settings() {
  const { can, me } = useSession();
  const settings = useApi<any>(['platform-settings'], '/platform/settings');
  const staff = useApi<any[]>(['staff'], can('platform.staff.manage') ? '/platform/staff' : null);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const form = useZodForm<any>(staffSchema, { defaultValues: { platformRole: 'PLATFORM_LICENSING_OFFICER' } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/platform/staff', v);
      toast.success('Staff member added', 'A password-setup link was emailed.');
      await qc.invalidateQueries({ queryKey: ['staff'] });
      setAdding(false);
      form.reset({ platformRole: 'PLATFORM_LICENSING_OFFICER' });
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not add staff', errorMessage(x));
    }
  });
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Platform policy" description="Configured via environment (see deployment guide)" />
          <CardBody>
            {settings.data && (
              <KeyValue
                columns={1}
                items={[
                  { label: 'Payment gateway', value: settings.data.paymentGateway },
                  { label: 'Separate verifier required', value: settings.data.paymentRequiresSeparateVerifier ? 'Yes' : 'No' },
                  { label: 'MFA enforcement', value: settings.data.mfaEnforcement },
                  { label: 'Payroll compliance certified', value: settings.data.payrollComplianceCertified ? 'Yes' : 'No — not certified for live payroll' },
                  { label: 'Session idle timeout', value: `${settings.data.sessionIdleMinutes} minutes` },
                ]}
              />
            )}
          </CardBody>
        </Card>
        {can('platform.staff.manage') && (
          <Card className="lg:col-span-2">
            <CardHeader title="Qwik staff" description="Platform access is separate from tenant access" actions={<Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add staff</Button>} />
            <DataTable
              rows={staff.data}
              loading={staff.isLoading}
              rowKey={(r: any) => r.id}
              columns={[
                { key: 'name', header: 'Name', cell: (r: any) => <div><p className="font-medium">{r.fullName}</p><p className="text-xs text-slate-500">{r.email}</p></div> },
                { key: 'role', header: 'Role', cell: (r: any) => r.platformRole.replace('PLATFORM_', '').replace(/_/g, ' ').toLowerCase() },
                { key: 'mfa', header: 'MFA', cell: (r: any) => (r.mfaEnabledAt ? <Badge tone="green">Enrolled</Badge> : <Badge tone="yellow">Pending</Badge>) },
                { key: 'last', header: 'Last sign-in', hideOnMobile: true, cell: (r: any) => formatDateTime(r.lastLoginAt) },
                {
                  key: 'x',
                  header: '',
                  cell: (r: any) =>
                    r.id !== me!.user.id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600"
                        onClick={async () => {
                          const c = await confirm({ title: 'Remove platform access', message: `${r.fullName} will be signed out of the Licence Manager.`, tone: 'danger' });
                          if (!c.ok) return;
                          await api.post(`/platform/staff/${r.id}/disable`).catch((e) => toast.error('Failed', errorMessage(e)));
                          await qc.invalidateQueries({ queryKey: ['staff'] });
                        }}
                      >
                        Remove
                      </Button>
                    ),
                },
              ]}
            />
          </Card>
        )}
      </div>
      {can('platform.accounts.mfa_reset') && <MfaResetCard />}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add Qwik staff member" footer={<><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Add</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Full name" error={errors.fullName?.message} required>{(p) => <Input {...p} {...form.register('fullName')} />}</Field>
          <Field label="Email" error={errors.email?.message} required>{(p) => <Input {...p} type="email" {...form.register('email')} />}</Field>
          <Field label="Role" required>
            {(p) => (
              <Select {...p} {...form.register('platformRole')}>
                <option value="PLATFORM_LICENSING_OFFICER">Platform Licensing Officer</option>
                <option value="PLATFORM_SUPER_ADMIN">Platform Super Admin</option>
              </Select>
            )}
          </Field>
        </form>
      </Modal>
    </>
  );
}

/** Lost-authenticator recovery for any account; requires a recorded identity verification. */
function MfaResetCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const form = useZodForm<any>(platformMfaResetSchema, { defaultValues: { email: '', reason: '' } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    const c = await confirm({ title: 'Reset MFA', message: `${v.email} will be signed out of every session and must enrol a new authenticator at next sign-in. The reset is recorded in the platform audit log.`, tone: 'danger' });
    if (!c.ok) return;
    try {
      await api.post('/platform/accounts/reset-mfa', v);
      toast.success('MFA reset', 'The account holder has been notified by email.');
      form.reset({ email: '', reason: '' });
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not reset MFA', errorMessage(x));
    }
  });
  return (
    <Card className="mt-5">
      <CardHeader title="Reset an account's MFA" description="For a company's only administrator or a Qwik staff member who lost their authenticator. Verify identity out of band first (call-back to a known number, video call with ID)." />
      <CardBody>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <Field label="Account email" error={errors.email?.message} required>{(p) => <Input {...p} type="email" {...form.register('email')} />}</Field>
          <Field label="How was identity verified?" error={errors.reason?.message} required>{(p) => <Input {...p} {...form.register('reason')} />}</Field>
          <Button type="submit" variant="danger" loading={form.formState.isSubmitting}>Reset MFA</Button>
        </form>
      </CardBody>
    </Card>
  );
}
