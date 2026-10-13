import { useQueryClient } from '@tanstack/react-query';
import { leaveAdjustmentSchema, leavePolicySchema, leaveRequestSchema, leaveTypeSchema } from '@yardhrms/types';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StatusBadge, Tabs, Textarea, errorMessage, formatDate, formatNumber, useToast } from '@yardhrms/ui';
import { CalendarPlus, Plus, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller } from 'react-hook-form';
import { EmployeePicker, FormGrid, RefSelect, useReferenceData } from '@/components/common';
import { DecisionButtons, StatusFilter, SubjectCell } from '@/components/workflow';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, usePaged, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';

type Tab = 'requests' | 'approvals' | 'balances' | 'setup';

export function Leave() {
  const { can, readOnly, me } = useSession();
  const [tab, setTab] = useState<Tab>('requests');
  const [requesting, setRequesting] = useState(false);
  const canSubmit = !readOnly && (can('leave.submit.any') || (can('leave.submit.self') && !!me!.activeTenant!.employeeId));
  return (
    <>
      <PageHeader
        title="Leave"
        description="Requests, approvals, balances and leave policies"
        actions={
          canSubmit && (
            <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setRequesting(true)}>
              New leave request
            </Button>
          )
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'requests', label: can('leave.read.any') ? 'All requests' : 'My requests' },
          { value: 'approvals', label: 'Pending approvals', hidden: !can('leave.approve') },
          { value: 'balances', label: 'Balances' },
          { value: 'setup', label: 'Types & policies', hidden: !can('leave.policy.manage') && !can('leave.adjust') },
        ]}
      />
      {tab === 'requests' && <RequestList />}
      {tab === 'approvals' && <RequestList pendingOnly />}
      {tab === 'balances' && <Balances />}
      {tab === 'setup' && <LeaveSetup />}
      <LeaveRequestModal open={requesting} onClose={() => setRequesting(false)} />
    </>
  );
}

