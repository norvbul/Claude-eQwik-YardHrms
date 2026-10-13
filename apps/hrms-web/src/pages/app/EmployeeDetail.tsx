import { useQueryClient } from '@tanstack/react-query';
import { bankAccountSchema, compensationChangeSchema, emergencyContactSchema, employeeAllowanceSchema, employeeDeductionSchema } from '@yardhrms/types';
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
  Select,
  Spinner,
  StatusBadge,
  Tabs,
  errorMessage,
  formatDate,
  formatDateTime,
  formatMoney,
  useConfirm,
  useToast,
} from '@yardhrms/ui';
import { Eye, Paperclip, Pencil, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DownloadButton, FormGrid, useReferenceData } from '@/components/common';
import { api } from '@/lib/api';
import { applyServerErrors, useAction, useApi, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Employee } from '@/lib/types';
import { EmployeeForm } from './EmployeeForm';

type Tab = 'overview' | 'pay' | 'bank' | 'contacts' | 'documents' | 'history';

export function EmployeeDetail({ selfService }: { selfService?: boolean }) {
  const params = useParams();
  const { me, can, readOnly } = useSession();
  const id = selfService ? me!.activeTenant!.employeeId! : params.id!;
  const [tab, setTab] = useState<Tab>('overview');
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const q = useApi<Employee>(['employee', id], `/employees/${id}`, reveal ? { reveal: 'true' } : undefined);
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const e = q.data;
  if (q.isLoading) return <Spinner />;
  if (!e) return <EmptyState title="Employee not found" description="The record does not exist or you do not have access to it." />;
  const canWrite = can('employees.write') && !readOnly && !selfService;

  const statusAction = async (action: 'deactivate' | 'terminate' | 'reactivate') => {
    const r = await confirm({
      title: action === 'reactivate' ? 'Reactivate employee' : action === 'terminate' ? 'Terminate employment' : 'Deactivate employee',
      message: action === 'reactivate' ? 'Reactivated employees count against your plan’s employee limit.' : 'Historical payroll, leave and audit records are preserved.',
      confirmLabel: action === 'reactivate' ? 'Reactivate' : action === 'terminate' ? 'Terminate' : 'Deactivate',
      tone: action === 'reactivate' ? 'primary' : 'danger',
      requireReason: 'Reason',
    });
    if (!r.ok) return;
    try {
      await api.post(`/employees/${id}/${action === 'reactivate' ? 'reactivate' : 'deactivate'}`, { reason: r.reason, terminate: action === 'terminate' });
      toast.success('Employee status updated');
      await qc.invalidateQueries({ queryKey: ['employee', id] });
      await qc.invalidateQueries({ queryKey: ['employees'] });
    } catch (x) {
      toast.error('Could not update status', errorMessage(x));
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={!selfService && <Link to="/app/employees" className="hover:underline">Employees</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {e.firstName} {e.lastName} <StatusBadge status={e.status} />
          </span>
        }
        description={`${e.employeeNumber} · ${e.position?.name ?? 'No position'} · ${e.department?.name ?? 'No department'}`}
        actions={
          canWrite && (
            <>
              <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              {e.status === 'ACTIVE' ? (
                <>
                  <Button variant="outline" icon={<UserMinus className="h-4 w-4" />} onClick={() => statusAction('deactivate')}>
                    Deactivate
                  </Button>
                  <Button variant="danger" onClick={() => statusAction('terminate')}>
                    Terminate
                  </Button>
                </>
              ) : (
                <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => statusAction('reactivate')}>
                  Reactivate
                </Button>
              )}
              <Button
                variant="ghost"
                aria-label="Delete employee"
                icon={<Trash2 className="h-4 w-4 text-red-600" />}
                onClick={async () => {
                  const r = await confirm({ title: 'Delete employee record', message: 'The record is soft-deleted and hidden. Payroll history and audit records are retained.', tone: 'danger', confirmLabel: 'Delete', requireReason: 'Reason for deletion' });
                  if (!r.ok) return;
                  try {
                    await api.del(`/employees/${id}`, { reason: r.reason });
                    toast.success('Employee deleted');
                    navigate('/app/employees');
                  } catch (x) {
                    toast.error('Could not delete', errorMessage(x));
                  }
                }}
              />
            </>
          )
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'pay', label: 'Pay & compensation', hidden: !e.compensationVisible },
          { value: 'bank', label: 'Bank accounts', hidden: !can('compensation.read') && !can('employees.sensitive.read') },
          { value: 'contacts', label: 'Emergency contacts' },
          { value: 'documents', label: 'Documents', hidden: !can('employees.documents.manage') && !selfService },
          { value: 'history', label: 'History' },
        ]}
      />
      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Personal & contact"
              actions={
                can('employees.sensitive.read') && (
                  <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={() => setReveal((r) => !r)}>
                    {reveal ? 'Hide identifiers' : 'Reveal identifiers'}
                  </Button>
                )
              }
            />
            <CardBody>
              <KeyValue
                items={[
                  { label: 'Full name', value: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ') },
                  { label: 'Preferred name', value: e.preferredName },
                  { label: 'Date of birth', value: formatDate(e.dateOfBirth) },
                  { label: 'Gender', value: e.gender?.toLowerCase() },
                  { label: 'Email', value: e.email },
                  { label: 'Phone', value: e.phone ?? e.mobile },
                  { label: 'Address', value: [e.addressLine1, e.addressLine2, e.city, e.parish].filter(Boolean).join(', ') || null },
                  { label: 'TRN', value: <span className="font-mono">{e.trn ?? '—'}</span> },
                  { label: 'NIS', value: <span className="font-mono">{e.nisNumber ?? '—'}</span> },
                  { label: 'NHT', value: <span className="font-mono">{e.nhtNumber ?? '—'}</span> },
                ]}
              />
              {reveal && e.identifiersRevealed && <p className="mt-4 text-xs text-amber-700">Identifier access has been recorded in the audit log.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Employment" />
            <CardBody>
              <KeyValue
                columns={1}
                items={[
                  { label: 'Department', value: e.department?.name },
                  { label: 'Branch', value: e.branch?.name },
                  { label: 'Position', value: e.position?.name },
                  { label: 'Employment type', value: e.employmentType?.name },
                  { label: 'Supervisor', value: e.supervisor ? `${e.supervisor.firstName} ${e.supervisor.lastName}` : null },
                  { label: 'Hire date', value: formatDate(e.hireDate) },
                  { label: 'Probation ends', value: formatDate(e.probationEndDate) },
                  { label: 'Termination', value: e.terminationDate ? `${formatDate(e.terminationDate)} — ${e.terminationReason ?? ''}` : null },
                  { label: 'Pay frequency', value: `${e.payFrequency.toLowerCase()} (${e.payType.toLowerCase()})` },
                  { label: 'Overtime eligible', value: e.overtimeEligible ? 'Yes' : 'No' },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      )}
      {tab === 'pay' && <PayTab employee={e} canEdit={can('compensation.write') && !readOnly && !selfService} />}
      {tab === 'bank' && <BankTab employeeId={id} canEdit={can('compensation.write') && !readOnly} canReveal={can('employees.sensitive.read')} />}
      {tab === 'contacts' && <ContactsTab employeeId={id} canEdit={canWrite} />}
      {tab === 'documents' && <DocumentsTab employeeId={id} canEdit={can('employees.documents.manage') && !readOnly} />}
      {tab === 'history' && <HistoryTab employeeId={id} />}
      {canWrite && <EmployeeForm open={editing} onClose={() => setEditing(false)} employee={e} onSaved={() => qc.invalidateQueries({ queryKey: ['employee', id] })} />}
    </>
  );
}

