import { useQueryClient } from '@tanstack/react-query';
import { overtimeRuleSchema, overtimeSchema, timesheetSchema } from '@yardhrms/types';
import { Alert, Button, Card, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, StatusBadge, Textarea, errorMessage, formatDate, formatNumber, todayIso, useToast } from '@yardhrms/ui';
import { CheckCheck, Clock, Plus, Timer } from 'lucide-react';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { EmployeePicker, FormGrid, RefSelect, useReferenceData } from '@/components/common';
import { DecisionButtons, StatusFilter, SubjectCell } from '@/components/workflow';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, usePaged, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { EmployeeOption } from '@/lib/types';

function previewHours(start?: string, end?: string, brk?: string) {
  if (!start || !end || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  let span = toM(end) - toM(start);
  const overnight = span <= 0;
  if (overnight) span += 1440;
  return { hours: Math.round((span / 60 - Number(brk || 0)) * 100) / 100, overnight };
}

export function Timesheets() {
  const { can, me, readOnly } = useSession();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const q = usePaged<any>(['timesheets'], '/timesheets', { page, pageSize: 25, status: status || undefined });
  const myId = me!.activeTenant!.employeeId;
  const canSubmit = !readOnly && (can('timesheets.submit.any') || can('timesheets.submit.self'));
  const canApprove = can('timesheets.approve') && !readOnly;
  return (
    <>
      <PageHeader
        title="Timesheets"
        description="Regular hours for weekly and fortnightly employees. Monthly employees are paid on the configured standard hours and do not submit timesheets."
        actions={
          <>
            {canApprove && selected.size > 0 && (
              <Button
                variant="outline"
                icon={<CheckCheck className="h-4 w-4" />}
                onClick={async () => {
                  try {
                    const r = await api.post<{ approved: number; results: { ok: boolean; error?: string }[] }>('/timesheets/bulk-approve', { ids: [...selected] });
                    const failed = r.results.filter((x) => !x.ok);
                    toast.success(`${r.approved} timesheet(s) approved`, failed.length ? `${failed.length} not approved: ${failed[0].error}` : undefined);
                    setSelected(new Set());
                    await qc.invalidateQueries({ queryKey: ['timesheets'] });
                  } catch (e) {
                    toast.error('Bulk approval failed', errorMessage(e));
                  }
                }}
              >
                Approve selected ({selected.size})
              </Button>
            )}
            {canSubmit && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                New timesheet
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="flex gap-3 border-b border-slate-100 p-4">
          <StatusFilter value={status} onChange={(v) => (setStatus(v), setPage(1))} />
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          selectable={canApprove ? { selected, onChange: setSelected, isSelectable: (r: any) => r.status === 'PENDING' && r.employeeId !== myId } : undefined}
          empty={<EmptyState icon={<Clock className="h-6 w-6" />} title="No timesheets" />}
          columns={[
            { key: 'emp', header: 'Employee', cell: (r: any) => <SubjectCell e={r.employee} submittedBy={r.submittedBy} delegated={r.delegated} /> },
            { key: 'date', header: 'Work date', cell: (r: any) => formatDate(r.workDate) },
            { key: 'time', header: 'Shift', cell: (r: any) => `${r.startTime}–${r.endTime}${r.overnight ? ' (overnight)' : ''}` },
            { key: 'brk', header: 'Break', align: 'right', hideOnMobile: true, cell: (r: any) => `${formatNumber(r.breakHours)} h` },
            { key: 'hrs', header: 'Regular hrs', align: 'right', cell: (r: any) => formatNumber(r.regularHours) },
            { key: 'src', header: 'Source', hideOnMobile: true, cell: (r: any) => r.source.toLowerCase() },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
            {
              key: 'x',
              header: '',
              cell: (r: any) => (
                <DecisionButtons base="/timesheets" id={r.id} status={r.status} noun="timesheet" canApprove={canApprove && r.employeeId !== myId} canCancel invalidate={[['timesheets']]} />
              ),
            },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
      <TimesheetModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function TimesheetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can, me } = useSession();
  const ref = useReferenceData();
  const qc = useQueryClient();
  const toast = useToast();
  const [employee, setEmployee] = useState<EmployeeOption | null>(null);
  const [another, setAnother] = useState(false);
  const form = useZodForm<any>(timesheetSchema, { defaultValues: { workDate: todayIso(), startTime: '08:00', endTime: '16:30', breakHours: '0.5' } });
  const errors = form.formState.errors as any;
  const preview = previewHours(form.watch('startTime'), form.watch('endTime'), form.watch('breakHours'));
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/timesheets', { ...v, employeeId: employee?.id, shiftTypeId: v.shiftTypeId || null });
      toast.success('Timesheet submitted', 'Pending approval');
      await qc.invalidateQueries({ queryKey: ['timesheets'] });
      if (another) form.reset({ ...v, workDate: v.workDate });
      else {
        form.reset();
        setEmployee(null);
        onClose();
      }
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not submit timesheet', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} title="New timesheet" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Submit</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        {can('timesheets.submit.any') && (
          <Field label="Employee" hint="Only active weekly/fortnightly employees are eligible for regular timesheets">
            {(p) => <EmployeePicker id={p.id} eligibleFor="timesheet" value={employee?.id ?? null} onChange={(_, e) => setEmployee(e ?? null)} allowSelf={!!me!.activeTenant!.employeeId} />}
          </Field>
        )}
        <FormGrid cols={3}>
          <Field label="Work date" error={errors.workDate?.message} required>
            {(p) => <Input {...p} type="date" max={todayIso()} {...form.register('workDate')} />}
          </Field>
          <Field label="Shift type">
            {(p) => (
              <Controller
                control={form.control}
                name="shiftTypeId"
                render={({ field }) => (
                  <RefSelect
                    {...p}
                    items={ref.data?.shiftTypes}
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      const st = ref.data?.shiftTypes.find((s) => s.id === v);
                      if (st?.defaultStart) form.setValue('startTime', st.defaultStart);
                      if (st?.defaultEnd) form.setValue('endTime', st.defaultEnd);
                    }}
                  />
                )}
              />
            )}
          </Field>
          <Field label="Break (hours)" error={errors.breakHours?.message}>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('breakHours')} />}
          </Field>
          <Field label="Start" error={errors.startTime?.message} required>
            {(p) => <Input {...p} type="time" {...form.register('startTime')} />}
          </Field>
          <Field label="End" error={errors.endTime?.message} required hint="Earlier than start = overnight">
            {(p) => <Input {...p} type="time" {...form.register('endTime')} />}
          </Field>
          <div className="flex items-end pb-2 text-sm text-slate-600">{preview && (preview.hours > 0 ? <span>Regular hours: <strong>{preview.hours}</strong>{preview.overnight && ' (overnight)'}</span> : <span className="text-red-600">Break exceeds shift</span>)}</div>
        </FormGrid>
        <Field label="Comments" error={errors.comments?.message}>
          {(p) => <Textarea {...p} {...form.register('comments')} />}
        </Field>
        <Checkbox label="Keep this form open to add another" checked={another} onChange={(e) => setAnother(e.target.checked)} />
      </form>
    </Modal>
  );
}

