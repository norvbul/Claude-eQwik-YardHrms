import { employeeCreateSchema, employeeUpdateSchema } from '@yardhrms/types';
import { Button, Checkbox, Drawer, Field, Input, Select, errorMessage, useToast } from '@yardhrms/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Controller } from 'react-hook-form';
import { FormGrid, RefSelect, SectionTitle, useReferenceData } from '@/components/common';
import { api } from '@/lib/api';
import { applyServerErrors, useZodForm } from '@/lib/hooks';
import type { Employee } from '@/lib/types';

type FormValues = Record<string, any>;

const blankToNull = (o: FormValues) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));

/** Create (full) or edit (personal & job data; compensation is changed through the audited compensation flow). */
export function EmployeeForm({ open, onClose, employee, onSaved }: { open: boolean; onClose: () => void; employee?: Employee; onSaved: (e: Employee) => void }) {
  const editing = !!employee;
  const ref = useReferenceData();
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<FormValues>(editing ? employeeUpdateSchema : employeeCreateSchema);
  const { register, formState, watch, setValue, control } = form;
  const errors = formState.errors as Record<string, { message?: string }>;

  useEffect(() => {
    if (!open) return;
    if (employee) {
      form.reset({
        employeeNumber: employee.employeeNumber,
        firstName: employee.firstName,
        middleName: employee.middleName ?? '',
        lastName: employee.lastName,
        preferredName: employee.preferredName ?? '',
        email: employee.email ?? '',
        phone: employee.phone ?? '',
        mobile: employee.mobile ?? '',
        dateOfBirth: employee.dateOfBirth ?? '',
        gender: employee.gender ?? null,
        addressLine1: employee.addressLine1 ?? '',
        addressLine2: employee.addressLine2 ?? '',
        city: employee.city ?? '',
        parish: employee.parish ?? '',
        departmentId: employee.departmentId,
        branchId: employee.branchId,
        positionId: employee.positionId,
        employmentTypeId: employee.employmentTypeId,
        supervisorId: employee.supervisorId,
        hireDate: employee.hireDate,
        probationEndDate: employee.probationEndDate ?? '',
        confirmationDate: employee.confirmationDate ?? '',
        version: employee.version,
        changeReason: '',
      });
    } else {
      form.reset({ payFrequency: 'MONTHLY', payType: 'SALARY', overtimeEligible: false, statutoryExemptions: [], hireDate: new Date().toISOString().slice(0, 10) });
      api.get<{ employeeNumber: string }>('/employees/next-number').then((r) => setValue('employeeNumber', r.employeeNumber)).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee]);

  const payType = watch('payType');
  const payFrequency = watch('payFrequency');

  const onSubmit = form.handleSubmit(async (raw) => {
    const v = blankToNull(raw);
    try {
      let saved: Employee;
      if (editing) {
        // identifiers are only sent when the user typed a new value (masked values are never echoed back)
        for (const k of ['trn', 'nisNumber', 'nhtNumber']) if (!v[k]) delete v[k];
        saved = await api.patch<Employee>(`/employees/${employee!.id}`, v);
      } else {
        saved = await api.post<Employee>('/employees', v);
      }
      await qc.invalidateQueries({ queryKey: ['employees'] });
      toast.success(editing ? 'Employee updated' : 'Employee created', `${saved.firstName} ${saved.lastName} (${saved.employeeNumber})`);
      onSaved(saved);
      onClose();
    } catch (e) {
      if (!applyServerErrors(form, e)) toast.error('Could not save employee', errorMessage(e));
    }
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${employee!.firstName} ${employee!.lastName}` : 'Add employee'}
      description={editing ? 'Changes are audited with before/after values' : 'New active employees count against your plan limit'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create employee'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-8" noValidate>
        <section>
          <SectionTitle>Personal</SectionTitle>
          <FormGrid>
            <Field label="Employee number" error={errors.employeeNumber?.message} required>
              {(p) => <Input {...p} {...register('employeeNumber')} />}
            </Field>
            <Field label="Preferred name" error={errors.preferredName?.message}>
              {(p) => <Input {...p} {...register('preferredName')} />}
            </Field>
            <Field label="First name" error={errors.firstName?.message} required>
              {(p) => <Input {...p} {...register('firstName')} />}
            </Field>
            <Field label="Middle name" error={errors.middleName?.message}>
              {(p) => <Input {...p} {...register('middleName')} />}
            </Field>
            <Field label="Last name" error={errors.lastName?.message} required>
              {(p) => <Input {...p} {...register('lastName')} />}
            </Field>
            <Field label="Date of birth" error={errors.dateOfBirth?.message}>
              {(p) => <Input {...p} type="date" {...register('dateOfBirth')} />}
            </Field>
            <Field label="Gender" error={errors.gender?.message}>
              {(p) => (
                <Select {...p} {...register('gender', { setValueAs: (v) => v || null })}>
                  <option value="">Not specified</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="OTHER">Other</option>
                  <option value="UNDISCLOSED">Prefer not to say</option>
                </Select>
              )}
            </Field>
          </FormGrid>
        </section>
        <section>
          <SectionTitle>Contact & address</SectionTitle>
          <FormGrid>
            <Field label="Email" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" {...register('email')} />}
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              {(p) => <Input {...p} {...register('phone')} />}
            </Field>
            <Field label="Address line 1" error={errors.addressLine1?.message}>
              {(p) => <Input {...p} {...register('addressLine1')} />}
            </Field>
            <Field label="Address line 2" error={errors.addressLine2?.message}>
              {(p) => <Input {...p} {...register('addressLine2')} />}
            </Field>
            <Field label="City / town" error={errors.city?.message}>
              {(p) => <Input {...p} {...register('city')} />}
            </Field>
            <Field label="Parish" error={errors.parish?.message}>
              {(p) => (
                <Select {...p} {...register('parish')}>
                  <option value="">Select parish</option>
                  {ref.data?.parishes.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              )}
            </Field>
          </FormGrid>
        </section>
        <section>
          <SectionTitle>Statutory identifiers</SectionTitle>
          <p className="mb-3 text-xs text-slate-500">Stored encrypted. {editing && 'Leave blank to keep the existing value.'}</p>
          <FormGrid cols={3}>
            <Field label="TRN" error={errors.trn?.message} hint="9 digits">
              {(p) => <Input {...p} inputMode="numeric" autoComplete="off" placeholder={editing ? employee!.trn ?? '' : ''} {...register('trn')} />}
            </Field>
            <Field label="NIS number" error={errors.nisNumber?.message}>
              {(p) => <Input {...p} autoComplete="off" placeholder={editing ? employee!.nisNumber ?? '' : ''} {...register('nisNumber')} />}
            </Field>
            <Field label="NHT number" error={errors.nhtNumber?.message}>
              {(p) => <Input {...p} autoComplete="off" placeholder={editing ? employee!.nhtNumber ?? '' : ''} {...register('nhtNumber')} />}
            </Field>
          </FormGrid>
        </section>
        <section>
          <SectionTitle>Job</SectionTitle>
          <FormGrid>
            {(['departmentId', 'branchId', 'positionId', 'employmentTypeId'] as const).map((k) => (
              <Field key={k} label={{ departmentId: 'Department', branchId: 'Branch', positionId: 'Position', employmentTypeId: 'Employment type' }[k]}>
                {(p) => (
                  <Controller
                    control={control}
                    name={k}
                    render={({ field }) => (
                      <RefSelect
                        {...p}
                        items={{ departmentId: ref.data?.departments, branchId: ref.data?.branches, positionId: ref.data?.positions, employmentTypeId: ref.data?.employmentTypes }[k]}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                )}
              </Field>
            ))}
            <Field label="Hire date" error={errors.hireDate?.message} required>
              {(p) => <Input {...p} type="date" {...register('hireDate')} />}
            </Field>
            <Field label="Probation end" error={errors.probationEndDate?.message}>
              {(p) => <Input {...p} type="date" {...register('probationEndDate')} />}
            </Field>
            <Field label="Confirmation date" error={errors.confirmationDate?.message}>
              {(p) => <Input {...p} type="date" {...register('confirmationDate')} />}
            </Field>
          </FormGrid>
        </section>
        {!editing && (
          <section>
            <SectionTitle>Pay</SectionTitle>
            <FormGrid>
              <Field label="Pay frequency" error={errors.payFrequency?.message} required>
                {(p) => (
                  <Select
                    {...p}
                    {...register('payFrequency', {
                      onChange: (e) => {
                        if (e.target.value === 'MONTHLY') setValue('payType', 'SALARY');
                      },
                    })}
                  >
                    <option value="WEEKLY">Weekly</option>
                    <option value="FORTNIGHTLY">Fortnightly</option>
                    <option value="MONTHLY">Monthly</option>
                  </Select>
                )}
              </Field>
              <Field label="Pay type" error={errors.payType?.message} required hint={payFrequency === 'MONTHLY' ? 'Monthly employees are salaried and do not submit regular timesheets' : undefined}>
                {(p) => (
                  <Select {...p} {...register('payType')} disabled={payFrequency === 'MONTHLY'}>
                    <option value="SALARY">Salary</option>
                    <option value="HOURLY">Hourly</option>
                  </Select>
                )}
              </Field>
              {payType === 'SALARY' ? (
                <Field label="Salary per pay period (JMD)" error={errors.salaryPerPeriod?.message} required hint={payFrequency === 'MONTHLY' ? 'Contractual monthly amount' : undefined}>
                  {(p) => <Input {...p} inputMode="decimal" {...register('salaryPerPeriod')} />}
                </Field>
              ) : (
                <Field label="Hourly rate (JMD)" error={errors.hourlyRate?.message} required>
                  {(p) => <Input {...p} inputMode="decimal" {...register('hourlyRate')} />}
                </Field>
              )}
              <Field label="Standard hours override" hint="Leave blank to use the pay-frequency standard (Monthly default 173.33)" error={errors.standardHoursOverride?.message}>
                {(p) => <Input {...p} inputMode="decimal" {...register('standardHoursOverride')} />}
              </Field>
              <div className="sm:col-span-2">
                <Checkbox label="Eligible for overtime" {...register('overtimeEligible')} />
              </div>
            </FormGrid>
          </section>
        )}
        {editing && (
          <Field label="Reason for change" hint="Recorded in the audit trail" error={errors.changeReason?.message}>
            {(p) => <Input {...p} {...register('changeReason')} />}
          </Field>
        )}
      </form>
    </Drawer>
  );
}