function PayTab({ employee: e, canEdit }: { employee: Employee; canEdit: boolean }) {
  const { can } = useSession();
  const [changing, setChanging] = useState(false);
  const history = useApi<any[]>(['comp-history', e.id], can('compensation.read') ? `/employees/${e.id}/compensation-history` : null);
  const items = useApi<{ allowances: any[]; deductions: any[] }>(['pay-items', e.id], can('compensation.read') ? `/employees/${e.id}/pay-items` : null);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Current compensation" actions={canEdit && <Button size="sm" onClick={() => setChanging(true)}>Change compensation</Button>} />
        <CardBody>
          <KeyValue
            columns={3}
            items={[
              { label: 'Pay frequency', value: e.payFrequency.toLowerCase() },
              { label: 'Pay type', value: e.payType.toLowerCase() },
              { label: e.payType === 'SALARY' ? 'Salary per period' : 'Hourly rate', value: formatMoney(e.payType === 'SALARY' ? e.salaryPerPeriod : e.hourlyRate) },
              { label: 'Standard hours override', value: e.standardHoursOverride ?? 'Pay-frequency default' },
              { label: 'Overtime eligible', value: e.overtimeEligible ? 'Yes' : 'No' },
              { label: 'Statutory exemptions', value: e.statutoryExemptions.length ? e.statutoryExemptions.join(', ') : 'None' },
            ]}
          />
        </CardBody>
      </Card>
      {can('compensation.read') && <PayItems employeeId={e.id} data={items.data} canEdit={canEdit} />}
      {can('compensation.read') && (
        <Card>
          <CardHeader title="Compensation history" description="Every change records author, reason and effective date" />
          <DataTable
            rows={history.data}
            loading={history.isLoading}
            rowKey={(r: any) => r.id}
            columns={[
              { key: 'effectiveDate', header: 'Effective', cell: (r: any) => formatDate(r.effectiveDate) },
              { key: 'freq', header: 'Frequency / type', cell: (r: any) => `${r.payFrequency.toLowerCase()} · ${r.payType.toLowerCase()}` },
              { key: 'amount', header: 'Amount', align: 'right', cell: (r: any) => formatMoney(r.payType === 'SALARY' ? r.salaryPerPeriod : r.hourlyRate) },
              { key: 'reason', header: 'Reason', cell: (r: any) => r.reason },
              { key: 'at', header: 'Recorded', hideOnMobile: true, cell: (r: any) => formatDateTime(r.createdAt) },
            ]}
          />
        </Card>
      )}
      <CompensationModal open={changing} onClose={() => setChanging(false)} employee={e} />
    </div>
  );
}

