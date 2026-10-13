import { useQueryClient } from '@tanstack/react-query';
import { payrollAdjustmentSchema, payrollRunCreateSchema } from '@yardhrms/types';
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
  Select,
  Spinner,
  StatCard,
  StatusBadge,
  cn,
  errorMessage,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  useConfirm,
  useToast,
} from '@yardhrms/ui';
import { Banknote, Calculator, CheckCircle2, ChevronRight, ClipboardCheck, FileDown, Lock, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DownloadButton, EmployeePicker, FormGrid, RefSelect, useReferenceData } from '@/components/common';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, usePaged, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { PayrollRun } from '@/lib/types';

const STAGES = ['DRAFT', 'PREPARED', 'REVIEWED', 'APPROVED', 'LOCKED'] as const;

function Lifecycle({ status }: { status: string }) {
  const idx = STAGES.indexOf(status as any);
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Payroll lifecycle">
      {STAGES.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', i < idx ? 'bg-brand/10 text-brand' : i === idx ? 'bg-brand text-white' : 'bg-slate-100 text-slate-400')} aria-current={i === idx ? 'step' : undefined}>
            {i < idx && <CheckCircle2 className="h-3.5 w-3.5" />}
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </span>
          {i < STAGES.length - 1 && <ChevronRight className="h-4 w-4 text-slate-300" />}
        </li>
      ))}
    </ol>
  );
}

export function PayrollRuns() {
  const { can, hasFeature, readOnly } = useSession();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const q = usePaged<PayrollRun>(['payroll-runs'], '/payroll-runs', { page, pageSize: 20, status: status || undefined });
  return (
    <>
      <PageHeader
        title="Payroll runs"
        description="Draft → Prepared → Reviewed → Approved → Locked. Approved runs are immutable; corrections use reversal runs."
        actions={
          can('payroll.prepare') &&
          hasFeature('PAYROLL') &&
          !readOnly && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New payroll run
            </Button>
          )
        }
      />
      <Card>
        <div className="flex gap-3 border-b border-slate-100 p-4">
          <Select className="w-44" aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All statuses</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <DataTable<PayrollRun>
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/app/payroll/runs/${r.id}`)}
          empty={<EmptyState icon={<Calculator className="h-6 w-6" />} title="No payroll runs yet" description="Create a run for a pay frequency and period." />}
          columns={[
            { key: 'run', header: 'Run', cell: (r) => <div><p className="font-mono text-xs font-medium">{r.runNumber}</p>{r.runType !== 'REGULAR' && <Badge tone={r.runType === 'REVERSAL' ? 'red' : 'blue'}>{r.runType.toLowerCase()}</Badge>}</div> },
            { key: 'freq', header: 'Frequency', cell: (r) => r.frequency.toLowerCase() },
            { key: 'period', header: 'Period', cell: (r) => `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` },
            { key: 'pay', header: 'Pay date', hideOnMobile: true, cell: (r) => formatDate(r.payDate) },
            { key: 'emp', header: 'Employees', align: 'right', hideOnMobile: true, cell: (r) => r.employeeCount },
            { key: 'net', header: 'Net', align: 'right', cell: (r) => formatMoney(r.netTotal) },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
      <CreateRunModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/app/payroll/runs/${id}`)} />
    </>
  );
}

function suggestedPeriod(freq: string) {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (freq === 'MONTHLY') {
    const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return { periodStart: iso(s), periodEnd: iso(e), payDate: iso(e) };
  }
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1);
  const len = freq === 'WEEKLY' ? 6 : 13;
  const e = new Date(d.getTime() + len * 86400000);
  return { periodStart: iso(d), periodEnd: iso(e), payDate: iso(new Date(e.getTime() - 2 * 86400000)) };
}

function CreateRunModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const ref = useReferenceData();
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(payrollRunCreateSchema, { defaultValues: { frequency: 'MONTHLY', runType: 'REGULAR', ...suggestedPeriod('MONTHLY') } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      const run = await api.post<PayrollRun>('/payroll-runs', { ...v, departmentId: v.departmentId || null });
      toast.success('Payroll run created', run.runNumber);
      await qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      onClose();
      onCreated(run.id);
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not create run', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} title="New payroll run" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Create run</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <FormGrid>
          <Field label="Pay frequency" required>
            {(p) => (
              <Select {...p} {...form.register('frequency', { onChange: (e) => Object.entries(suggestedPeriod(e.target.value)).forEach(([k, v]) => form.setValue(k, v)) })}>
                <option value="WEEKLY">Weekly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="MONTHLY">Monthly</option>
              </Select>
            )}
          </Field>
          <Field label="Run type" required hint="Supplemental runs pay only the adjustments you add">
            {(p) => (
              <Select {...p} {...form.register('runType')}>
                <option value="REGULAR">Regular</option>
                <option value="SUPPLEMENTAL">Supplemental</option>
              </Select>
            )}
          </Field>
          <Field label="Period start" error={errors.periodStart?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('periodStart')} />}
          </Field>
          <Field label="Period end" error={errors.periodEnd?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('periodEnd')} />}
          </Field>
          <Field label="Pay date" error={errors.payDate?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('payDate')} />}
          </Field>
          <Field label="Department (optional)">
            {(p) => <Controller control={form.control} name="departmentId" render={({ field }) => <RefSelect {...p} items={ref.data?.departments} value={field.value} onChange={field.onChange} placeholder="All departments" />} />}
          </Field>
        </FormGrid>
        <Field label="Notes" error={errors.notes?.message}>
          {(p) => <Input {...p} {...form.register('notes')} />}
        </Field>
      </form>
    </Modal>
  );
}

