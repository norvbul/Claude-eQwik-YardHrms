import { useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardBody, CardHeader, DataTable, Field, Input, Modal, StatusBadge, Textarea, errorMessage, formatDate, formatDateTime, useToast } from '@yardhrms/ui';
import { Archive, Download, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

/** NFR-011: retention policy, full data export and account closure (Company Administrators). */
export function DataPrivacy() {
  return (
    <div className="space-y-5">
      <RetentionCard />
      <ExportsCard />
      <ClosureCard />
    </div>
  );
}

function RetentionCard() {
  const q = useApi<any>(['retention'], '/data/retention');
  const [values, setValues] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    if (q.data) setValues(q.data.policy);
  }, [q.data]);
  return (
    <Card>
      <CardHeader
        title="Data retention"
        description="How long records are kept before they are deleted or anonymised automatically. Statutory minimums cannot be reduced."
        actions={q.data?.legalHold ? <Badge tone="red">Legal hold</Badge> : undefined}
      />
      <CardBody className="space-y-4">
        {q.data?.legalHold && (
          <Alert tone="warning" title="Legal hold in place">
            Nothing is deleted while the hold applies. Reason: {q.data.legalHoldReason}
          </Alert>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Records</th>
                <th className="py-2 pr-3">Keep for</th>
                <th className="hidden py-2 md:table-cell">Basis</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.rules.map((r: any) => (
                <tr key={r.key} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-slate-800">{r.label}</p>
                    <p className="text-xs text-slate-500">counted from {r.from}</p>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <Input aria-label={`${r.label} (${r.unit})`} type="number" min={r.min} max={r.max} className="w-24" value={values[r.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [r.key]: Number(e.target.value) }))} />
                      <span className="text-xs text-slate-500">{r.unit}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">minimum {r.min}</p>
                  </td>
                  <td className="hidden py-2 text-xs text-slate-500 md:table-cell">{r.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.put('/data/retention', values);
              toast.success('Retention policy saved');
              await qc.invalidateQueries({ queryKey: ['retention'] });
            } catch (e) {
              toast.error('Could not save', errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save retention policy
        </Button>
        <p className="text-xs text-slate-500">Periods follow Jamaican requirements as researched for this release (payroll records: at least seven years). Confirm them with your legal adviser.</p>
      </CardBody>
    </Card>
  );
}

function ExportsCard() {
  const q = useApi<any[]>(['data-exports'], '/data/exports', undefined, {});
  const toast = useToast();
  const qc = useQueryClient();
  const pending = q.data?.some((e) => e.status === 'QUEUED');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ['data-exports'] }), 4000);
    return () => clearInterval(t);
  }, [pending, qc]);
  return (
    <Card>
      <CardHeader
        title="Export all data"
        description="A ZIP of every record your organization holds (CSV) plus payslip PDFs. Contains personal and bank data — store it securely. Available for 7 days."
        actions={
          <Button
            size="sm"
            icon={<Archive className="h-4 w-4" />}
            disabled={pending}
            onClick={async () => {
              try {
                await api.post('/data/exports');
                toast.success('Export started', 'You will be notified when it is ready.');
                await qc.invalidateQueries({ queryKey: ['data-exports'] });
              } catch (e) {
                toast.error('Could not start export', errorMessage(e));
              }
            }}
          >
            Request export
          </Button>
        }
      />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r: any) => r.id}
        empty={<p className="p-6 text-center text-sm text-slate-500">No exports yet.</p>}
        columns={[
          { key: 'created', header: 'Requested', cell: (r: any) => formatDateTime(r.createdAt) },
          { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
          { key: 'size', header: 'Size', hideOnMobile: true, cell: (r: any) => (r.sizeBytes ? `${(r.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '—') },
          { key: 'exp', header: 'Expires', hideOnMobile: true, cell: (r: any) => (r.expiresAt ? formatDateTime(r.expiresAt) : '—') },
          {
            key: 'x',
            header: '',
            cell: (r: any) =>
              r.status === 'READY' && (
                <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => api.download(`/data/exports/${r.id}/download`).catch((e) => toast.error('Download failed', errorMessage(e)))}>
                  Download
                </Button>
              ),
          },
        ]}
      />
    </Card>
  );
}

function ClosureCard() {
  const { me } = useSession();
  const q = useApi<any[]>(['deletion-requests'], '/data/deletion-requests');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const active = q.data?.find((r) => r.status === 'PENDING' || r.status === 'APPROVED');
  const name = me!.activeTenant!.displayName;
  return (
    <Card className="border-red-200">
      <CardHeader title="Close account" description="Permanently end your organization’s use of eQwik YardHRMS." />
      <CardBody className="space-y-3 text-sm text-slate-600">
        <p>
          After a 30-day cooling-off period and confirmation by Qwik Business Solutions, access ends for every user and data not required by law is erased. Payroll and related records are kept, inaccessible, for the
          statutory retention period and then deleted automatically. Export your data first.
        </p>
        {active ? (
          <Alert
            tone="warning"
            title={`Closure ${active.status === 'APPROVED' ? 'approved' : 'requested'}`}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api.post(`/data/deletion-requests/${active.id}/cancel`);
                    toast.success('Closure request cancelled');
                    await qc.invalidateQueries({ queryKey: ['deletion-requests'] });
                  } catch (e) {
                    toast.error('Could not cancel', errorMessage(e));
                  }
                }}
              >
                Cancel request
              </Button>
            }
          >
            Requested {formatDate(active.createdAt)}. Nothing happens before {formatDate(active.coolingOffUntil)}.
          </Alert>
        ) : (
          <Button variant="danger" icon={<ShieldAlert className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Request account closure
          </Button>
        )}
      </CardBody>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Request account closure"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 10 || confirmName.trim().toLowerCase() !== name.toLowerCase()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.post<any>('/data/deletion-requests', { reason, confirmName });
                  toast.success('Closure requested', `Statutory records will be kept until ${r.statutoryRecordsKeptUntil}.`);
                  setOpen(false);
                  await qc.invalidateQueries({ queryKey: ['deletion-requests'] });
                } catch (e) {
                  toast.error('Could not request closure', errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Request closure
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Reason" required hint="At least 10 characters">
            {(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Field label={`Type “${name}” to confirm`} required>
            {(p) => <Input {...p} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />}
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