function RequestList({ pendingOnly }: { pendingOnly?: boolean }) {
  const { can, me } = useSession();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(pendingOnly ? 'PENDING' : '');
  const q = usePaged<any>(['leave-requests'], '/leave/requests', { page, pageSize: 25, status: status || undefined });
  return (
    <Card>
      {!pendingOnly && (
        <div className="flex gap-3 border-b border-slate-100 p-4">
          <StatusFilter value={status} onChange={(v) => (setStatus(v), setPage(1))} />
        </div>
      )}
      <DataTable
        rows={q.data?.items}
        loading={q.isLoading}
        rowKey={(r: any) => r.id}
        empty={<EmptyState title={pendingOnly ? 'Nothing waiting for approval' : 'No leave requests'} />}
        columns={[
          { key: 'emp', header: 'Employee', cell: (r: any) => <SubjectCell e={r.employee} submittedBy={r.submittedBy} delegated={r.delegated} /> },
          { key: 'type', header: 'Type', cell: (r: any) => r.leaveType.name },
          { key: 'dates', header: 'Dates', cell: (r: any) => `${formatDate(r.startDate)}${r.endDate !== r.startDate ? ` – ${formatDate(r.endDate)}` : ''}` },
          { key: 'days', header: 'Days', align: 'right', cell: (r: any) => formatNumber(r.workingDays) },
          { key: 'status', header: 'Status', cell: (r: any) => <div><StatusBadge status={r.status} />{r.decisionComment && <p className="mt-0.5 max-w-[200px] truncate text-xs text-slate-500" title={r.decisionComment}>{r.decisionComment}</p>}</div> },
          {
            key: 'x',
            header: '',
            cell: (r: any) => (
              <DecisionButtons
                base="/leave/requests"
                id={r.id}
                status={r.status}
                noun="leave request"
                canApprove={can('leave.approve') && r.employeeId !== me!.activeTenant!.employeeId}
                canCancel={r.employeeId === me!.activeTenant!.employeeId || can('leave.approve') || can('leave.submit.any')}
                invalidate={[['leave-requests'], ['leave-balances']]}
              />
            ),
          },
        ]}
      />
      {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
    </Card>
  );
}

function LeaveRequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can, me } = useSession();
  const ref = useReferenceData();
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(leaveRequestSchema, { defaultValues: { halfDayStart: false, halfDayEnd: false } });
  const errors = form.formState.errors as any;
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const start = form.watch('startDate');
  const end = form.watch('endDate');
  const hs = form.watch('halfDayStart');
  const he = form.watch('halfDayEnd');
  const subject = employeeId ?? me!.activeTenant!.employeeId;
  const balances = useApi<any[]>(['leave-balances', subject], subject ? '/leave/balances' : null, { employeeId: subject ?? undefined });
  useEffect(() => {
    if (!start || !end || end < start) return setDays(null);
    api
      .get<{ workingDays: number }>('/leave/working-days', { start, end, halfDayStart: hs, halfDayEnd: he })
      .then((r) => setDays(r.workingDays))
      .catch(() => setDays(null));
  }, [start, end, hs, he]);
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/leave/requests', { ...v, employeeId: employeeId ?? undefined });
      toast.success('Leave request submitted', 'It is now pending approval.');
      await qc.invalidateQueries({ queryKey: ['leave-requests'] });
      await qc.invalidateQueries({ queryKey: ['leave-balances'] });
      form.reset({ halfDayStart: false, halfDayEnd: false });
      setEmployeeId(null);
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not submit leave', errorMessage(x));
    }
  });
  const typeId = form.watch('leaveTypeId');
  const bal = balances.data?.find((b) => b.leaveTypeId === typeId);
  return (
    <Modal open={open} onClose={onClose} title="New leave request" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Submit request</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        {can('leave.submit.any') && (
          <Field label="Employee" hint="Submitting on behalf of another employee records you as the submitter; approval is separate.">
            {(p) => <EmployeePicker id={p.id} value={employeeId} onChange={(idv) => setEmployeeId(idv)} allowSelf={!!me!.activeTenant!.employeeId} selfLabel="Myself" />}
          </Field>
        )}
        <Field label="Leave type" error={errors.leaveTypeId?.message} required>
          {(p) => (
            <Controller control={form.control} name="leaveTypeId" render={({ field }) => <RefSelect {...p} items={ref.data?.leaveTypes} value={field.value} onChange={(v) => field.onChange(v ?? '')} placeholder="Select…" />} />
          )}
        </Field>
        {bal?.tracked && (
          <Alert tone={Number(bal.available) <= 0 ? 'warning' : 'info'}>
            Available balance: <strong>{formatNumber(bal.available)} days</strong> ({bal.pending} pending)
          </Alert>
        )}
        <FormGrid>
          <Field label="Start date" error={errors.startDate?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('startDate')} />}
          </Field>
          <Field label="End date" error={errors.endDate?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('endDate')} />}
          </Field>
        </FormGrid>
        <div className="flex flex-wrap gap-4">
          <Checkbox label="Half day at start" {...form.register('halfDayStart')} />
          <Checkbox label="Half day at end" {...form.register('halfDayEnd')} />
        </div>
        {days !== null && <p className="text-sm text-slate-600">Working days (excluding weekends & public holidays): <strong>{days}</strong></p>}
        <Field label="Reason" error={errors.reason?.message}>
          {(p) => <Textarea {...p} {...form.register('reason')} />}
        </Field>
      </form>
    </Modal>
  );
}

