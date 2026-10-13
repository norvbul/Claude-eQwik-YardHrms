import { useQueryClient } from '@tanstack/react-query';
import { Button, Select, errorMessage, useConfirm, useToast } from '@yardhrms/ui';
import { Check, Undo2, X } from 'lucide-react';
import { api } from '@/lib/api';

/** Approve / reject / withdraw buttons for leave, timesheet and overtime records. Server enforces policy. */
export function DecisionButtons({
  base,
  id,
  status,
  canApprove,
  canCancel,
  invalidate,
  noun,
}: {
  base: string;
  id: string;
  status: string;
  canApprove: boolean;
  canCancel: boolean;
  invalidate: string[][];
  noun: string;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const act = async (action: 'approve' | 'reject' | 'cancel') => {
    let body: Record<string, unknown> = {};
    if (action === 'reject') {
      const r = await confirm({ title: `Reject ${noun}`, message: 'The submitter will see your reason.', tone: 'danger', confirmLabel: 'Reject', requireReason: 'Reason for rejection' });
      if (!r.ok) return;
      body = { comment: r.reason };
    } else if (action === 'cancel') {
      const r = await confirm({ title: `Withdraw ${noun}`, message: status === 'APPROVED' ? 'Cancelling approved leave restores the balance.' : 'This request will be cancelled.', confirmLabel: 'Withdraw' });
      if (!r.ok) return;
    }
    try {
      await api.post(`${base}/${id}/${action}`, body);
      toast.success(action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Withdrawn');
      for (const k of invalidate) await qc.invalidateQueries({ queryKey: k });
    } catch (e) {
      toast.error('Action failed', errorMessage(e));
    }
  };
  return (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {status === 'PENDING' && canApprove && (
        <>
          <Button size="sm" variant="outline" icon={<Check className="h-4 w-4 text-emerald-600" />} onClick={() => act('approve')} aria-label={`Approve ${noun}`}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="h-4 w-4 text-red-600" />} onClick={() => act('reject')} aria-label={`Reject ${noun}`} />
        </>
      )}
      {canCancel && (status === 'PENDING' || (status === 'APPROVED' && base === '/leave/requests' && canApprove)) && (
        <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={() => act('cancel')} aria-label={`Withdraw ${noun}`} />
      )}
    </div>
  );
}

export function StatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select className="w-40" aria-label="Status filter" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All statuses</option>
      <option value="PENDING">Pending</option>
      <option value="APPROVED">Approved</option>
      <option value="REJECTED">Rejected</option>
      <option value="CANCELLED">Cancelled</option>
    </Select>
  );
}

export function SubjectCell({ e, submittedBy, delegated }: { e: { firstName: string; lastName: string; employeeNumber: string }; submittedBy?: string | null; delegated?: boolean }) {
  return (
    <div>
      <p className="font-medium text-slate-900">
        {e.firstName} {e.lastName}
      </p>
      <p className="text-xs text-slate-500">
        {e.employeeNumber}
        {delegated && submittedBy ? ` · entered by ${submittedBy}` : ''}
      </p>
    </div>
  );
}