function CompensationModal({ open, onClose, employee: e }: { open: boolean; onClose: () => void; employee: Employee }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(compensationChangeSchema, {
    values: { effectiveDate: new Date().toISOString().slice(0, 10), payFrequency: e.payFrequency, payType: e.payType, salaryPerPeriod: e.salaryPerPeriod ?? '', hourlyRate: e.hourlyRate ?? '', standardHoursOverride: e.standardHoursOverride ?? '', overtimeEligible: e.overtimeEligible, reason: '' },
  });
  const errors = form.formState.errors as any;
  const payType = form.watch('payType');
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/employees/${e.id}/compensation`, { ...v, salaryPerPeriod: v.salaryPerPeriod || null, hourlyRate: v.hourlyRate || null, standardHoursOverride: v.standardHoursOverride || null });
      toast.success('Compensation updated');
      await qc.invalidateQueries({ queryKey: ['employee', e.id] });
      await qc.invalidateQueries({ queryKey: ['comp-history', e.id] });
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not update compensation', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} title="Change compensation" description="Applies to future payroll runs; approved payroll is unaffected." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <FormGrid>
          <Field label="Effective date" error={errors.effectiveDate?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('effectiveDate')} />}
          </Field>
          <Field label="Pay frequency" required>
            {(p) => (
              <Select {...p} {...form.register('payFrequency', { onChange: (ev) => ev.target.value === 'MONTHLY' && form.setValue('payType', 'SALARY') })}>
                <option value="WEEKLY">Weekly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="MONTHLY">Monthly</option>
              </Select>
            )}
          </Field>
          <Field label="Pay type" error={errors.payType?.message} required>
            {(p) => (
              <Select {...p} {...form.register('payType')}>
                <option value="SALARY">Salary</option>
                <option value="HOURLY">Hourly</option>
              </Select>
            )}
          </Field>
          {payType === 'SALARY' ? (
            <Field label="Salary per period" error={errors.salaryPerPeriod?.message} required>
              {(p) => <Input {...p} inputMode="decimal" {...form.register('salaryPerPeriod')} />}
            </Field>
          ) : (
            <Field label="Hourly rate" error={errors.hourlyRate?.message} required>
              {(p) => <Input {...p} inputMode="decimal" {...form.register('hourlyRate')} />}
            </Field>
          )}
          <Field label="Standard hours override" error={errors.standardHoursOverride?.message}>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('standardHoursOverride')} />}
          </Field>
          <div className="flex items-end">
            <Checkbox label="Overtime eligible" {...form.register('overtimeEligible')} />
          </div>
        </FormGrid>
        <Field label="Reason" error={errors.reason?.message} required>
          {(p) => <Input {...p} {...form.register('reason')} placeholder="e.g. Annual increase" />}
        </Field>
      </form>
    </Modal>
  );
}

function PayItems({ employeeId, data, canEdit }: { employeeId: string; data?: { allowances: any[]; deductions: any[] }; canEdit: boolean }) {
  const ref = useReferenceData();
  const [adding, setAdding] = useState<'allowance' | 'deduction' | null>(null);
  const remove = useAction((p: { kind: string; id: string }) => api.del(`/employees/${employeeId}/${p.kind}/${p.id}`), { success: 'Removed', invalidate: [['pay-items', employeeId]] });
  return (
    <Card>
      <CardHeader
        title="Recurring allowances & deductions"
        description="Included automatically in each payroll period while active"
        actions={
          canEdit && (
            <>
              <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding('allowance')}>
                Allowance
              </Button>
              <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding('deduction')}>
                Deduction
              </Button>
            </>
          )
        }
      />
      <DataTable
        rows={[...(data?.allowances ?? []).map((a) => ({ ...a, kind: 'allowances', label: a.allowanceType.name, extra: a.allowanceType.taxable ? 'Taxable' : 'Non-taxable' })), ...(data?.deductions ?? []).map((d) => ({ ...d, kind: 'deductions', label: d.deductionType.name, extra: `${d.deductionType.category.toLowerCase()}${d.deductionType.preTax ? ' · pre-tax' : ''}${d.balance ? ` · balance ${formatMoney(d.balance)}` : ''}` }))]}
        rowKey={(r: any) => r.id}
        empty={<EmptyState title="No recurring items" />}
        columns={[
          { key: 'type', header: 'Type', cell: (r: any) => <Badge tone={r.kind === 'allowances' ? 'green' : 'yellow'}>{r.kind === 'allowances' ? 'Allowance' : 'Deduction'}</Badge> },
          { key: 'label', header: 'Item', cell: (r: any) => r.label },
          { key: 'extra', header: 'Details', hideOnMobile: true, cell: (r: any) => r.extra },
          { key: 'amount', header: 'Per period', align: 'right', cell: (r: any) => formatMoney(r.amount) },
          { key: 'dates', header: 'Active', hideOnMobile: true, cell: (r: any) => `${formatDate(r.startDate)} → ${r.endDate ? formatDate(r.endDate) : 'ongoing'}` },
          { key: 'x', header: '', cell: (r: any) => canEdit && <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => remove.mutate({ kind: r.kind, id: r.id })} icon={<Trash2 className="h-4 w-4 text-red-600" />} /> },
        ]}
      />
      <PayItemModal kind={adding} onClose={() => setAdding(null)} employeeId={employeeId} types={adding === 'allowance' ? ref.data?.allowanceTypes : ref.data?.deductionTypes} />
    </Card>
  );
}

function PayItemModal({ kind, onClose, employeeId, types }: { kind: 'allowance' | 'deduction' | null; onClose: () => void; employeeId: string; types?: { id: string; name: string; active: boolean }[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(kind === 'deduction' ? employeeDeductionSchema : employeeAllowanceSchema, { values: { startDate: new Date().toISOString().slice(0, 10) } as any });
  const errors = form.formState.errors as any;
  const typeKey = kind === 'deduction' ? 'deductionTypeId' : 'allowanceTypeId';
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/employees/${employeeId}/${kind === 'deduction' ? 'deductions' : 'allowances'}`, { ...v, endDate: v.endDate || null, balance: v.balance || null, reference: v.reference || null });
      toast.success('Saved');
      await qc.invalidateQueries({ queryKey: ['pay-items', employeeId] });
      form.reset();
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save', errorMessage(x));
    }
  });
  return (
    <Modal open={!!kind} onClose={onClose} title={kind === 'deduction' ? 'Add recurring deduction' : 'Add recurring allowance'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
      {!types?.length && <Alert tone="warning">No {kind} types are configured. Add them in Payroll Setup.</Alert>}
      <form onSubmit={submit} className="mt-3 space-y-4">
        <Field label="Type" error={errors[typeKey]?.message} required>
          {(p) => (
            <Select {...p} {...form.register(typeKey)}>
              <option value="">Select…</option>
              {types?.filter((t) => t.active).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <FormGrid>
          <Field label="Amount per period" error={errors.amount?.message} required>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('amount')} />}
          </Field>
          {kind === 'deduction' && (
            <Field label="Outstanding balance (loans/advances)" hint="Deduction stops when the balance reaches zero" error={errors.balance?.message}>
              {(p) => <Input {...p} inputMode="decimal" {...form.register('balance')} />}
            </Field>
          )}
          <Field label="Start date" error={errors.startDate?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('startDate')} />}
          </Field>
          <Field label="End date" error={errors.endDate?.message}>
            {(p) => <Input {...p} type="date" {...form.register('endDate')} />}
          </Field>
          {kind === 'deduction' && (
            <Field label="Reference" error={errors.reference?.message}>
              {(p) => <Input {...p} {...form.register('reference')} />}
            </Field>
          )}
        </FormGrid>
      </form>
    </Modal>
  );
}