export function PayrollRunDetail() {
  const { id } = useParams();
  const { can, readOnly } = useSession();
  const q = useApi<any>(['payroll-run', id], `/payroll-runs/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <EmptyState title="Payroll run not found" />;
  const { run, employees, adjustments, ruleVersion, reversal } = q.data;
  const editable = ['DRAFT', 'PREPARED', 'REVIEWED'].includes(run.status) && run.runType !== 'REVERSAL';

  const transition = async (action: string, opts: { confirm?: { title: string; message: string; tone?: 'danger' | 'primary'; reason?: string }; method?: 'post' | 'del' } = {}) => {
    let body: Record<string, unknown> = {};
    if (opts.confirm) {
      const r = await confirm({ title: opts.confirm.title, message: opts.confirm.message, tone: opts.confirm.tone, confirmLabel: opts.confirm.title, requireReason: opts.confirm.reason });
      if (!r.ok) return;
      if (opts.confirm.reason) body = action === 'reverse' ? { reason: r.reason } : { comment: r.reason };
    }
    setBusy(action);
    try {
      if (opts.method === 'del') {
        await api.del(`/payroll-runs/${id}`);
        toast.success('Run deleted');
        await qc.invalidateQueries({ queryKey: ['payroll-runs'] });
        navigate('/app/payroll/runs');
        return;
      }
      const res: any = await api.post(`/payroll-runs/${id}/${action}`, body);
      if (action === 'prepare' && res.exceptions?.length) toast.info('Prepared with exceptions', `${res.exceptions.length} employee(s) could not be calculated — see the exceptions list.`);
      else toast.success(`Run ${action === 'reverse' ? 'reversal created' : action + (action.endsWith('e') ? 'd' : 'ed')}`);
      await qc.invalidateQueries({ queryKey: ['payroll-run', id] });
      await qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      if (action === 'reverse' && res.id) navigate(`/app/payroll/runs/${res.id}`);
    } catch (e) {
      toast.error('Action failed', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/app/payroll/runs" className="hover:underline">Payroll runs</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{run.runNumber}</span> <StatusBadge status={run.status} />
            {run.runType !== 'REGULAR' && <Badge tone={run.runType === 'REVERSAL' ? 'red' : 'blue'}>{run.runType.toLowerCase()}</Badge>}
          </span>
        }
        description={`${run.frequency.toLowerCase()} · ${formatDate(run.periodStart)} – ${formatDate(run.periodEnd)} · pay date ${formatDate(run.payDate)}`}
        actions={
          !readOnly && (
            <>
              {editable && can('payroll.prepare') && (
                <Button icon={<Calculator className="h-4 w-4" />} loading={busy === 'prepare'} onClick={() => transition('prepare')}>
                  {run.status === 'DRAFT' ? 'Calculate & prepare' : 'Recalculate'}
                </Button>
              )}
              {run.status === 'PREPARED' && can('payroll.review') && (
                <Button variant="outline" icon={<ClipboardCheck className="h-4 w-4" />} loading={busy === 'review'} onClick={() => transition('review')}>
                  Mark reviewed
                </Button>
              )}
              {['PREPARED', 'REVIEWED'].includes(run.status) && can('payroll.prepare') && run.runType !== 'REVERSAL' && (
                <Button variant="ghost" icon={<Undo2 className="h-4 w-4" />} loading={busy === 'reopen'} onClick={() => transition('reopen')}>
                  Return to draft
                </Button>
              )}
              {run.status === 'REVIEWED' && can('payroll.approve') && (
                <Button
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  loading={busy === 'approve'}
                  onClick={() => transition('approve', { confirm: { title: 'Approve payroll', message: 'Approval freezes this calculation as an immutable snapshot and issues payslips. Further changes require a reversal.' } })}
                >
                  Approve
                </Button>
              )}
              {run.status === 'APPROVED' && can('payroll.lock') && (
                <Button variant="outline" icon={<Lock className="h-4 w-4" />} loading={busy === 'lock'} onClick={() => transition('lock', { confirm: { title: 'Lock payroll', message: 'Locking closes the pay period for timesheet, leave and overtime changes.' } })}>
                  Lock
                </Button>
              )}
              {run.status === 'LOCKED' && run.runType !== 'REVERSAL' && !reversal && can('payroll.reverse') && (
                <Button
                  variant="danger"
                  icon={<RotateCcw className="h-4 w-4" />}
                  loading={busy === 'reverse'}
                  onClick={() => transition('reverse', { confirm: { title: 'Create reversal', message: 'A reversal run negating this payroll will be created and must be reviewed and approved. The original run is never edited.', tone: 'danger', reason: 'Reason for reversal' } })}
                >
                  Reverse
                </Button>
              )}
              {editable && can('payroll.prepare') && (
                <Button variant="ghost" aria-label="Delete run" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={() => transition('delete', { method: 'del', confirm: { title: 'Delete run', message: 'Delete this unapproved payroll run?', tone: 'danger' } })} />
              )}
            </>
          )
        }
      />
      <div className="mb-5">
        <Lifecycle status={run.status} />
      </div>
      {!run.complianceCertified && (
        <div className="mb-5">
          <Alert tone="warning" title="Not certified for live payroll">
            {ruleVersion ? `Rule version: ${ruleVersion.name} (${ruleVersion.status.toLowerCase()}). ` : ''}Statutory calculations must be verified by a qualified Jamaican payroll specialist before live use.
          </Alert>
        </div>
      )}
      {reversal && (
        <div className="mb-5">
          <Alert tone="info" title="This run has been reversed">
            Reversal run <Link className="font-medium underline" to={`/app/payroll/runs/${reversal.id}`}>{reversal.runNumber}</Link> ({reversal.status.toLowerCase()}).
          </Alert>
        </div>
      )}
      {run.exceptions?.length > 0 && (
        <div className="mb-5">
          <Alert tone="error" title={`${run.exceptions.length} employee(s) excluded — calculation exceptions`}>
            <ul className="mt-1 list-disc pl-5">
              {run.exceptions.map((x: any) => (
                <li key={x.employeeId}>
                  {x.name} ({x.employeeNumber}): {x.message}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Gross pay" value={formatMoney(run.grossTotal)} hint={`${run.employeeCount} employees`} />
        <StatCard label="Employee deductions" value={formatMoney(run.deductionTotal)} tone="amber" />
        <StatCard label="Net pay" value={formatMoney(run.netTotal)} tone="emerald" />
        <StatCard label="Employer contributions" value={formatMoney(run.employerTotal)} tone="violet" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Payroll register"
            actions={
              ['APPROVED', 'LOCKED'].includes(run.status) &&
              run.runType !== 'REVERSAL' &&
              can('payroll.export') && (
                <>
                  <DownloadButton path={`/payroll-runs/${id}/bank-file?format=csv`} method="POST" label="Bank file CSV" icon={<Banknote className="h-4 w-4" />} />
                  <DownloadButton path={`/payroll-runs/${id}/bank-file?format=xlsx`} method="POST" label="XLSX" />
                  {can('reports.export') && <DownloadButton path={`/reports/payroll-register?runId=${id}&format=xlsx`} label="Register" icon={<FileDown className="h-4 w-4" />} />}
                </>
              )
            }
          />
          <DataTable
            rows={employees}
            rowKey={(r: any) => r.id}
            onRowClick={(r: any) => setExpanded(expanded === r.id ? null : r.id)}
            empty={<EmptyState title="Not calculated yet" description="Use “Calculate & prepare” to compute pay from approved timesheets, overtime, leave and pay items." />}
            columns={[
              { key: 'emp', header: 'Employee', cell: (r: any) => <div><p className="font-medium">{r.employeeName}</p><p className="text-xs text-slate-500">{r.employeeNumber} · {r.departmentName ?? '—'}</p></div> },
              { key: 'gross', header: 'Gross', align: 'right', cell: (r: any) => formatMoney(r.grossPay, '') },
              { key: 'ded', header: 'Deductions', align: 'right', cell: (r: any) => formatMoney(r.totalDeductions, '') },
              { key: 'net', header: 'Net', align: 'right', cell: (r: any) => <span className="font-semibold">{formatMoney(r.netPay, '')}</span> },
              { key: 'er', header: 'Employer', align: 'right', hideOnMobile: true, cell: (r: any) => formatMoney(r.employerContributions, '') },
              { key: 'w', header: '', cell: (r: any) => (r.warnings?.length ? <Badge tone="yellow">{r.warnings.length} warning</Badge> : null) },
            ]}
          />
          {expanded && <RunEmployeeDetail row={employees.find((e: any) => e.id === expanded)} />}
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Approval trail" />
            <CardBody>
              <KeyValue
                columns={1}
                items={[
                  { label: 'Created', value: `${run.createdBy ?? '—'} · ${formatDateTime(run.createdAt)}` },
                  { label: 'Prepared', value: run.preparedAt ? `${run.preparedBy} · ${formatDateTime(run.preparedAt)}` : '—' },
                  { label: 'Reviewed', value: run.reviewedAt ? `${run.reviewedBy} · ${formatDateTime(run.reviewedAt)}` : '—' },
                  { label: 'Approved', value: run.approvedAt ? `${run.approvedBy} · ${formatDateTime(run.approvedAt)}` : '—' },
                  { label: 'Locked', value: run.lockedAt ? `${run.lockedBy} · ${formatDateTime(run.lockedAt)}` : '—' },
                  { label: 'Statutory rule version', value: ruleVersion ? `${ruleVersion.name}` : 'Not calculated' },
                  { label: 'Snapshot hash', value: run.snapshotHash ? <code className="break-all text-xs">{run.snapshotHash}</code> : '—' },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Adjustments" description="Bonus, commission, retro pay and one-off deductions" actions={editable && can('payroll.prepare') && !readOnly && <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setAdjusting(true)}>Add</Button>} />
            <CardBody className="space-y-2">
              {adjustments.length === 0 && <p className="text-sm text-slate-500">No adjustments.</p>}
              {adjustments.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <div>
                    <p className="font-medium">{a.description}</p>
                    <p className="text-xs text-slate-500">
                      {a.kind.toLowerCase()} · {employees.find((e: any) => e.employeeId === a.employeeId)?.employeeName ?? a.employeeId.slice(0, 8)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="tabular-nums">{formatMoney(a.amount, '')}</span>
                    {editable && can('payroll.prepare') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Remove adjustment"
                        icon={<Trash2 className="h-4 w-4 text-red-600" />}
                        onClick={async () => {
                          await api.del(`/payroll-runs/${id}/adjustments/${a.id}`).catch((e) => toast.error('Failed', errorMessage(e)));
                          await qc.invalidateQueries({ queryKey: ['payroll-run', id] });
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
              {adjustments.length > 0 && run.status === 'DRAFT' && <p className="text-xs text-amber-700">Recalculate to include adjustment changes.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
      <AdjustmentModal open={adjusting} onClose={() => setAdjusting(false)} runId={id!} frequency={run.frequency} />
    </>
  );
}

function RunEmployeeDetail({ row }: { row: any }) {
  if (!row) return null;
  return (
    <div className="border-t border-slate-100 bg-slate-50/60 p-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Earnings</p>
          {row.earnings.map((e: any) => (
            <div key={e.id} className="flex justify-between gap-2 py-0.5 text-sm">
              <span>
                {e.description}
                {e.quantity && <span className="text-slate-400"> · {formatNumber(e.quantity)} × {formatMoney(e.rate, '')}</span>}
                {!e.taxable && <span className="text-xs text-slate-400"> (non-taxable)</span>}
              </span>
              <span className="tabular-nums">{formatMoney(e.amount, '')}</span>
            </div>
          ))}
          <p className="mt-2 text-xs text-slate-500">Hourly equivalent: {formatMoney(row.hourlyEquivalent, '')} · Regular hours {formatNumber(row.regularHours)} · OT hours {formatNumber(row.overtimeHours)}</p>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Deductions & employer contributions</p>
          {row.deductions.map((d: any) => (
            <div key={d.id} className="flex justify-between gap-2 py-0.5 text-sm">
              <span>
                {d.description} {d.statutory && <span className="text-xs text-slate-400">({d.code})</span>}
              </span>
              <span className="tabular-nums">
                {formatMoney(d.employeeAmount, '')}
                {Number(d.employerAmount) !== 0 && <span className="text-xs text-violet-600"> + ER {formatMoney(d.employerAmount, '')}</span>}
              </span>
            </div>
          ))}
          {row.warnings?.map((w: string) => (
            <p key={w} className="mt-2 text-xs text-amber-700">
              ⚠ {w}
            </p>
          ))}
          {row.payslipId && (
            <div className="mt-3">
              <DownloadButton path={`/payslips/${row.payslipId}/download?inline=true`} open label="View payslip" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdjustmentModal({ open, onClose, runId, frequency }: { open: boolean; onClose: () => void; runId: string; frequency: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(payrollAdjustmentSchema, { defaultValues: { kind: 'BONUS', taxable: true, preTax: false } });
  const errors = form.formState.errors as any;
  const kind = form.watch('kind');
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/payroll-runs/${runId}/adjustments`, v);
      toast.success('Adjustment added', 'Recalculate the run to include it.');
      await qc.invalidateQueries({ queryKey: ['payroll-run', runId] });
      form.reset({ kind: 'BONUS', taxable: true, preTax: false });
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not add adjustment', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} title="Add payroll adjustment" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Add</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={`Employee (${frequency.toLowerCase()})`} error={errors.employeeId?.message} required>
          {(p) => <Controller control={form.control} name="employeeId" render={({ field }) => <EmployeePicker id={p.id} value={field.value ?? null} onChange={(v) => field.onChange(v)} />} />}
        </Field>
        <FormGrid>
          <Field label="Type" required>
            {(p) => (
              <Select {...p} {...form.register('kind')}>
                <option value="BONUS">Bonus</option>
                <option value="COMMISSION">Commission</option>
                <option value="RETRO">Retroactive pay</option>
                <option value="ALLOWANCE">One-off allowance</option>
                <option value="OTHER_EARNING">Other earning</option>
                <option value="DEDUCTION">One-off deduction</option>
              </Select>
            )}
          </Field>
          <Field label="Amount" error={errors.amount?.message} required>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('amount')} />}
          </Field>
        </FormGrid>
        <Field label="Description" error={errors.description?.message} required>
          {(p) => <Input {...p} {...form.register('description')} />}
        </Field>
        {kind === 'DEDUCTION' ? <Checkbox label="Pre-tax deduction" {...form.register('preTax')} /> : <Checkbox label="Taxable earning" {...form.register('taxable')} />}
      </form>
    </Modal>
  );
}

