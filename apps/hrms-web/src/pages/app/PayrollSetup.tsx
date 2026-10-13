import { useQueryClient } from '@tanstack/react-query';
import { allowanceTypeSchema, deductionTypeSchema, statutoryVersionSchema } from '@yardhrms/types';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, errorMessage, formatDate, formatDateTime, useConfirm, useToast } from '@yardhrms/ui';
import { BookOpenCheck, CheckCircle2, Copy, ExternalLink, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray } from 'react-hook-form';
import { FormGrid } from '@/components/common';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';

type Tab = 'statutory' | 'frequencies' | 'items';

export function PayrollSetup() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('statutory');
  return (
    <>
      <PageHeader title="Payroll setup" description="Effective-dated statutory rules, pay frequencies and payroll items" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'statutory', label: 'Statutory rules' },
          { value: 'frequencies', label: 'Pay frequencies', hidden: !can('payroll.config.manage') },
          { value: 'items', label: 'Allowance & deduction types', hidden: !can('payroll.config.manage') },
        ]}
      />
      {tab === 'statutory' && <StatutoryRules />}
      {tab === 'frequencies' && <PayFrequencies />}
      {tab === 'items' && <PayItemTypes />}
    </>
  );
}

function StatutoryRules() {
  const { can, readOnly } = useSession();
  const q = useApi<any[]>(['statutory-versions'], '/payroll/statutory-versions');
  const [editing, setEditing] = useState<any | null>(null);
  const [approving, setApproving] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  return (
    <div className="space-y-5">
      <ReferencePackModal open={importing} onClose={() => setImporting(false)} />
      <Alert tone="warning" title="Compliance guardrail (PRD §6.7)">
        Statutory figures must come from authoritative sources (TAJ, NIS, NHT, HEART/NSTA notices). You can start from a researched <strong>reference pack</strong>, which is imported as a DRAFT: a
        second authorized person must verify every figure against the cited sources and approve it with an attestation before payroll can use it. Approved versions are immutable and kept for re-running
        historical payroll. Live use also requires your payroll specialist’s sign-off.
      </Alert>
      <Card>
        <CardHeader
          title="Rule versions"
          actions={
            can('statutory.manage') &&
            !readOnly && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" icon={<BookOpenCheck className="h-4 w-4" />} onClick={() => setImporting(true)}>
                  Import reference pack
                </Button>
                <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({})}>
                  New version
                </Button>
              </div>
            )
          }
        />
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          empty={<EmptyState title="No statutory rule versions" />}
          columns={[
            { key: 'name', header: 'Version', cell: (r: any) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-slate-500">{r.components.map((c: any) => c.code).join(' · ')}</p></div> },
            { key: 'eff', header: 'Effective', cell: (r: any) => `${formatDate(r.effectiveFrom)} → ${r.effectiveTo ? formatDate(r.effectiveTo) : 'open'}` },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
            { key: 'appr', header: 'Approved', hideOnMobile: true, cell: (r: any) => (r.approvedAt ? formatDateTime(r.approvedAt) : '—') },
            {
              key: 'x',
              header: '',
              cell: (r: any) => (
                <div className="flex justify-end gap-1">
                  {r.status === 'DRAFT' && can('statutory.manage') && !readOnly && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(r)} aria-label="Edit version" />}
                  {r.status === 'DRAFT' && can('statutory.approve') && !readOnly && (
                    <Button size="sm" variant="outline" icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} onClick={() => setApproving(r)}>
                      Approve
                    </Button>
                  )}
                  {can('statutory.manage') && !readOnly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Clone version"
                      icon={<Copy className="h-4 w-4" />}
                      onClick={async () => {
                        try {
                          const v = await api.post<any>(`/payroll/statutory-versions/${r.id}/clone`);
                          await qc.invalidateQueries({ queryKey: ['statutory-versions'] });
                          setEditing(v);
                        } catch (e) {
                          toast.error('Clone failed', errorMessage(e));
                        }
                      }}
                    />
                  )}
                  {r.status === 'APPROVED' && can('statutory.approve') && !readOnly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Retire version"
                      icon={<Trash2 className="h-4 w-4 text-red-600" />}
                      onClick={async () => {
                        const c = await confirm({ title: 'Retire rule version', message: 'Retired versions can no longer be selected for new payroll. Approved payroll that used it is unaffected.', tone: 'danger', requireReason: 'Reason' });
                        if (!c.ok) return;
                        try {
                          await api.post(`/payroll/statutory-versions/${r.id}/retire`, { reason: c.reason });
                          await qc.invalidateQueries({ queryKey: ['statutory-versions'] });
                        } catch (e) {
                          toast.error('Could not retire', errorMessage(e));
                        }
                      }}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
      {q.data?.map(
        (v) =>
          v.status === 'APPROVED' && (
            <Card key={v.id}>
              <CardHeader title={v.name} description={`Approved ${formatDateTime(v.approvedAt)} · ${v.attestation ?? ''}`} />
              <ComponentTable components={v.components} />
            </Card>
          ),
      )}
      <VersionEditor value={editing} onClose={() => setEditing(null)} />
      <ApproveModal version={approving} onClose={() => setApproving(null)} />
    </div>
  );
}

function ComponentTable({ components }: { components: any[] }) {
  const pct = (v: string) => `${(Number(v) * 100).toFixed(3).replace(/\.?0+$/, '')}%`;
  return (
    <DataTable
      rows={components}
      rowKey={(c: any) => c.code}
      columns={[
        { key: 'code', header: 'Code', cell: (c: any) => <span className="font-mono text-xs">{c.code}</span> },
        { key: 'name', header: 'Component', cell: (c: any) => c.name },
        { key: 'base', header: 'Base', cell: (c: any) => c.base.toLowerCase().replace(/_/g, ' ') },
        { key: 'emp', header: 'Employee', align: 'right', cell: (c: any) => (c.brackets.length ? c.brackets.map((b: any) => `${pct(b.rate)}${b.upToAnnual ? ` ≤${Number(b.upToAnnual).toLocaleString()}` : '+'}`).join(', ') : pct(c.employeeRate)) },
        { key: 'er', header: 'Employer', align: 'right', cell: (c: any) => pct(c.employerRate) },
        { key: 'thr', header: 'Annual threshold', align: 'right', hideOnMobile: true, cell: (c: any) => (c.annualThreshold ? Number(c.annualThreshold).toLocaleString() : '—') },
        { key: 'ceil', header: 'Annual ceiling', align: 'right', hideOnMobile: true, cell: (c: any) => (c.annualCeiling ? Number(c.annualCeiling).toLocaleString() : '—') },
        { key: 'method', header: 'Method', hideOnMobile: true, cell: (c: any) => <Badge tone={c.calculationMethod === 'CUMULATIVE' ? 'brand' : undefined}>{(c.calculationMethod ?? 'PERIOD').toLowerCase()}</Badge> },
      ]}
    />
  );
}

function VersionEditor({ value, onClose }: { value: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(statutoryVersionSchema);
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'components' });
  const errors = form.formState.errors as any;
  useEffect(() => {
    if (!value) return;
    form.reset(
      value.id
        ? {
            name: value.name,
            effectiveFrom: value.effectiveFrom,
            effectiveTo: value.effectiveTo ?? '',
            sourceReference: value.sourceReference ?? '',
            components: value.components.map((c: any) => ({ ...c, annualCeiling: c.annualCeiling ?? '', annualThreshold: c.annualThreshold ?? '', minAge: c.minAge ?? '', maxAge: c.maxAge ?? '', notes: c.notes ?? '', brackets: c.brackets })),
          }
        : { name: '', effectiveFrom: `${new Date().getFullYear()}-01-01`, components: [] },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const submit = form.handleSubmit(async (v) => {
    const clean = {
      ...v,
      effectiveTo: v.effectiveTo || null,
      components: v.components.map((c: any) => ({
        ...c,
        annualCeiling: c.annualCeiling || null,
        annualThreshold: c.annualThreshold || null,
        minAge: c.minAge === '' ? null : c.minAge,
        maxAge: c.maxAge === '' ? null : c.maxAge,
        brackets: (c.brackets ?? []).filter((b: any) => b.rate !== '').map((b: any) => ({ upToAnnual: b.upToAnnual || null, rate: b.rate })),
      })),
    };
    try {
      if (value?.id) await api.put(`/payroll/statutory-versions/${value.id}`, clean);
      else await api.post('/payroll/statutory-versions', clean);
      toast.success('Rule version saved as DRAFT');
      await qc.invalidateQueries({ queryKey: ['statutory-versions'] });
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save', errorMessage(x));
    }
  });
  return (
    <Modal open={!!value} onClose={onClose} size="xl" title={value?.id ? 'Edit statutory rule version (draft)' : 'New statutory rule version'} description="Rates are fractions (e.g. 0.03 = 3%). Annual thresholds/ceilings are divided by periods per year." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save draft</Button></>}>
      <form onSubmit={submit} className="space-y-5">
        <FormGrid cols={3}>
          <Field label="Version name" error={errors.name?.message} required>
            {(p) => <Input {...p} {...form.register('name')} />}
          </Field>
          <Field label="Effective from" error={errors.effectiveFrom?.message} required>
            {(p) => <Input {...p} type="date" {...form.register('effectiveFrom')} />}
          </Field>
          <Field label="Effective to" error={errors.effectiveTo?.message}>
            {(p) => <Input {...p} type="date" {...form.register('effectiveTo')} />}
          </Field>
        </FormGrid>
        <Field label="Authoritative source reference" hint="e.g. TAJ notice number / gazette reference and date" error={errors.sourceReference?.message}>
          {(p) => <Textarea {...p} rows={2} {...form.register('sourceReference')} />}
        </Field>
        <div className="space-y-4">
          {fields.map((f, i) => (
            <div key={f.id} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Component {i + 1}</p>
                <Button size="sm" variant="ghost" aria-label="Remove component" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={() => remove(i)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Code" error={errors.components?.[i]?.code?.message} required>
                  {(p) => <Input {...p} {...form.register(`components.${i}.code`)} />}
                </Field>
                <Field label="Name" error={errors.components?.[i]?.name?.message} required>
                  {(p) => <Input {...p} {...form.register(`components.${i}.name`)} />}
                </Field>
                <Field label="Order" error={errors.components?.[i]?.sortOrder?.message}>
                  {(p) => <Input {...p} type="number" {...form.register(`components.${i}.sortOrder`)} />}
                </Field>
                <Field label="Base" required>
                  {(p) => (
                    <Select {...p} {...form.register(`components.${i}.base`)}>
                      <option value="GROSS">Gross (all earnings)</option>
                      <option value="TAXABLE_GROSS">Taxable gross</option>
                      <option value="STATUTORY_INCOME">Statutory income</option>
                    </Select>
                  )}
                </Field>
                <Field label="Employee rate" error={errors.components?.[i]?.employeeRate?.message}>
                  {(p) => <Input {...p} inputMode="decimal" {...form.register(`components.${i}.employeeRate`)} />}
                </Field>
                <Field label="Employer rate" error={errors.components?.[i]?.employerRate?.message}>
                  {(p) => <Input {...p} inputMode="decimal" {...form.register(`components.${i}.employerRate`)} />}
                </Field>
                <Field label="Annual threshold" error={errors.components?.[i]?.annualThreshold?.message}>
                  {(p) => <Input {...p} inputMode="decimal" {...form.register(`components.${i}.annualThreshold`)} />}
                </Field>
                <Field label="Annual ceiling" error={errors.components?.[i]?.annualCeiling?.message}>
                  {(p) => <Input {...p} inputMode="decimal" {...form.register(`components.${i}.annualCeiling`)} />}
                </Field>
                <Field label="Min age">{(p) => <Input {...p} type="number" {...form.register(`components.${i}.minAge`)} />}</Field>
                <Field label="Max age">{(p) => <Input {...p} type="number" {...form.register(`components.${i}.maxAge`)} />}</Field>
                <Field label="Calculation method" hint="Cumulative recalculates on year-to-date figures and subtracts what was already deducted this tax year">
                  {(p) => (
                    <Select {...p} {...form.register(`components.${i}.calculationMethod`)}>
                      <option value="PERIOD">Per period</option>
                      <option value="CUMULATIVE">Cumulative (year to date)</option>
                    </Select>
                  )}
                </Field>
                <Field label="Bracket bounds apply to" hint="e.g. Jamaica PAYE: 30% on statutory income above J$6M → base before threshold">
                  {(p) => (
                    <Select {...p} {...form.register(`components.${i}.bracketBasis`)}>
                      <option value="AFTER_THRESHOLD">Amount after threshold</option>
                      <option value="BEFORE_THRESHOLD">Base before threshold</option>
                    </Select>
                  )}
                </Field>
                <div className="flex items-end sm:col-span-2">
                  <Checkbox label="Employee amount reduces statutory income for later components" {...form.register(`components.${i}.reducesStatutoryIncome`)} />
                </div>
              </div>
              <BracketEditor index={i} form={form} />
            </div>
          ))}
          <Button
            variant="outline"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => append({ code: '', name: '', sortOrder: (fields.length + 1) * 10, base: 'GROSS', employeeRate: '0', employerRate: '0', annualCeiling: '', annualThreshold: '', reducesStatutoryIncome: false, calculationMethod: 'PERIOD', bracketBasis: 'AFTER_THRESHOLD', brackets: [] })}
          >
            Add component
          </Button>
          {errors.components?.message && <p className="text-sm text-red-600">{errors.components.message}</p>}
        </div>
      </form>
    </Modal>
  );
}

function BracketEditor({ index, form }: { index: number; form: any }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: `components.${index}.brackets` });
  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">Progressive brackets (optional — on amount above threshold; overrides employee rate)</p>
        <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => append({ upToAnnual: '', rate: '' })}>
          Bracket
        </Button>
      </div>
      {fields.map((b, j) => (
        <div key={b.id} className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input aria-label="Up to (annual, blank = no limit)" placeholder="Up to (annual) — blank = no limit" {...form.register(`components.${index}.brackets.${j}.upToAnnual`)} />
          <Input aria-label="Rate" placeholder="Rate e.g. 0.25" {...form.register(`components.${index}.brackets.${j}.rate`)} />
          <Button size="sm" variant="ghost" aria-label="Remove bracket" icon={<Trash2 className="h-4 w-4" />} onClick={() => remove(j)} />
        </div>
      ))}
    </div>
  );
}