function Balances() {
  const { can, me } = useSession();
  const [employeeId, setEmployeeId] = useState<string | null>(me!.activeTenant!.employeeId);
  const q = useApi<any[]>(['leave-balances', employeeId], employeeId ? '/leave/balances' : null, { employeeId: employeeId ?? undefined });
  const ledger = useApi<any[]>(['leave-ledger', employeeId], employeeId ? '/leave/ledger' : null, { employeeId: employeeId ?? undefined });
  return (
    <div className="space-y-5">
      {can('leave.read.any') && (
        <Card>
          <CardBody>
            <Field label="Employee">{(p) => <EmployeePicker id={p.id} value={employeeId} onChange={setEmployeeId} />}</Field>
          </CardBody>
        </Card>
      )}
      {!employeeId ? (
        <EmptyState title="Choose an employee" description="Your account is not linked to an employee record." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {q.data
              ?.filter((b) => b.tracked)
              .map((b) => (
                <Card key={b.leaveTypeId}>
                  <CardBody>
                    <p className="text-sm font-medium text-slate-500">{b.leaveTypeName}</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">{formatNumber(b.available)}</p>
                    <p className="text-xs text-slate-500">days available · {formatNumber(b.balance)} balance · {formatNumber(b.pending)} pending</p>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                      <div>
                        <dt>Opening</dt>
                        <dd className="font-medium">{formatNumber(b.opening)}</dd>
                      </div>
                      <div>
                        <dt>Accrued</dt>
                        <dd className="font-medium">{formatNumber(b.accrued)}</dd>
                      </div>
                      <div>
                        <dt>Used</dt>
                        <dd className="font-medium">{formatNumber(b.used)}</dd>
                      </div>
                    </dl>
                  </CardBody>
                </Card>
              ))}
          </div>
          {q.data && !q.data.some((b) => b.tracked) && <Alert tone="info">No leave policies or opening balances apply to this employee yet.</Alert>}
          <Card>
            <CardHeader title="Leave ledger" description="Append-only history of openings, accruals, usage, adjustments and expiries" />
            <DataTable
              rows={ledger.data}
              loading={ledger.isLoading}
              rowKey={(r: any) => r.id}
              empty={<EmptyState title="No ledger entries" />}
              columns={[
                { key: 'date', header: 'Date', cell: (r: any) => formatDate(r.effectiveDate) },
                { key: 'type', header: 'Leave type', cell: (r: any) => r.leaveType.name },
                { key: 'entry', header: 'Entry', cell: (r: any) => <Badge tone={Number(r.days) >= 0 ? 'green' : 'yellow'}>{r.entryType.toLowerCase().replace('_', ' ')}</Badge> },
                { key: 'days', header: 'Days', align: 'right', cell: (r: any) => formatNumber(r.days) },
                { key: 'reason', header: 'Reason', hideOnMobile: true, cell: (r: any) => r.reason ?? '—' },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function LeaveSetup() {
  const { can, readOnly } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const ref = useReferenceData();
  const types = useApi<any[]>(['leave-types'], '/leave/types');
  const policies = useApi<any[]>(['leave-policies'], '/leave/policies');
  const [typeModal, setTypeModal] = useState<any | null>(null);
  const [policyModal, setPolicyModal] = useState(false);
  const [adjustModal, setAdjustModal] = useState(false);
  const [accrualDate, setAccrualDate] = useState(new Date().toISOString().slice(0, 10));
  const canManage = can('leave.policy.manage') && !readOnly;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Leave types" description="Categories, pay percentage (payroll impact) and documentation requirements" actions={canManage && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setTypeModal({})}>Add type</Button>} />
        <DataTable
          rows={types.data}
          loading={types.isLoading}
          rowKey={(r: any) => r.id}
          onRowClick={canManage ? (r: any) => setTypeModal(r) : undefined}
          columns={[
            { key: 'code', header: 'Code', cell: (r: any) => <span className="font-mono text-xs">{r.code}</span> },
            { key: 'name', header: 'Name', cell: (r: any) => r.name },
            { key: 'cat', header: 'Category', cell: (r: any) => r.category.toLowerCase() },
            { key: 'pay', header: 'Paid %', align: 'right', cell: (r: any) => `${formatNumber(r.payPercent)}%` },
            { key: 'doc', header: 'Document', hideOnMobile: true, cell: (r: any) => (r.requiresDocument ? 'Required' : '—') },
            { key: 'active', header: 'Status', cell: (r: any) => <StatusBadge status={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
          ]}
        />
      </Card>
      <Card>
        <CardHeader
          title="Leave policies"
          description="Entitlement, accrual method, carry-forward cap and expiry (effective-dated)"
          actions={canManage && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setPolicyModal(true)}>Add policy</Button>}
        />
        <DataTable
          rows={policies.data}
          loading={policies.isLoading}
          rowKey={(r: any) => r.id}
          empty={<EmptyState title="No leave policies" description="Without a policy, balances are not tracked for that leave type." />}
          columns={[
            { key: 'type', header: 'Leave type', cell: (r: any) => r.leaveType.name },
            { key: 'emp', header: 'Applies to', cell: (r: any) => ref.data?.employmentTypes.find((e) => e.id === r.employmentTypeId)?.name ?? 'All employment types' },
            { key: 'ent', header: 'Days / year', align: 'right', cell: (r: any) => formatNumber(r.annualEntitlementDays) },
            { key: 'acc', header: 'Accrual', cell: (r: any) => r.accrualMethod.toLowerCase().replace('_', ' ') },
            { key: 'cf', header: 'Carry-forward', hideOnMobile: true, cell: (r: any) => `${formatNumber(r.carryForwardMaxDays)} days${r.carryForwardExpiryMonths ? `, expires after ${r.carryForwardExpiryMonths} mo` : ''}` },
            { key: 'from', header: 'Effective', cell: (r: any) => formatDate(r.effectiveFrom) },
          ]}
        />
      </Card>
      {can('leave.adjust') && !readOnly && (
        <Card>
          <CardHeader title="Balance administration" description="Opening balances, manual adjustments and accrual posting (idempotent)" />
          <CardBody className="flex flex-wrap items-end gap-3">
            <Button variant="outline" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setAdjustModal(true)}>
              Post adjustment
            </Button>
            <div className="flex items-end gap-2">
              <Field label="Run accruals as of">{(p) => <Input {...p} type="date" value={accrualDate} onChange={(e) => setAccrualDate(e.target.value)} />}</Field>
              <Button
                onClick={async () => {
                  try {
                    const r = await api.post<{ posted: number }>('/leave/accruals/run', { asOf: accrualDate });
                    toast.success('Accruals processed', `${r.posted} new ledger entries posted`);
                    await qc.invalidateQueries({ queryKey: ['leave-balances'] });
                  } catch (x) {
                    toast.error('Accrual run failed', errorMessage(x));
                  }
                }}
              >
                Run accruals
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
      <LeaveTypeModal value={typeModal} onClose={() => setTypeModal(null)} />
      <PolicyModal open={policyModal} onClose={() => setPolicyModal(false)} />
      <AdjustModal open={adjustModal} onClose={() => setAdjustModal(false)} />
    </div>
  );
}

function LeaveTypeModal({ value, onClose }: { value: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(leaveTypeSchema, { values: value?.id ? { ...value, payPercent: Number(value.payPercent) } : { category: 'OTHER', payPercent: 100, requiresDocument: false, active: true } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      if (value?.id) await api.patch(`/leave/types/${value.id}`, v);
      else await api.post('/leave/types', v);
      toast.success('Leave type saved');
      await qc.invalidateQueries({ queryKey: ['leave-types'] });
      await qc.invalidateQueries({ queryKey: ['reference-data'] });
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save', errorMessage(x));
    }
  });
  return (
    <Modal open={!!value} onClose={onClose} title={value?.id ? 'Edit leave type' : 'Add leave type'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <FormGrid>
          <Field label="Code" error={errors.code?.message} required>
            {(p) => <Input {...p} {...form.register('code')} />}
          </Field>
          <Field label="Name" error={errors.name?.message} required>
            {(p) => <Input {...p} {...form.register('name')} />}
          </Field>
          <Field label="Category" required>
            {(p) => (
              <Select {...p} {...form.register('category')}>
                {['ANNUAL', 'SICK', 'MATERNITY', 'COMPASSIONATE', 'UNPAID', 'STUDY', 'SPECIAL', 'OTHER'].map((c) => (
                  <option key={c} value={c}>
                    {c.toLowerCase()}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Pay percentage" hint="100 = fully paid, 0 = unpaid (reduces salaried pay)" error={errors.payPercent?.message} required>
            {(p) => <Input {...p} type="number" min={0} max={100} {...form.register('payPercent')} />}
          </Field>
        </FormGrid>
        <div className="flex gap-4">
          <Checkbox label="Requires supporting document" {...form.register('requiresDocument')} />
          <Checkbox label="Active" {...form.register('active')} />
        </div>
      </form>
    </Modal>
  );
}

function PolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const ref = useReferenceData();
  const form = useZodForm<any>(leavePolicySchema, { defaultValues: { accrualMethod: 'ANNUAL_GRANT', carryForwardMaxDays: '0', carryForwardExpiryMonths: 0, minServiceMonths: 0, effectiveFrom: `${new Date().getFullYear()}-01-01` } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/leave/policies', { ...v, employmentTypeId: v.employmentTypeId || null });
      toast.success('Policy added');
      await qc.invalidateQueries({ queryKey: ['leave-policies'] });
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} title="Add leave policy" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <Alert tone="info">Entitlement values are your company policy. Confirm statutory minimums with your HR/legal adviser.</Alert>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormGrid>
          <Field label="Leave type" error={errors.leaveTypeId?.message} required>
            {(p) => <Controller control={form.control} name="leaveTypeId" render={({ field }) => <RefSelect {...p} items={ref.data?.leaveTypes} value={field.value} onChange={(v) => field.onChange(v ?? '')} placeholder="Select…" />} />}
          </Field>
          <Field label="Employment type" hint="Blank = all">
            {(p) => <Controller control={form.control} name="employmentTypeId" render={({ field }) => <RefSelect {...p} items={ref.data?.employmentTypes} value={field.value} onChange={field.onChange} placeholder="All employment types" />} />}
          </Field>
          <Field label="Annual entitlement (days)" error={errors.annualEntitlementDays?.message} required>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('annualEntitlementDays')} />}
          </Field>
          <Field label="Accrual method" required>
            {(p) => (
              <Select {...p} {...form.register('accrualMethod')}>
                <option value="ANNUAL_GRANT">Annual grant (1 January)</option>
                <option value="MONTHLY_ACCRUAL">Monthly accrual (1/12 per month)</option>
                <option value="NONE">None (manual)</option>
              </Select>
            )}
          </Field>
          <Field label="Carry-forward cap (days)" error={errors.carryForwardMaxDays?.message} required>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('carryForwardMaxDays')} />}
          </Field>
          <Field label="Carried days expire after (months)" error={errors.carryForwardExpiryMonths?.message}>
            {(p) => <Input {...p} type="number" min={0} {...form.register('carryForwardExpiryMonths')} />}
          </Field>
          <Field label="Minimum service (months)" error={errors.minServiceMonths?.message}>
            {(p) => <Input {...p} type="number" min={0} {...form.register('minServiceMonths')} />}
          </Field>
          <Field label="Effective from" error={errors.effectiveFrom?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('effectiveFrom')} />}
          </Field>
        </FormGrid>
      </form>
    </Modal>
  );
}

function AdjustModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const ref = useReferenceData();
  const form = useZodForm<any>(leaveAdjustmentSchema, { defaultValues: { entryType: 'ADJUSTMENT', effectiveDate: new Date().toISOString().slice(0, 10) } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/leave/adjustments', v);
      toast.success('Adjustment posted');
      await qc.invalidateQueries({ queryKey: ['leave-balances'] });
      await qc.invalidateQueries({ queryKey: ['leave-ledger'] });
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not post adjustment', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} title="Post leave adjustment" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Post</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Employee" error={errors.employeeId?.message} required>
          {(p) => <Controller control={form.control} name="employeeId" render={({ field }) => <EmployeePicker id={p.id} value={field.value ?? null} onChange={(v) => field.onChange(v)} />} />}
        </Field>
        <FormGrid>
          <Field label="Leave type" error={errors.leaveTypeId?.message} required>
            {(p) => <Controller control={form.control} name="leaveTypeId" render={({ field }) => <RefSelect {...p} items={ref.data?.leaveTypes} value={field.value} onChange={(v) => field.onChange(v ?? '')} placeholder="Select…" />} />}
          </Field>
          <Field label="Entry type" required>
            {(p) => (
              <Select {...p} {...form.register('entryType')}>
                <option value="OPENING">Opening balance</option>
                <option value="ADJUSTMENT">Adjustment</option>
                <option value="ACCRUAL">Manual accrual</option>
                <option value="CARRY_FORWARD">Carry-forward</option>
                <option value="EXPIRY">Expiry (enter negative)</option>
              </Select>
            )}
          </Field>
          <Field label="Days (+/−)" error={errors.days?.message} required>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('days')} />}
          </Field>
          <Field label="Effective date" error={errors.effectiveDate?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('effectiveDate')} />}
          </Field>
        </FormGrid>
        <Field label="Reason" error={errors.reason?.message} required>
          {(p) => <Input {...p} {...form.register('reason')} />}
        </Field>
      </form>
    </Modal>
  );
}
