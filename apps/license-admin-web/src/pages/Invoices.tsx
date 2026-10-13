import { useQueryClient } from '@tanstack/react-query';
import { invoiceCreateSchema } from '@yardhrms/types';
import { Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, errorMessage, formatDate, formatMoney, useConfirm, useToast } from '@yardhrms/ui';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray } from 'react-hook-form';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useZodForm } from '@/lib/hooks';
import { useSession } from '@/lib/session';

/** LIC-014: invoices for manual payment. Payments quoting the invoice number settle it when verified. */
export function Invoices() {
  const { can } = useSession();
  const q = useApi<any[]>(['invoices'], '/platform/invoices');
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Issue invoices for manual payment. A verified payment that quotes the invoice number marks it paid; receipts are issued from the payment."
        actions={can('platform.payments.record') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New invoice</Button>}
      />
      <Card>
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          empty={<p className="p-6 text-center text-sm text-slate-500">No invoices yet.</p>}
          columns={[
            { key: 'number', header: 'Number', cell: (r: any) => <span className="font-mono text-xs">{r.number}</span> },
            { key: 'customer', header: 'Customer', cell: (r: any) => r.customerName },
            { key: 'issue', header: 'Issued', hideOnMobile: true, cell: (r: any) => formatDate(r.issueDate) },
            { key: 'due', header: 'Due', hideOnMobile: true, cell: (r: any) => formatDate(r.dueDate) },
            { key: 'total', header: 'Total', align: 'right', cell: (r: any) => formatMoney(r.total, r.currency) },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
            {
              key: 'x',
              header: '',
              cell: (r: any) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" icon={<FileText className="h-4 w-4" />} onClick={() => api.download(`/platform/invoices/${r.id}/pdf`, { open: true }).catch((e) => toast.error('PDF failed', errorMessage(e)))}>
                    PDF
                  </Button>
                  {r.status === 'ISSUED' && can('platform.payments.reverse') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600"
                      onClick={async () => {
                        const c = await confirm({ title: `Void ${r.number}`, message: 'The invoice stays on record marked VOID. Numbers are never reused.', tone: 'danger', requireReason: 'Reason' });
                        if (!c.ok) return;
                        try {
                          await api.post(`/platform/invoices/${r.id}/void`, { reason: c.reason });
                          toast.success('Invoice voided');
                          await qc.invalidateQueries({ queryKey: ['invoices'] });
                        } catch (e) {
                          toast.error('Could not void', errorMessage(e));
                        }
                      }}
                    >
                      Void
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
      {creating && <InvoiceModal onClose={() => setCreating(false)} />}
    </>
  );
}

function InvoiceModal({ onClose }: { onClose: () => void }) {
  const customers = useApi<any[]>(['customers-all'], '/platform/customers', { pageSize: 200 });
  const plans = useApi<any[]>(['plans'], '/platform/plans');
  const qc = useQueryClient();
  const toast = useToast();
  const form = useZodForm<any>(invoiceCreateSchema, { defaultValues: { customerId: '', planId: '', lines: [], notes: '' } });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const errors = form.formState.errors as any;
  const submit = form.handleSubmit(async (v) => {
    try {
      const inv = await api.post<any>('/platform/invoices', v);
      toast.success(`Invoice ${inv.number} issued`);
      await qc.invalidateQueries({ queryKey: ['invoices'] });
      onClose();
      api.download(`/platform/invoices/${inv.id}/pdf`, { open: true }).catch(() => undefined);
    } catch (e) {
      if (!applyServerErrors(form, e)) toast.error('Could not issue invoice', errorMessage(e));
    }
  });
  const customerRows: any[] = Array.isArray(customers.data) ? customers.data : ((customers.data as any)?.items ?? []);
  return (
    <Modal open onClose={onClose} title="New invoice" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Issue invoice</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" required error={errors.customerId?.message}>
            {(p) => (
              <Select {...p} {...form.register('customerId')}>
                <option value="">Select…</option>
                {customerRows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Plan (uses the plan price when no lines are entered)">
            {(p) => (
              <Select {...p} {...form.register('planId')}>
                <option value="">None</option>
                {plans.data?.filter((x) => !x.isFree).map((x) => <option key={x.id} value={x.id}>{x.name}{x.price ? ` — ${formatMoney(x.price, x.currency)}` : ' (no price set)'}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Lines</p>
          {lines.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[1fr_5rem_8rem_auto] items-end gap-2">
              <Field label="Description" error={errors.lines?.[i]?.description?.message}>{(p) => <Input {...p} {...form.register(`lines.${i}.description`)} />}</Field>
              <Field label="Qty">{(p) => <Input {...p} inputMode="decimal" {...form.register(`lines.${i}.quantity`)} />}</Field>
              <Field label="Unit price" error={errors.lines?.[i]?.unitPrice?.message}>{(p) => <Input {...p} inputMode="decimal" {...form.register(`lines.${i}.unitPrice`)} />}</Field>
              <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => lines.remove(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {errors.lines?.message && <p className="text-sm text-red-600">{errors.lines.message}</p>}
          <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => lines.append({ description: '', quantity: 1, unitPrice: '' })}>Add line</Button>
        </div>
        <Field label="Notes">{(p) => <Textarea {...p} rows={2} {...form.register('notes')} />}</Field>
      </form>
    </Modal>
  );
}
