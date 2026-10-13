import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, DataTable, PageHeader, StatusBadge, errorMessage, formatDate, useConfirm, useToast } from '@yardhrms/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';

/** NFR-011: account-closure requests from companies, and legal holds. */
export function DataRequests() {
  const q = useApi<any[]>(['deletion-requests'], '/platform/deletion-requests');
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const act = async (title: string, path: string, message: string, body: (reason: string) => object, tone: 'danger' | 'primary' = 'primary') => {
    const c = await confirm({ title, message, tone, requireReason: 'Note for the record (min 5 characters)' });
    if (!c.ok) return;
    try {
      await api.post(path, body(c.reason ?? ''));
      toast.success('Done');
      await qc.invalidateQueries({ queryKey: ['deletion-requests'] });
    } catch (e) {
      toast.error('Action failed', errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader title="Account closures & legal holds" description="Companies can request closure; it runs after a 30-day cooling-off period once approved here. A legal hold stops all closure and retention deletion." />
      <Alert tone="info" title="Before approving">
        Confirm the request with the company’s director or owner through a known contact, check for outstanding invoices or disputes, and place a legal hold instead if litigation, audit or investigation is expected.
      </Alert>
      <Card className="mt-5">
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          rowKey={(r: any) => r.id}
          empty={<p className="p-6 text-center text-sm text-slate-500">No closure requests.</p>}
          columns={[
            { key: 'tenant', header: 'Company', cell: (r: any) => <div><p className="font-medium">{r.tenant?.displayName ?? r.tenantId}</p>{r.tenant?.legalHold && <p className="text-xs font-semibold text-red-600">Legal hold</p>}</div> },
            { key: 'reason', header: 'Reason', hideOnMobile: true, cell: (r: any) => <span className="line-clamp-2 text-sm">{r.reason}</span> },
            { key: 'when', header: 'Requested', cell: (r: any) => formatDate(r.createdAt) },
            { key: 'cool', header: 'Earliest execution', hideOnMobile: true, cell: (r: any) => formatDate(r.coolingOffUntil) },
            { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
            {
              key: 'x',
              header: '',
              cell: (r: any) => (
                <div className="flex flex-wrap justify-end gap-1">
                  {r.status === 'PENDING' && (
                    <Button size="sm" onClick={() => act('Approve closure', `/platform/deletion-requests/${r.id}/approve`, `${r.tenant?.displayName} will be closed after ${formatDate(r.coolingOffUntil)} unless the company cancels.`, (note) => ({ note }), 'danger')}>
                      Approve
                    </Button>
                  )}
                  {['PENDING', 'APPROVED'].includes(r.status) && (
                    <Button size="sm" variant="outline" onClick={() => act('Reject closure', `/platform/deletion-requests/${r.id}/reject`, 'The company keeps its account.', (note) => ({ note }))}>
                      Reject
                    </Button>
                  )}
                  {r.tenant && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        act(
                          r.tenant.legalHold ? 'Lift legal hold' : 'Place legal hold',
                          `/platform/tenants/${r.tenantId}/legal-hold`,
                          r.tenant.legalHold ? 'Retention and closure resume.' : 'All retention deletion and closure stop until the hold is lifted.',
                          (reason) => ({ enabled: !r.tenant.legalHold, reason }),
                        )
                      }
                    >
                      {r.tenant.legalHold ? 'Lift hold' : 'Legal hold'}
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