function BankTab({ employeeId, canEdit, canReveal }: { employeeId: string; canEdit: boolean; canReveal: boolean }) {
  const [reveal, setReveal] = useState(false);
  const [adding, setAdding] = useState(false);
  const q = useApi<any[]>(['bank', employeeId], `/employees/${employeeId}/bank-accounts`, reveal ? { reveal: 'true' } : undefined);
  const remove = useAction((aid: string) => api.del(`/employees/${employeeId}/bank-accounts/${aid}`), { success: 'Bank account removed', invalidate: [['bank', employeeId]] });
  const toast = useToast();
  const qc = useQueryClient();
  const form = useZodForm<any>(bankAccountSchema, { defaultValues: { accountType: 'SAVINGS', isPrimary: true } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/employees/${employeeId}/bank-accounts`, v);
      toast.success('Bank account added');
      await qc.invalidateQueries({ queryKey: ['bank', employeeId] });
      form.reset({ accountType: 'SAVINGS', isPrimary: true });
      setAdding(false);
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save', errorMessage(x));
    }
  });
  return (
    <Card>
      <CardHeader
        title="Bank accounts"
        description="Account numbers are encrypted at rest; the primary account is used for bank files"
        actions={
          <>
            {canReveal && (
              <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={() => setReveal((r) => !r)}>
                {reveal ? 'Mask' : 'Reveal'}
              </Button>
            )}
            {canEdit && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                Add account
              </Button>
            )}
          </>
        }
      />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r: any) => r.id}
        empty={<EmptyState title="No bank accounts" description="Employees without a primary account are flagged when generating bank files." />}
        columns={[
          { key: 'bank', header: 'Bank', cell: (r: any) => `${r.bankName}${r.branchName ? ` · ${r.branchName}` : ''}` },
          { key: 'type', header: 'Type', cell: (r: any) => r.accountType.toLowerCase() },
          { key: 'acct', header: 'Account', cell: (r: any) => <span className="font-mono">{r.accountNumber}</span> },
          { key: 'holder', header: 'Holder', hideOnMobile: true, cell: (r: any) => r.accountHolder },
          { key: 'primary', header: '', cell: (r: any) => r.isPrimary && <Badge tone="green">Primary</Badge> },
          { key: 'x', header: '', cell: (r: any) => canEdit && <Button size="sm" variant="ghost" aria-label="Remove account" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={() => remove.mutate(r.id)} /> },
        ]}
      />
      <Modal open={adding} onClose={() => setAdding(false)} title="Add bank account" footer={<><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <FormGrid>
            <Field label="Bank name" error={errors.bankName?.message} required>
              {(p) => <Input {...p} {...form.register('bankName')} />}
            </Field>
            <Field label="Branch" error={errors.branchName?.message}>
              {(p) => <Input {...p} {...form.register('branchName')} />}
            </Field>
            <Field label="Branch / transit code" error={errors.branchCode?.message}>
              {(p) => <Input {...p} {...form.register('branchCode')} />}
            </Field>
            <Field label="Account type" required>
              {(p) => (
                <Select {...p} {...form.register('accountType')}>
                  <option value="SAVINGS">Savings</option>
                  <option value="CHEQUING">Chequing</option>
                  <option value="OTHER">Other</option>
                </Select>
              )}
            </Field>
            <Field label="Account number" error={errors.accountNumber?.message} required>
              {(p) => <Input {...p} autoComplete="off" {...form.register('accountNumber')} />}
            </Field>
            <Field label="Account holder" error={errors.accountHolder?.message} required>
              {(p) => <Input {...p} {...form.register('accountHolder')} />}
            </Field>
          </FormGrid>
          <Checkbox label="Primary account (used for bank files)" {...form.register('isPrimary')} />
        </form>
      </Modal>
    </Card>
  );
}

function ContactsTab({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const q = useApi<any[]>(['contacts', employeeId], `/employees/${employeeId}/emergency-contacts`);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useAction((cid: string) => api.del(`/employees/${employeeId}/emergency-contacts/${cid}`), { success: 'Contact removed', invalidate: [['contacts', employeeId]] });
  const form = useZodForm<any>(emergencyContactSchema);
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/employees/${employeeId}/emergency-contacts`, v);
      toast.success('Contact added');
      await qc.invalidateQueries({ queryKey: ['contacts', employeeId] });
      form.reset();
      setAdding(false);
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save', errorMessage(x));
    }
  });
  return (
    <Card>
      <CardHeader title="Emergency contacts" actions={canEdit && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add contact</Button>} />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r: any) => r.id}
        empty={<EmptyState title="No emergency contacts" />}
        columns={[
          { key: 'name', header: 'Name', cell: (r: any) => r.name },
          { key: 'rel', header: 'Relationship', cell: (r: any) => r.relationship },
          { key: 'phone', header: 'Phone', cell: (r: any) => r.phone },
          { key: 'email', header: 'Email', hideOnMobile: true, cell: (r: any) => r.email ?? '—' },
          { key: 'x', header: '', cell: (r: any) => canEdit && <Button size="sm" variant="ghost" aria-label="Remove contact" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={() => remove.mutate(r.id)} /> },
        ]}
      />
      <Modal open={adding} onClose={() => setAdding(false)} title="Add emergency contact" footer={<><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <FormGrid>
            <Field label="Name" error={errors.name?.message} required>
              {(p) => <Input {...p} {...form.register('name')} />}
            </Field>
            <Field label="Relationship" error={errors.relationship?.message} required>
              {(p) => <Input {...p} {...form.register('relationship')} />}
            </Field>
            <Field label="Phone" error={errors.phone?.message} required>
              {(p) => <Input {...p} {...form.register('phone')} />}
            </Field>
            <Field label="Email" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" {...form.register('email')} />}
            </Field>
          </FormGrid>
          <Field label="Address" error={errors.address?.message}>
            {(p) => <Input {...p} {...form.register('address')} />}
          </Field>
        </form>
      </Modal>
    </Card>
  );
}

