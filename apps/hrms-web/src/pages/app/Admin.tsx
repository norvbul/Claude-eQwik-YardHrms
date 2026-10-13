import { useQueryClient } from '@tanstack/react-query';
import { changePasswordSchema, companyProfileSchema, inviteUserSchema, redeemCodeSchema, roleSchema } from '@yardhrms/types';
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
  StatusBadge,
  Tabs,
  errorMessage,
  formatDate,
  formatDateTime,
  useConfirm,
  useToast,
  formatMoney,
} from '@yardhrms/ui';
import { CreditCard, ImageUp, KeyRound, Mail, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { EmployeePicker, FormGrid, useReferenceData } from '@/components/common';
import { api } from '@/lib/api';
import { applyServerErrors, useAction, useApi, usePaged, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { NotificationPreferences } from '@/components/notifications';
import { DataPrivacy } from './DataPrivacy';

// ── Users & roles (SEC-004/005) ─────────────────────────────────────────────
export function UsersRoles() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  return (
    <>
      <PageHeader title="Users & roles" description="Invite users, assign roles and manage access. Active and invited users count against your plan’s user limit." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'users', label: 'Users' },
          { value: 'roles', label: 'Roles & permissions' },
        ]}
      />
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </>
  );
}

function UsersTab() {
  const { can, me, readOnly } = useSession();
  const users = useApi<any[]>(['users'], '/users');
  const roles = useApi<any[]>(['roles'], '/roles');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = can('users.manage') && !readOnly;
  const act = async (path: string, title: string) => {
    const r = await confirm({ title, message: title.startsWith('Deactivate') ? 'The user is signed out immediately and loses access. Their records and audit history are kept.' : 'Reactivation uses a licence seat.', tone: title.startsWith('Deactivate') ? 'danger' : 'primary' });
    if (!r.ok) return;
    try {
      await api.post(path);
      toast.success('Done');
      await qc.invalidateQueries({ queryKey: ['users'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      toast.error('Action failed', errorMessage(e));
    }
  };
  const resetMfa = async (r: any) => {
    const c = await confirm({
      title: 'Reset MFA',
      message: `${r.user.fullName} will be signed out everywhere and must enrol a new authenticator at next sign-in. Only do this after verifying their identity (e.g. in person or by a call-back to a known number).`,
      tone: 'danger',
      requireReason: 'How was their identity verified? (min 10 characters)',
    });
    if (!c.ok) return;
    try {
      await api.post(`/users/${r.id}/reset-mfa`, { reason: c.reason });
      toast.success('MFA reset', `${r.user.email} has been notified by email`);
      await qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      toast.error('Could not reset MFA', errorMessage(e));
    }
  };
  return (
    <Card>
      <CardHeader title="Users" description={me?.entitlements ? `${me.entitlements.activeUsers} of ${me.entitlements.userLimit} seats used` : undefined} actions={canManage && <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviting(true)}>Invite user</Button>} />
      <DataTable
        rows={users.data}
        loading={users.isLoading}
        rowKey={(r: any) => r.id}
        columns={[
          { key: 'name', header: 'User', cell: (r: any) => <div><p className="font-medium">{r.user.fullName}</p><p className="text-xs text-slate-500">{r.user.email}</p></div> },
          { key: 'roles', header: 'Roles', cell: (r: any) => <div className="flex flex-wrap gap-1">{r.roles.map((x: any) => <Badge key={x.id} tone="brand">{x.name}</Badge>)}</div> },
          { key: 'emp', header: 'Employee record', hideOnMobile: true, cell: (r: any) => (r.employee ? `${r.employee.firstName} ${r.employee.lastName} (${r.employee.employeeNumber})` : '—') },
          { key: 'mfa', header: 'MFA', hideOnMobile: true, cell: (r: any) => (r.user.mfaEnabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>) },
          { key: 'last', header: 'Last sign-in', hideOnMobile: true, cell: (r: any) => formatDateTime(r.user.lastLoginAt) },
          { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
          {
            key: 'x',
            header: '',
            cell: (r: any) =>
              canManage && (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  {r.status === 'INVITED' && (
                    <Button size="sm" variant="ghost" icon={<Mail className="h-4 w-4" />} aria-label="Resend invitation" onClick={() => api.post(`/users/${r.id}/resend-invite`).then(() => toast.success('Invitation resent')).catch((e) => toast.error('Failed', errorMessage(e)))} />
                  )}
                  {r.user.mfaEnabled && r.user.email !== me?.user.email && (
                    <Button size="sm" variant="ghost" onClick={() => resetMfa(r)}>
                      Reset MFA
                    </Button>
                  )}
                  {r.status !== 'DEACTIVATED' ? (
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => act(`/users/${r.id}/deactivate`, 'Deactivate user')}>
                      Deactivate
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => act(`/users/${r.id}/reactivate`, 'Reactivate user')}>
                      Reactivate
                    </Button>
                  )}
                </div>
              ),
          },
        ]}
      />
      <InviteModal open={inviting} onClose={() => setInviting(false)} roles={roles.data ?? []} />
      <EditMembershipModal value={editing} onClose={() => setEditing(null)} roles={roles.data ?? []} />
    </Card>
  );
}

function InviteModal({ open, onClose, roles }: { open: boolean; onClose: () => void; roles: any[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(inviteUserSchema, { defaultValues: { roleCodes: ['EMPLOYEE'] } });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/users/invite', v);
      toast.success('Invitation sent', v.email);
      await qc.invalidateQueries({ queryKey: ['users'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      form.reset({ roleCodes: ['EMPLOYEE'] });
      onClose();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not invite', errorMessage(x));
    }
  });
  return (
    <Modal open={open} onClose={onClose} title="Invite user" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Send invitation</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <FormGrid>
          <Field label="Full name" error={errors.fullName?.message} required>
            {(p) => <Input {...p} {...form.register('fullName')} />}
          </Field>
          <Field label="Email" error={errors.email?.message} required>
            {(p) => <Input {...p} type="email" {...form.register('email')} />}
          </Field>
        </FormGrid>
        <Field label="Link to employee record (self-service)" hint="Optional">
          {(p) => <Controller control={form.control} name="employeeId" render={({ field }) => <EmployeePicker id={p.id} value={field.value ?? null} onChange={(v) => field.onChange(v)} />} />}
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">Roles</legend>
          <Controller
            control={form.control}
            name="roleCodes"
            render={({ field }) => (
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((r) => (
                  <Checkbox
                    key={r.id}
                    label={r.name}
                    checked={field.value?.includes(r.code)}
                    onChange={(e) => field.onChange(e.target.checked ? [...(field.value ?? []), r.code] : field.value.filter((c: string) => c !== r.code))}
                  />
                ))}
              </div>
            )}
          />
          {errors.roleCodes && <p className="mt-1 text-xs text-red-600">{errors.roleCodes.message}</p>}
        </fieldset>
      </form>
    </Modal>
  );
}

function EditMembershipModal({ value, onClose, roles }: { value: any | null; onClose: () => void; roles: any[] }) {
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (value) {
      setRoleIds(value.roles.map((r: any) => r.id));
      setEmployeeId(value.employee?.id ?? null);
    }
  }, [value]);
  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={`Edit ${value?.user.fullName ?? ''}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!roleIds.length}
            onClick={async () => {
              setBusy(true);
              try {
                await api.patch(`/users/${value.id}`, { roleIds, employeeId });
                toast.success('User updated', 'Role changes sign the user out of other sessions.');
                await qc.invalidateQueries({ queryKey: ['users'] });
                onClose();
              } catch (e) {
                toast.error('Could not update', errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Employee record">{(p) => <EmployeePicker id={p.id} value={employeeId} onChange={setEmployeeId} />}</Field>
        {employeeId && (
          <button className="text-xs text-red-600 underline" onClick={() => setEmployeeId(null)}>
            Unlink employee record
          </button>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {roles.map((r) => (
            <Checkbox key={r.id} label={r.name} checked={roleIds.includes(r.id)} onChange={(e) => setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((i) => i !== r.id)))} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function RolesTab() {
  const { can, readOnly } = useSession();
  const roles = useApi<any[]>(['roles'], '/roles');
  const perms = useApi<{ code: string; description: string }[]>(['permissions'], '/permissions');
  const [editing, setEditing] = useState<any | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(roleSchema);
  useEffect(() => {
    if (editing) form.reset({ name: editing.name ?? '', description: editing.description ?? '', permissions: editing.permissions ?? [] });
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = new Map<string, { code: string; description: string }[]>();
  for (const p of perms.data ?? []) {
    const g = p.code.split('.')[0];
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const submit = form.handleSubmit(async (v) => {
    try {
      if (editing.id) await api.patch(`/roles/${editing.id}`, v);
      else await api.post('/roles', v);
      toast.success('Role saved');
      await qc.invalidateQueries({ queryKey: ['roles'] });
      setEditing(null);
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save role', errorMessage(x));
    }
  });
  return (
    <Card>
      <CardHeader title="Roles" description="Roles map to atomic permissions. Licence entitlements are a separate layer." actions={can('roles.manage') && !readOnly && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({})}>Custom role</Button>} />
      <DataTable
        rows={roles.data}
        loading={roles.isLoading}
        rowKey={(r: any) => r.id}
        onRowClick={can('roles.manage') && !readOnly ? (r: any) => r.code !== 'COMPANY_ADMIN' && setEditing(r) : undefined}
        columns={[
          { key: 'name', header: 'Role', cell: (r: any) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-slate-500">{r.description}</p></div> },
          { key: 'perms', header: 'Permissions', align: 'right', cell: (r: any) => r.permissions.length },
          { key: 'members', header: 'Users', align: 'right', cell: (r: any) => r.memberCount },
          { key: 'flags', header: '', cell: (r: any) => <div className="flex gap-1">{r.isSystem && <Badge>System</Badge>}{r.privileged && <Badge tone="purple">MFA required</Badge>}</div> },
        ]}
      />
      <Modal open={!!editing} onClose={() => setEditing(null)} size="xl" title={editing?.id ? `Edit ${editing.name}` : 'New custom role'} footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save role</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <FormGrid>
            <Field label="Name" error={(form.formState.errors as any).name?.message} required>
              {(p) => <Input {...p} {...form.register('name')} />}
            </Field>
            <Field label="Description">{(p) => <Input {...p} {...form.register('description')} />}</Field>
          </FormGrid>
          <Controller
            control={form.control}
            name="permissions"
            render={({ field }) => (
              <div className="grid gap-4 md:grid-cols-2">
                {[...groups.entries()].map(([g, list]) => (
                  <fieldset key={g} className="rounded-lg border border-slate-200 p-3">
                    <legend className="px-1 text-xs font-semibold uppercase text-slate-500">{g}</legend>
                    <div className="space-y-1.5">
                      {list.map((p) => (
                        <Checkbox
                          key={p.code}
                          label={<span title={p.code}>{p.description}</span>}
                          checked={field.value?.includes(p.code) ?? false}
                          onChange={(e) => field.onChange(e.target.checked ? [...(field.value ?? []), p.code] : (field.value ?? []).filter((c: string) => c !== p.code))}
                        />
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
          />
        </form>
      </Modal>
    </Card>
  );
}

// ── Company settings (CFG-001/002, HR-004/005, AC-15) ──────────────────────
export function CompanySettings({ initialTab = 'profile' }: { initialTab?: 'profile' | 'data' }) {
  const { can, me } = useSession();
  const isAdmin = !!me?.activeTenant?.roles.includes('COMPANY_ADMIN');
  const [tab, setTab] = useState<'profile' | 'data' | 'departments' | 'branches' | 'positions' | 'employment-types' | 'shift-types' | 'public-holidays'>(initialTab === 'data' && isAdmin ? 'data' : 'profile');
  return (
    <>
      <PageHeader title="Company settings" description="Company profile, branding and master data" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'profile', label: 'Profile & branding' },
          { value: 'departments', label: 'Departments' },
          { value: 'branches', label: 'Branches' },
          { value: 'positions', label: 'Positions' },
          { value: 'employment-types', label: 'Employment types' },
          { value: 'shift-types', label: 'Shift types' },
          { value: 'public-holidays', label: 'Public holidays' },
          ...(isAdmin ? [{ value: 'data' as const, label: 'Data & privacy' }] : []),
        ]}
      />
      {tab === 'profile' ? <CompanyProfile /> : tab === 'data' ? <DataPrivacy /> : <MasterData kind={tab} canWrite={can('masterdata.write')} />}
    </>
  );
}

function CompanyProfile() {
  const { can, refresh, readOnly } = useSession();
  const ref = useReferenceData();
  const q = useApi<any>(['tenant'], '/tenants/current');
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const form = useZodForm<any>(companyProfileSchema);
  const errors = form.formState.errors as any;
  useEffect(() => {
    if (q.data) form.reset(Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, v ?? ''])));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const canWrite = can('tenant.settings.write') && !readOnly;
  const submit = form.handleSubmit(async (v) => {
    try {
      const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]));
      await api.patch('/tenants/current', { ...body, timezone: v.timezone || 'America/Jamaica', locale: v.locale || 'en-JM' });
      toast.success('Company profile saved', 'The new name appears in the header, payslips and reports.');
      await qc.invalidateQueries({ queryKey: ['tenant'] });
      await refresh();
    } catch (x) {
      if (!applyServerErrors(form, x)) toast.error('Could not save', errorMessage(x));
    }
  });
  const text = (name: string, label: string, required = false) => (
    <Field label={label} error={errors[name]?.message} required={required}>
      {(p) => <Input {...p} disabled={!canWrite} {...form.register(name)} />}
    </Field>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Company profile" actions={canWrite && <Button size="sm" onClick={submit} loading={form.formState.isSubmitting}>Save</Button>} />
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <FormGrid>
              {text('legalName', 'Registered (legal) name', true)}
              {text('displayName', 'Display name', true)}
              {text('tradingName', 'Trading name')}
              {text('trn', 'Company TRN')}
              {text('nisEmployerNumber', 'NIS employer number')}
              {text('nhtEmployerNumber', 'NHT employer number')}
              {text('addressLine1', 'Address line 1')}
              {text('addressLine2', 'Address line 2')}
              {text('city', 'City / town')}
              <Field label="Parish">
                {(p) => (
                  <Select {...p} disabled={!canWrite} {...form.register('parish')}>
                    <option value="">Select parish</option>
                    {ref.data?.parishes.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                )}
              </Field>
              {text('phone', 'Phone')}
              {text('email', 'Email')}
              {text('website', 'Website')}
              {text('timezone', 'Time zone')}
            </FormGrid>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Branding" description="Logo and accent colour appear throughout the workspace and on payslips" />
        <CardBody className="space-y-4">
          <div className="flex items-center gap-4">
            {q.data?.logoUrl ? <img src={q.data.logoUrl} alt="Company logo" className="h-16 w-16 rounded-xl border border-slate-200 object-contain" /> : <div className="grid h-16 w-16 place-items-center rounded-xl bg-slate-100 text-xs text-slate-400">No logo</div>}
            {canWrite && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      await api.upload('/tenants/current/logo', f);
                      toast.success('Logo updated');
                      await qc.invalidateQueries({ queryKey: ['tenant'] });
                      await refresh();
                    } catch (x) {
                      toast.error('Upload failed', errorMessage(x));
                    } finally {
                      e.target.value = '';
                    }
                  }}
                />
                <Button variant="outline" size="sm" icon={<ImageUp className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                  Upload logo
                </Button>
              </>
            )}
          </div>
          <Field label="Accent colour" hint="Hex, e.g. #0b5d3b" error={errors.accentColor?.message}>
            {(p) => (
              <div className="flex gap-2">
                <input type="color" aria-label="Pick accent colour" className="h-10 w-12 rounded border border-slate-300" value={form.watch('accentColor') || '#0b5d3b'} onChange={(e) => form.setValue('accentColor', e.target.value)} disabled={!canWrite} />
                <Input {...p} disabled={!canWrite} {...form.register('accentColor')} />
              </div>
            )}
          </Field>
        </CardBody>
      </Card>
    </div>
  );
}

const MASTER_LABELS: Record<string, string> = { departments: 'Department', branches: 'Branch', positions: 'Position', 'employment-types': 'Employment type', 'shift-types': 'Shift type', 'public-holidays': 'Public holiday' };

function MasterData({ kind, canWrite }: { kind: string; canWrite: boolean }) {
  const { readOnly } = useSession();
  const ref = useReferenceData();
  const q = useApi<any[]>(['master', kind], `/master-data/${kind}`);
  const [editing, setEditing] = useState<any | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useAction((id: string) => api.del<any>(`/master-data/${kind}/${id}`), {
    success: (r: any) => (r.deactivated ? `In use by ${r.referencedBy} employee(s) — deactivated instead of deleted` : 'Deleted'),
    invalidate: [['master', kind], ['reference-data']],
  });
  const holiday = kind === 'public-holidays';
  const [values, setValues] = useState<Record<string, any>>({});
  useEffect(() => setValues(editing ?? {}), [editing]);
  const save = async () => {
    try {
      const body = holiday ? { date: values.date?.slice(0, 10), name: values.name } : { code: values.code, name: values.name, description: values.description || null, active: values.active ?? true, ...(kind === 'positions' ? { departmentId: values.departmentId || null } : {}), ...(kind === 'shift-types' ? { defaultStart: values.defaultStart || null, defaultEnd: values.defaultEnd || null } : {}), ...(kind === 'branches' ? { parish: values.parish || null } : {}) };
      if (editing?.id) await api.patch(`/master-data/${kind}/${editing.id}`, body);
      else await api.post(`/master-data/${kind}`, body);
      toast.success('Saved');
      await qc.invalidateQueries({ queryKey: ['master', kind] });
      await qc.invalidateQueries({ queryKey: ['reference-data'] });
      setEditing(null);
    } catch (e) {
      toast.error('Could not save', errorMessage(e));
    }
  };
  const writable = canWrite && !readOnly;
  return (
    <Card>
      <CardHeader title={`${MASTER_LABELS[kind]}s`} actions={writable && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ active: true })}>Add</Button>} />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r: any) => r.id}
        onRowClick={writable ? (r: any) => setEditing(r) : undefined}
        empty={<EmptyState title={`No ${MASTER_LABELS[kind].toLowerCase()}s yet`} />}
        columns={
          holiday
            ? [
                { key: 'date', header: 'Date', cell: (r: any) => formatDate(r.date?.slice(0, 10)) },
                { key: 'name', header: 'Holiday', cell: (r: any) => r.name },
                { key: 'x', header: '', cell: (r: any) => writable && <Button size="sm" variant="ghost" aria-label="Delete" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={(e) => (e.stopPropagation(), remove.mutate(r.id))} /> },
              ]
            : [
                { key: 'code', header: 'Code', cell: (r: any) => <span className="font-mono text-xs">{r.code}</span> },
                { key: 'name', header: 'Name', cell: (r: any) => r.name },
                ...(kind === 'positions' ? [{ key: 'dept', header: 'Department', cell: (r: any) => ref.data?.departments.find((d) => d.id === r.departmentId)?.name ?? '—' }] : []),
                ...(kind === 'shift-types' ? [{ key: 'times', header: 'Default times', cell: (r: any) => (r.defaultStart ? `${r.defaultStart}–${r.defaultEnd}` : '—') }] : []),
                ...(kind === 'branches' ? [{ key: 'parish', header: 'Parish', cell: (r: any) => r.parish ?? '—' }] : []),
                { key: 'active', header: 'Status', cell: (r: any) => <StatusBadge status={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
                { key: 'x', header: '', cell: (r: any) => writable && <Button size="sm" variant="ghost" aria-label="Delete" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={(e) => (e.stopPropagation(), remove.mutate(r.id))} /> },
              ]
        }
      />
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${editing?.id ? 'Edit' : 'Add'} ${MASTER_LABELS[kind].toLowerCase()}`} footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="space-y-4">
          {holiday ? (
            <FormGrid>
              <Field label="Date" required>{(p) => <Input {...p} type="date" value={values.date?.slice(0, 10) ?? ''} onChange={(e) => setValues({ ...values, date: e.target.value })} />}</Field>
              <Field label="Name" required>{(p) => <Input {...p} value={values.name ?? ''} onChange={(e) => setValues({ ...values, name: e.target.value })} />}</Field>
            </FormGrid>
          ) : (
            <>
              <FormGrid>
                <Field label="Code" required>{(p) => <Input {...p} value={values.code ?? ''} onChange={(e) => setValues({ ...values, code: e.target.value })} />}</Field>
                <Field label="Name" required>{(p) => <Input {...p} value={values.name ?? ''} onChange={(e) => setValues({ ...values, name: e.target.value })} />}</Field>
                {kind === 'positions' && (
                  <Field label="Department">
                    {(p) => (
                      <Select {...p} value={values.departmentId ?? ''} onChange={(e) => setValues({ ...values, departmentId: e.target.value })}>
                        <option value="">None</option>
                        {ref.data?.departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                {kind === 'branches' && (
                  <Field label="Parish">
                    {(p) => (
                      <Select {...p} value={values.parish ?? ''} onChange={(e) => setValues({ ...values, parish: e.target.value })}>
                        <option value="">Select</option>
                        {ref.data?.parishes.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                {kind === 'shift-types' && (
                  <>
                    <Field label="Default start">{(p) => <Input {...p} type="time" value={values.defaultStart ?? ''} onChange={(e) => setValues({ ...values, defaultStart: e.target.value })} />}</Field>
                    <Field label="Default end">{(p) => <Input {...p} type="time" value={values.defaultEnd ?? ''} onChange={(e) => setValues({ ...values, defaultEnd: e.target.value })} />}</Field>
                  </>
                )}
              </FormGrid>
              <Field label="Description">{(p) => <Input {...p} value={values.description ?? ''} onChange={(e) => setValues({ ...values, description: e.target.value })} />}</Field>
              <Checkbox label="Active" checked={values.active ?? true} onChange={(e) => setValues({ ...values, active: e.target.checked })} />
            </>
          )}
        </div>
      </Modal>
    </Card>
  );
}

// ── Subscription (LIC-008, AC-04) ───────────────────────────────────────────
export function Subscription() {
  const { can, refresh } = useSession();
  const q = useApi<any>(['subscription'], '/subscription');
  const plans = useApi<any[]>(['plans'], '/subscription/plans');
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<z.input<typeof redeemCodeSchema>>(redeemCodeSchema);
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/subscription/redeem-code', v);
      toast.success('Subscription activated', 'Your new plan entitlements are active now.');
      form.reset({ code: '' });
      await qc.invalidateQueries({ queryKey: ['subscription'] });
      await refresh();
    } catch (x) {
      form.setError('code', { message: errorMessage(x) });
    }
  });
  const s = q.data?.summary;
  const sub = q.data?.subscription;
  return (
    <>
      <PageHeader title="Subscription" description="Plan, entitlements, usage and activation" />
      {s?.readOnly && (
        <div className="mb-5">
          <Alert tone="error" title={`Subscription ${s.status.toLowerCase()}`}>Contact Qwik Business Solutions to renew. Renewal of an existing paid subscription does not require a new activation code.</Alert>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={<span className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-brand" />{s?.planName ?? '…'} plan</span>} actions={s && <StatusBadge status={s.status} />} />
          <CardBody className="space-y-5">
            <KeyValue
              columns={3}
              items={[
                { label: 'Licence key', value: <code className="text-xs">{sub?.licenseKey ?? '—'}</code> },
                { label: 'Period start', value: formatDate(sub?.periodStart) },
                { label: 'Renews / expires', value: sub?.periodEnd ? formatDate(sub.periodEnd) : 'No fixed expiry' },
                { label: 'Grace period ends', value: formatDate(sub?.graceEnd) },
                { label: 'Active employees', value: s ? `${s.activeEmployees} / ${s.employeeLimit}` : '—' },
                { label: 'Users (incl. invited)', value: s ? `${s.activeUsers} / ${s.userLimit}` : '—' },
              ]}
            />
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Included features</p>
              <div className="flex flex-wrap gap-2">
                {q.data?.features.map((f: any) => (
                  <Badge key={f.code} tone={f.enabled ? 'green' : 'gray'}>
                    {f.enabled ? '✓' : '✕'} {f.name}
                  </Badge>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
        {can('subscription.manage') && (
          <Card>
            <CardHeader title="Activate a paid plan" description="Enter the one-time authorization code issued by Qwik Business Solutions after your payment is verified." />
            <CardBody>
              <form onSubmit={submit} className="space-y-3">
                <Field label="Authorization code" error={form.formState.errors.code?.message} required>
                  {(p) => <Input {...p} className="font-mono uppercase" placeholder="QWK-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" {...form.register('code')} />}
                </Field>
                <Button type="submit" className="w-full" icon={<KeyRound className="h-4 w-4" />} loading={form.formState.isSubmitting}>
                  Redeem code
                </Button>
              </form>
              <p className="mt-3 text-xs text-slate-500">Codes are single-use, expire, and are bound to your organization. Online payment is not available — Qwik records and verifies payments manually.</p>
            </CardBody>
          </Card>
        )}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Available plans" description="Contact Qwik Business Solutions for pricing" />
          <DataTable
            rows={plans.data}
            rowKey={(p: any) => p.code}
            columns={[
              { key: 'name', header: 'Plan', cell: (p: any) => <span className="font-medium">{p.name}</span> },
              { key: 'emp', header: 'Employees', align: 'right', cell: (p: any) => p.employeeLimit },
              { key: 'users', header: 'Users', align: 'right', cell: (p: any) => p.userLimit },
              { key: 'price', header: 'Price', align: 'right', cell: (p: any) => (p.isFree ? 'Free' : p.price ? `${p.currency} ${p.price}` : 'Contact sales') },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Subscription history" />
          <DataTable
            rows={q.data?.history}
            rowKey={(e: any) => e.id}
            empty={<EmptyState title="No events" />}
            columns={[
              { key: 'at', header: 'When', cell: (e: any) => formatDateTime(e.createdAt) },
              { key: 'type', header: 'Event', cell: (e: any) => e.type.replace(/_/g, ' ').toLowerCase() },
              { key: 'to', header: 'Status', cell: (e: any) => <StatusBadge status={e.toStatus} /> },
            ]}
          />
        </Card>
        <BillingDocuments />
      </div>
    </>
  );
}

/** LIC-014: invoices, receipts and statements issued by Qwik for this company (read-only). */
function BillingDocuments() {
  const q = useApi<{ invoices: any[]; receipts: any[] }>(['billing-docs'], '/subscription/billing');
  const toast = useToast();
  const open = (path: string) => api.download(path, { open: true }).catch((e) => toast.error('Could not open document', errorMessage(e)));
  const year = new Date().getFullYear();
  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="Billing documents"
        description="Invoices and receipts from Qwik Business Solutions. Payments are made by bank transfer, cash or cheque — never inside the app."
        actions={<Button size="sm" variant="outline" onClick={() => open(`/subscription/billing/statement?from=${year}-01-01&to=${new Date().toISOString().slice(0, 10)}`)}>Statement {year}</Button>}
      />
      <DataTable
        rows={[...(q.data?.invoices ?? []).map((i) => ({ ...i, kind: 'Invoice', date: i.issueDate, amount: i.total, path: `/subscription/billing/invoices/${i.id}/pdf` })), ...(q.data?.receipts ?? []).map((r) => ({ ...r, id: r.paymentId, kind: 'Receipt', path: `/subscription/billing/receipts/${r.paymentId}/pdf` }))].sort((a, b) => String(b.date).localeCompare(String(a.date)))}
        loading={q.isLoading}
        rowKey={(r: any) => `${r.kind}-${r.id}`}
        empty={<EmptyState title="No billing documents yet" />}
        columns={[
          { key: 'kind', header: 'Document', cell: (r: any) => <span><span className="font-medium">{r.kind}</span> <span className="font-mono text-xs text-slate-500">{r.number}</span></span> },
          { key: 'date', header: 'Date', cell: (r: any) => formatDate(r.date) },
          { key: 'amount', header: 'Amount', align: 'right', cell: (r: any) => formatMoney(r.amount, r.currency) },
          { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
          { key: 'x', header: '', cell: (r: any) => <Button size="sm" variant="ghost" onClick={() => open(r.path)}>PDF</Button> },
        ]}
      />
    </Card>
  );
}

// ── Audit log ──────────────────────────────────────────────────────────────
export function AuditLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const q = usePaged<any>(['audit'], '/audit', { page, pageSize: 50, action: action || undefined, entityType: entityType || undefined });
  const [detail, setDetail] = useState<any | null>(null);
  return (
    <>
      <PageHeader title="Audit log" description="Immutable record of sensitive actions — tenant users cannot modify or delete audit events" />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input className="w-56" aria-label="Filter by action" placeholder="Action contains… (e.g. payroll)" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} />
          <Input className="w-48" aria-label="Filter by entity type" placeholder="Entity type (e.g. Employee)" value={entityType} onChange={(e) => (setEntityType(e.target.value), setPage(1))} />
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          onRowClick={setDetail}
          columns={[
            { key: 'at', header: 'When', cell: (r: any) => formatDateTime(r.createdAt) },
            { key: 'action', header: 'Action', cell: (r: any) => <span className="font-mono text-xs">{r.action}</span> },
            { key: 'entity', header: 'Entity', hideOnMobile: true, cell: (r: any) => `${r.entityType}${r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}` },
            { key: 'actor', header: 'Actor', cell: (r: any) => r.actorEmail ?? 'system' },
            { key: 'ip', header: 'IP', hideOnMobile: true, cell: (r: any) => r.ip ?? '—' },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Audit event" size="lg">
        {detail && (
          <div className="space-y-3 text-sm">
            <KeyValue
              items={[
                { label: 'Action', value: detail.action },
                { label: 'When', value: formatDateTime(detail.createdAt) },
                { label: 'Actor', value: detail.actorEmail },
                { label: 'Entity', value: `${detail.entityType} ${detail.entityId ?? ''}` },
                { label: 'Request ID', value: <code className="text-xs">{detail.requestId}</code> },
                { label: 'Reason', value: detail.reason },
              ]}
            />
            {['before', 'after', 'metadata'].map((k) => detail[k] && (
              <div key={k}>
                <p className="text-xs font-semibold uppercase text-slate-500">{k}</p>
                <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-100">{JSON.stringify(detail[k], null, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

// ── Account & security ─────────────────────────────────────────────────────
export function Account() {
  const { me } = useSession();
  const toast = useToast();
  const form = useZodForm<any>(changePasswordSchema.extend({ confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' }));
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      toast.success('Password changed', 'Other sessions were signed out.');
      form.reset();
    } catch (x) {
      toast.error('Could not change password', errorMessage(x));
    }
  });
  return (
    <>
      <PageHeader title="Account & security" description={me!.user.email} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Change password" />
          <CardBody>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Current password" error={errors.currentPassword?.message} required>
                {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register('currentPassword')} />}
              </Field>
              <Field label="New password" error={errors.newPassword?.message} required hint="At least 12 characters with upper/lower-case and a number">
                {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('newPassword')} />}
              </Field>
              <Field label="Confirm new password" error={errors.confirm?.message} required>
                {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('confirm')} />}
              </Field>
              <Button type="submit" loading={form.formState.isSubmitting}>
                Update password
              </Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Two-step verification" />
          <CardBody>
            {me!.user.mfaEnabled ? (
              <Alert tone="success" title="Enabled">
                <span className="flex gap-2">
                  <ShieldCheck className="h-4 w-4" /> Your account is protected with an authenticator app.
                </span>
              </Alert>
            ) : (
              <Alert tone="warning" title="Not enabled" action={<a href="/mfa/setup"><Button size="sm">Set up</Button></a>}>
                Strongly recommended. Required for administrator, payroll and finance roles.
              </Alert>
            )}
          </CardBody>
        </Card>
        <NotificationPreferences />
      </div>
    </>
  );
}