function ApproveModal({ version, onClose }: { version: any | null; onClose: () => void }) {
  const [attestation, setAttestation] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Modal
      open={!!version}
      onClose={onClose}
      size="lg"
      title="Approve statutory rule version"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={attestation.trim().length < 20}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post(`/payroll/statutory-versions/${version.id}/approve`, { attestation });
                toast.success('Rule version approved');
                await qc.invalidateQueries({ queryKey: ['statutory-versions'] });
                setAttestation('');
                onClose();
              } catch (e) {
                toast.error('Approval failed', errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve version
          </Button>
        </>
      }
    >
      {version && (
        <div className="space-y-4">
          <Alert tone="warning" title="You are certifying these figures">
            <span className="flex gap-2">
              <ShieldAlert className="h-4 w-4 flex-none" /> Approve only after verifying every rate, threshold and ceiling against authoritative Jamaican sources. The author of a version cannot approve it.
            </span>
          </Alert>
          <ComponentTable components={version.components} />
          <Field label="Attestation" hint="Who verified these figures, against which sources and when (min 20 characters)" required>
            {(p) => <Textarea {...p} rows={3} value={attestation} onChange={(e) => setAttestation(e.target.value)} />}
          </Field>
        </div>
      )}
    </Modal>
  );
}

function PayFrequencies() {
  const q = useApi<{ items: any[]; requireSeparateApprover: boolean; taxYearStartMonth: number }>(['payroll-settings'], '/settings/payroll');
  const [items, setItems] = useState<any[]>([]);
  const [separate, setSeparate] = useState(true);
  const [taxYearStart, setTaxYearStart] = useState(1);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    if (q.data) {
      setItems(q.data.items.map((i) => ({ ...i })));
      setSeparate(q.data.requireSeparateApprover);
      setTaxYearStart(q.data.taxYearStartMonth ?? 1);
    }
  }, [q.data]);
  const set = (i: number, k: string, v: unknown) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card>
      <CardHeader title="Pay frequencies & standard hours" description="Monthly default 173.33 standard hours is configuration — used for the hourly equivalent of monthly salaries. Changes apply to future payroll only." />
      <CardBody className="space-y-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Frequency</th>
                <th className="py-2 pr-3">Standard hours / period</th>
                <th className="py-2 pr-3">Working days / period</th>
                <th className="py-2 pr-3">Periods / year</th>
                <th className="py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.frequency} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-medium">{it.frequency.toLowerCase()}</td>
                  <td className="py-2 pr-3">
                    <Input aria-label={`${it.frequency} standard hours`} value={it.standardHours} onChange={(e) => set(i, 'standardHours', e.target.value)} />
                  </td>
                  <td className="py-2 pr-3">
                    <Input aria-label={`${it.frequency} working days`} value={it.workingDays} onChange={(e) => set(i, 'workingDays', e.target.value)} />
                  </td>
                  <td className="py-2 pr-3">
                    <Input aria-label={`${it.frequency} periods per year`} type="number" value={it.periodsPerYear} onChange={(e) => set(i, 'periodsPerYear', Number(e.target.value))} />
                  </td>
                  <td className="py-2">
                    <input type="checkbox" aria-label={`${it.frequency} active`} checked={it.active} onChange={(e) => set(i, 'active', e.target.checked)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="max-w-xs">
          <Field label="Tax year starts in" hint="Used by cumulative statutory components. Jamaica: January (calendar year).">
            {(p) => (
              <Select {...p} value={taxYearStart} onChange={(e) => setTaxYearStart(Number(e.target.value))}>
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Checkbox label="Separation of duties: the preparer/submitter cannot review or approve the same payroll, leave, timesheet or overtime" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
        <div>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.put('/settings/payroll', { items: items.map(({ frequency, standardHours, workingDays, periodsPerYear, active }) => ({ frequency, standardHours, workingDays, periodsPerYear, active })), requireSeparateApprover: separate, taxYearStartMonth: taxYearStart });
                toast.success('Payroll settings saved');
                await qc.invalidateQueries({ queryKey: ['payroll-settings'] });
              } catch (e) {
                toast.error('Could not save', errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save settings
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function PayItemTypes() {
  const allowances = useApi<any[]>(['allowance-types'], '/payroll/allowance-types');
  const deductions = useApi<any[]>(['deduction-types'], '/payroll/deduction-types');
  const [modal, setModal] = useState<'allowance' | 'deduction' | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(modal === 'deduction' ? deductionTypeSchema : allowanceTypeSchema, { defaultValues: { taxable: true, preTax: false, active: true, category: 'OTHER' } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(modal === 'deduction' ? '/payroll/deduction-types' : '/payroll/allowance-types', v);
      toast.success('Saved');
      await qc.invalidateQueries({ queryKey: [modal === 'deduction' ? 'deduction-types' : 'allowance-types'] });
      await qc.invalidateQueries({ queryKey: ['reference-data'] });
      form.reset({ taxable: true, preTax: false, active: true, category: 'OTHER' });
      setModal(null);
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save', errorMessage(x));
    }
  });
  const toggle = async (kind: 'allowance' | 'deduction', r: any) => {
    await api.patch(`/payroll/${kind}-types/${r.id}`, { active: !r.active });
    await qc.invalidateQueries({ queryKey: [`${kind}-types`] });
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Allowance types" description="Taxability determines inclusion in taxable gross" actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('allowance')}>Add</Button>} />
        <DataTable
          rows={allowances.data}
          loading={allowances.isLoading}
          rowKey={(r: any) => r.id}
          empty={<EmptyState title="No allowance types" />}
          columns={[
            { key: 'code', header: 'Code', cell: (r: any) => r.code },
            { key: 'name', header: 'Name', cell: (r: any) => r.name },
            { key: 'tax', header: 'Tax', cell: (r: any) => <Badge tone={r.taxable ? 'yellow' : 'green'}>{r.taxable ? 'Taxable' : 'Non-taxable'}</Badge> },
            { key: 'a', header: '', cell: (r: any) => <Button size="sm" variant="ghost" onClick={() => toggle('allowance', r)}>{r.active ? 'Deactivate' : 'Activate'}</Button> },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Deduction types" description="Pension, insurance, loans, advances, union dues and other approved deductions" actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('deduction')}>Add</Button>} />
        <DataTable
          rows={deductions.data}
          loading={deductions.isLoading}
          rowKey={(r: any) => r.id}
          empty={<EmptyState title="No deduction types" />}
          columns={[
            { key: 'code', header: 'Code', cell: (r: any) => r.code },
            { key: 'name', header: 'Name', cell: (r: any) => r.name },
            { key: 'cat', header: 'Category', cell: (r: any) => `${r.category.toLowerCase()}${r.preTax ? ' · pre-tax' : ''}` },
            { key: 'a', header: '', cell: (r: any) => <Button size="sm" variant="ghost" onClick={() => toggle('deduction', r)}>{r.active ? 'Deactivate' : 'Activate'}</Button> },
          ]}
        />
      </Card>
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'deduction' ? 'Add deduction type' : 'Add allowance type'} footer={<><Button variant="outline" onClick={() => setModal(null)}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <FormGrid>
            <Field label="Code" error={errors.code?.message} required>
              {(p) => <Input {...p} {...form.register('code')} />}
            </Field>
            <Field label="Name" error={errors.name?.message} required>
              {(p) => <Input {...p} {...form.register('name')} />}
            </Field>
            {modal === 'deduction' && (
              <Field label="Category" required>
                {(p) => (
                  <Select {...p} {...form.register('category')}>
                    {['PENSION', 'INSURANCE', 'LOAN', 'ADVANCE', 'UNION', 'GARNISHMENT', 'OTHER'].map((c) => (
                      <option key={c} value={c}>
                        {c.toLowerCase()}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </FormGrid>
          {modal === 'deduction' ? (
            <Checkbox label="Pre-tax (reduces statutory income, e.g. approved pension)" {...form.register('preTax')} />
          ) : (
            <Checkbox label="Taxable" {...form.register('taxable')} />
          )}
        </form>
      </Modal>
    </div>
  );
}

function ReferencePackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const packs = useApi<any[]>(['reference-packs'], open ? '/payroll/statutory-reference-packs' : null);
  const [busy, setBusy] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const doImport = async (key: string) => {
    setBusy(key);
    try {
      await api.post('/payroll/statutory-reference-packs/import', { key });
      toast.success('Reference pack imported as DRAFT', 'Verify every figure against the sources, then have a second person approve it.');
      await qc.invalidateQueries({ queryKey: ['statutory-versions'] });
      onClose();
    } catch (e) {
      toast.error('Import failed', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const first = packs.data?.[0];
  return (
    <Modal open={open} onClose={onClose} title="Import a Jamaica reference pack" size="lg" footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <div className="space-y-4 text-sm">
        <Alert tone="warning" title="Researched figures — not a substitute for verification">
          Packs contain figures researched on {first?.researchedOn ?? '—'} from TAJ, NIS, NHT and HEART/NSTA publications as reported by the sources below. They are imported as a DRAFT and are never used until a
          second authorized person verifies and approves them.
        </Alert>
        <div className="space-y-2">
          {packs.data?.map((p) => (
            <div key={p.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-slate-500">
                  Effective {formatDate(p.effectiveFrom)} → {p.effectiveTo ? formatDate(p.effectiveTo) : 'open'} · {p.components.map((c: any) => c.code).join(' · ')}
                </p>
              </div>
              <Button size="sm" loading={busy === p.key} onClick={() => doImport(p.key)}>
                Import as draft
              </Button>
            </div>
          ))}
        </div>
        {first && (
          <>
            <div>
              <p className="mb-1 font-semibold">Before approving, confirm</p>
              <ul className="ml-5 list-disc space-y-1 text-slate-600">
                {first.verify.map((v: string) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-semibold">Sources</p>
              <ul className="space-y-1">
                {first.sources.map((s: any) => (
                  <li key={s.url}>
                    <a className="inline-flex items-center gap-1 text-brand underline" href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.title} <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