function DocumentsTab({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const q = useApi<any[]>(['documents', employeeId], `/employees/${employeeId}/documents`);
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('Contract');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useAction((did: string) => api.del(`/employees/${employeeId}/documents/${did}`), { success: 'Document removed', invalidate: [['documents', employeeId]] });
  return (
    <Card>
      <CardHeader
        title="Documents"
        description="Private storage · PDF, PNG, JPEG or WebP"
        actions={
          canEdit && (
            <>
              <Select className="w-40" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {['Contract', 'Identification', 'Certificate', 'Medical', 'Disciplinary', 'General'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setBusy(true);
                  try {
                    await api.upload(`/employees/${employeeId}/documents`, f, { category });
                    toast.success('Document uploaded');
                    await qc.invalidateQueries({ queryKey: ['documents', employeeId] });
                  } catch (x) {
                    toast.error('Upload failed', errorMessage(x));
                  } finally {
                    setBusy(false);
                    e.target.value = '';
                  }
                }}
              />
              <Button size="sm" loading={busy} icon={<Paperclip className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                Upload
              </Button>
            </>
          )
        }
      />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r: any) => r.id}
        empty={<EmptyState title="No documents" />}
        columns={[
          { key: 'name', header: 'File', cell: (r: any) => r.fileName },
          { key: 'cat', header: 'Category', cell: (r: any) => r.category },
          { key: 'size', header: 'Size', hideOnMobile: true, cell: (r: any) => `${Math.ceil(r.sizeBytes / 1024)} KB` },
          { key: 'at', header: 'Uploaded', hideOnMobile: true, cell: (r: any) => formatDateTime(r.createdAt) },
          {
            key: 'x',
            header: '',
            cell: (r: any) => (
              <div className="flex justify-end gap-1">
                <DownloadButton path={`/employees/${employeeId}/documents/${r.id}/download`} label="Download" variant="ghost" />
                {canEdit && <Button size="sm" variant="ghost" aria-label="Remove document" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={() => remove.mutate(r.id)} />}
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

function HistoryTab({ employeeId }: { employeeId: string }) {
  const q = useApi<{ events: any[]; audit: any[] }>(['emp-history', employeeId], `/employees/${employeeId}/history`);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Employment history" />
        <DataTable
          rows={q.data?.events}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          empty={<EmptyState title="No events" />}
          columns={[
            { key: 'date', header: 'Date', cell: (r: any) => formatDate(r.eventDate) },
            { key: 'type', header: 'Event', cell: (r: any) => <Badge tone="blue">{r.eventType.replace(/_/g, ' ').toLowerCase()}</Badge> },
            { key: 'reason', header: 'Reason', cell: (r: any) => r.reason ?? '—' },
          ]}
        />
      </Card>
      {!!q.data?.audit.length && (
        <Card>
          <CardHeader title="Audit trail" description="Before/after values for personal-data and compensation changes (EMP-006)" />
          <DataTable
            rows={q.data.audit}
            rowKey={(r: any) => r.id}
            columns={[
              { key: 'at', header: 'When', cell: (r: any) => formatDateTime(r.createdAt) },
              { key: 'action', header: 'Action', cell: (r: any) => <span className="font-mono text-xs">{r.action}</span> },
              { key: 'who', header: 'By', cell: (r: any) => r.actorEmail ?? '—' },
              { key: 'chg', header: 'Changes', cell: (r: any) => <code className="block max-w-md truncate text-xs" title={JSON.stringify(r.after)}>{r.after ? JSON.stringify(r.after) : r.reason ?? ''}</code> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