export function Payslips() {
  const { can, me } = useSession();
  const [page, setPage] = useState(1);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const toast = useToast();
  const q = usePaged<any>(['payslips'], '/payslips', { page, pageSize: 25, employeeId: employeeId ?? undefined, year: year || undefined });
  const print = async (id: string) => {
    try {
      await api.post(`/payslips/${id}/print-event`);
      await api.download(`/payslips/${id}/download?inline=true`, { open: true });
    } catch (e) {
      toast.error('Could not open payslip', errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader title="Payslips" description={can('payslips.print.any') ? 'Approved payslips for any employee. Every view, download and print is audited.' : 'Your approved payslips'} />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          {can('payslips.print.any') && (
            <div className="w-full sm:w-80">
              <EmployeePicker value={employeeId} onChange={(v) => (setEmployeeId(v), setPage(1))} allowSelf={!!me!.activeTenant!.employeeId} selfLabel="All employees" />
            </div>
          )}
          <Select className="w-32" aria-label="Year" value={year} onChange={(e) => (setYear(e.target.value), setPage(1))}>
            <option value="">All years</option>
            {Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          empty={<EmptyState title="No payslips" description="Payslips appear once a payroll run is approved." />}
          columns={[
            { key: 'emp', header: 'Employee', cell: (r: any) => <div><p className="font-medium">{r.employeeName}</p><p className="text-xs text-slate-500">{r.employeeNumber}</p></div> },
            { key: 'pay', header: 'Pay date', cell: (r: any) => formatDate(r.payDate) },
            { key: 'period', header: 'Period', hideOnMobile: true, cell: (r: any) => `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` },
            { key: 'run', header: 'Run', hideOnMobile: true, cell: (r: any) => <span className="font-mono text-xs">{r.runNumber}</span> },
            { key: 'gross', header: 'Gross', align: 'right', hideOnMobile: true, cell: (r: any) => formatMoney(r.grossPay, '') },
            { key: 'net', header: 'Net', align: 'right', cell: (r: any) => formatMoney(r.netPay, '') },
            {
              key: 'x',
              header: '',
              cell: (r: any) => (
                <div className="flex justify-end gap-1">
                  <DownloadButton path={`/payslips/${r.id}/download`} label="PDF" variant="ghost" />
                  <Button size="sm" variant="outline" onClick={() => print(r.id)}>
                    Print
                  </Button>
                </div>
              ),
            },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
    </>
  );
}