export function Overtime() {
  const { can, me, readOnly } = useSession();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const q = usePaged<any>(['overtime'], '/overtime', { page, pageSize: 25, status: status || undefined });
  const myId = me!.activeTenant!.employeeId;
  const canApprove = can('overtime.approve') && !readOnly;
  return (
    <>
      <PageHeader
        title="Overtime"
        description="Separate request and approval flow. Only approved overtime for overtime-eligible employees enters payroll."
        actions={
          <>
            {can('payroll.config.manage') && (
              <Button variant="outline" onClick={() => setRulesOpen(true)}>
                Overtime rules
              </Button>
            )}
            {!readOnly && (can('overtime.submit.any') || can('overtime.submit.self')) && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                New overtime request
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="flex gap-3 border-b border-slate-100 p-4">
          <StatusFilter value={status} onChange={(v) => (setStatus(v), setPage(1))} />
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          empty={<EmptyState icon={<Timer className="h-6 w-6" />} title="No overtime requests" />}
          columns={[
            { key: 'emp', header: 'Employee', cell: (r: any) => <SubjectCell e={r.employee} submittedBy={r.submittedBy} delegated={r.delegated} /> },
            { key: 'date', header: 'Work date', cell: (r: any) => formatDate(r.workDate) },
            { key: 'cat', header: 'Category', cell: (r: any) => `${r.rule.name} (${formatNumber(r.multiplier, 3)}×)` },
            { key: 'hrs', header: 'Hours', align: 'right', cell: (r: any) => formatNumber(r.hours) },
            { key: 'reason', header: 'Reason', hideOnMobile: true, cell: (r: any) => <span className="line-clamp-1 max-w-[220px]">{r.reason}</span> },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
            { key: 'x', header: '', cell: (r: any) => <DecisionButtons base="/overtime" id={r.id} status={r.status} noun="overtime" canApprove={canApprove && r.employeeId !== myId} canCancel invalidate={[['overtime']]} /> },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
      <OvertimeModal open={adding} onClose={() => setAdding(false)} />
      <OvertimeRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  );
}

function OvertimeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can, me } = useSession();
  const ref = useReferenceData();
  const qc = useQueryClient();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const form = useZodForm<any>(overtimeSchema, { defaultValues: { workDate: todayIso() } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/overtime', { ...v, employeeId: employeeId ?? undefined });
      toast.success('Overtime submitted', 'Pending approval');
      await qc.invalidateQueries({ queryKey: ['overtime'] });
      form.reset({ workDate: todayIso() });
      setEmployeeId(null);
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not submit overtime', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} title="New overtime request" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Submit</Button></>}>
      {!ref.data?.overtimeRules.some((r) => r.active) && <Alert tone="warning">No overtime rules configured yet. Ask payroll to add overtime categories.</Alert>}
      <form onSubmit={submit} className="mt-3 space-y-4">
        {can('overtime.submit.any') && (
          <Field label="Employee" hint="Only overtime-eligible active employees (including eligible monthly staff)">
            {(p) => <EmployeePicker id={p.id} eligibleFor="overtime" value={employeeId} onChange={setEmployeeId} allowSelf={!!me!.activeTenant!.employeeId} />}
          </Field>
        )}
        <FormGrid>
          <Field label="Work date" error={errors.workDate?.message} required>
            {(p) => <Input {...p} type="date" max={todayIso()} {...form.register('workDate')} />}
          </Field>
          <Field label="Hours" error={errors.hours?.message} required>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('hours')} />}
          </Field>
        </FormGrid>
        <Field label="Category" error={errors.overtimeRuleId?.message} required>
          {(p) => (
            <Controller
              control={form.control}
              name="overtimeRuleId"
              render={({ field }) => <RefSelect {...p} items={ref.data?.overtimeRules.map((r) => ({ ...r, name: `${r.name} (${formatNumber(r.multiplier, 3)}×)` }))} value={field.value} onChange={(v) => field.onChange(v ?? '')} placeholder="Select…" />}
            />
          )}
        </Field>
        <Field label="Reason" error={errors.reason?.message} required>
          {(p) => <Textarea {...p} {...form.register('reason')} />}
        </Field>
      </form>
    </Modal>
  );
}

function OvertimeRulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules = useApi<any[]>(['overtime-rules'], open ? '/overtime/rules' : null);
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(overtimeRuleSchema, { defaultValues: { active: true } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/overtime/rules', v);
      toast.success('Overtime rule added');
      form.reset({ active: true });
      await qc.invalidateQueries({ queryKey: ['overtime-rules'] });
      await qc.invalidateQueries({ queryKey: ['reference-data'] });
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save rule', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} title="Overtime rules" description="Multipliers apply prospectively; existing requests keep their multiplier snapshot." size="lg">
      <DataTable
        rows={rules.data}
        loading={rules.isLoading}
        rowKey={(r: any) => r.id}
        columns={[
          { key: 'code', header: 'Code', cell: (r: any) => r.code },
          { key: 'name', header: 'Name', cell: (r: any) => r.name },
          { key: 'mult', header: 'Multiplier', align: 'right', cell: (r: any) => `${formatNumber(r.multiplier, 3)}×` },
          { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
        ]}
      />
      <form onSubmit={submit} className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
        <Field label="Code" error={errors.code?.message}>
          {(p) => <Input {...p} {...form.register('code')} />}
        </Field>
        <Field label="Name" error={errors.name?.message}>
          {(p) => <Input {...p} {...form.register('name')} />}
        </Field>
        <Field label="Multiplier" error={errors.multiplier?.message}>
          {(p) => <Input {...p} inputMode="decimal" {...form.register('multiplier')} />}
        </Field>
        <div className="flex items-end">
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Add rule
          </Button>
        </div>
      </form>
    </Modal>
  );
}
