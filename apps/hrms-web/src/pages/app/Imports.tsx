import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, PageHeader, Pagination, Select, Spinner, StatusBadge, Tabs, errorMessage, formatDateTime, useToast } from '@yardhrms/ui';
import { FileSpreadsheet, Play, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DownloadButton } from '@/components/common';
import { api } from '@/lib/api';
import { useApi, usePaged } from '@/lib/hooks';

export function Imports() {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<'employees' | 'timesheets'>('employees');
  const q = usePaged<any>(['imports'], '/imports', { page });
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Bulk imports" description="Upload Excel (.xlsx) or CSV files. Every row receives an outcome; valid rows are committed exactly once in a background job." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="New import" />
          <CardBody className="space-y-4">
            <Tabs
              value={kind}
              onChange={setKind}
              tabs={[
                { value: 'employees', label: 'Employees' },
                { value: 'timesheets', label: 'Timesheets' },
              ]}
            />
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>Download the versioned template and fill it in.</li>
              <li>Upload — the file is validated and previewed (nothing is saved yet).</li>
              <li>Review mapping and row errors, then run the import.</li>
            </ol>
            {kind === 'employees' ? (
              <Alert tone="info">Blank Employee Number creates a new employee; an existing number updates it. Blank cells keep existing values; use #CLEAR to clear an optional field.</Alert>
            ) : (
              <Alert tone="info">Monthly employees are rejected (they do not submit regular timesheets). Imported timesheets start as Pending.</Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <DownloadButton path={`/imports/templates/${kind}`} label="Download template" />
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setBusy(true);
                  try {
                    const r = await api.upload<any>(`/imports/${kind}`, f);
                    toast.success('File validated', `${r.counts.VALID ?? 0} valid, ${r.counts.REJECTED ?? 0} rejected`);
                    navigate(`/app/imports/${r.batch.id}`);
                  } catch (x) {
                    toast.error('Upload failed', errorMessage(x));
                  } finally {
                    setBusy(false);
                    e.target.value = '';
                  }
                }}
              />
              <Button icon={<Upload className="h-4 w-4" />} loading={busy} onClick={() => fileRef.current?.click()}>
                Upload file
              </Button>
            </div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Import history" />
          <DataTable
            rows={q.data?.items}
            loading={q.isLoading}
            rowKey={(r: any) => r.id}
            onRowClick={(r: any) => navigate(`/app/imports/${r.id}`)}
            empty={<EmptyState icon={<FileSpreadsheet className="h-6 w-6" />} title="No imports yet" />}
            columns={[
              { key: 'file', header: 'File', cell: (r: any) => <div><p className="font-medium">{r.fileName}</p><p className="text-xs text-slate-500">{r.type.toLowerCase()} · {formatDateTime(r.createdAt)}</p></div> },
              { key: 'rows', header: 'Rows', align: 'right', cell: (r: any) => r.totalRows },
              { key: 'res', header: 'Result', hideOnMobile: true, cell: (r: any) => (r.status === 'COMPLETED' ? `${r.createdCount} created · ${r.updatedCount} updated · ${r.rejectedCount} rejected` : `${r.validRows} valid · ${r.rejectedCount} rejected`) },
              { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
            ]}
          />
          {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
        </Card>
      </div>
    </>
  );
}

export function ImportDetail() {
  const { id } = useParams();
  const [outcome, setOutcome] = useState('');
  const [rowPage, setRowPage] = useState(1);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['import', id, outcome, rowPage],
    queryFn: () => api.get<any>(`/imports/${id}`, { outcome: outcome || undefined, rowPage }),
    refetchInterval: (query) => (['QUEUED', 'PROCESSING'].includes(query.state.data?.batch.status) ? 2000 : false),
  });
  const capacity = useApi<any>(['import-capacity', id], q.data?.batch.type === 'EMPLOYEES' && q.data?.batch.status === 'VALIDATED' ? `/imports/${id}/capacity` : null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setMapping(q.data.batch.mapping ?? {});
  }, [q.data?.batch.mapping]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <EmptyState title="Import not found" />;
  const { batch, rows, counts, rowTotal } = q.data;
  const editable = ['UPLOADED', 'VALIDATED'].includes(batch.status);
  const headers: string[] = batch.headers ?? [];
  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/app/imports" className="hover:underline">Imports</Link>}
        title={
          <span className="flex items-center gap-3">
            {batch.fileName} <StatusBadge status={batch.status} />
          </span>
        }
        description={`${batch.type.toLowerCase()} import · template v${batch.templateVersion ?? '?'} · ${batch.totalRows} rows`}
        actions={
          <>
            <DownloadButton path={`/imports/${id}/results.csv`} label="Row results CSV" />
            {batch.status === 'VALIDATED' && (
              <Button
                icon={<Play className="h-4 w-4" />}
                disabled={!counts.VALID}
                onClick={async () => {
                  try {
                    await api.post(`/imports/${id}/execute`);
                    toast.success('Import queued', 'Rows are being processed in the background.');
                    await qc.invalidateQueries({ queryKey: ['import', id] });
                  } catch (e) {
                    toast.error('Could not start import', errorMessage(e));
                  }
                }}
              >
                Import {counts.VALID ?? 0} valid row(s)
              </Button>
            )}
          </>
        }
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {Object.entries(counts).map(([k, v]) => (
          <Badge key={k} tone={k === 'REJECTED' ? 'red' : k === 'CREATED' || k === 'VALID' ? 'green' : 'blue'}>
            {k.toLowerCase()}: {String(v)}
          </Badge>
        ))}
      </div>
      {['QUEUED', 'PROCESSING'].includes(batch.status) && (
        <div className="mb-5">
          <Alert tone="info" title="Processing">This page refreshes automatically. Rows are committed one at a time; retries never duplicate committed rows.</Alert>
        </div>
      )}
      {capacity.data && capacity.data.overBy > 0 && (
        <div className="mb-5">
          <Alert tone="warning" title="Plan employee limit">
            This file creates {capacity.data.creates} employees; your plan allows {capacity.data.limit} active ({capacity.data.active} in use). {capacity.data.overBy} row(s) will be rejected unless you upgrade.
          </Alert>
        </div>
      )}
      {editable && (
        <Card className="mb-5">
          <CardHeader title="Column mapping" description="Columns were matched automatically by header name. Adjust and re-validate if needed." />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {batch.columns.map((c: any) => (
                <label key={c.key} className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">
                    {c.label} {c.required && <span className="text-red-600">*</span>}
                  </span>
                  <Select value={mapping[c.key] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [c.key]: e.target.value }))}>
                    <option value="">— not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
            <Button
              className="mt-4"
              variant="outline"
              onClick={async () => {
                try {
                  await api.put(`/imports/${id}/mapping`, { mapping });
                  toast.success('Re-validated');
                  await qc.invalidateQueries({ queryKey: ['import', id] });
                } catch (e) {
                  toast.error('Could not update mapping', errorMessage(e));
                }
              }}
            >
              Save mapping & re-validate
            </Button>
          </CardBody>
        </Card>
      )}
      <Card>
        <div className="flex gap-3 border-b border-slate-100 p-4">
          <Select className="w-48" aria-label="Outcome filter" value={outcome} onChange={(e) => (setOutcome(e.target.value), setRowPage(1))}>
            <option value="">All rows</option>
            {['VALID', 'REJECTED', 'CREATED', 'UPDATED', 'SKIPPED', 'PENDING'].map((o) => (
              <option key={o} value={o}>
                {o.toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          rows={rows}
          rowKey={(r: any) => r.id}
          columns={[
            { key: 'row', header: 'Row', cell: (r: any) => r.rowNumber },
            { key: 'outcome', header: 'Outcome', cell: (r: any) => <StatusBadge status={r.outcome} /> },
            { key: 'summary', header: 'Data', cell: (r: any) => <span className="line-clamp-1 max-w-md text-xs text-slate-500">{Object.values(r.data as Record<string, string>).filter(Boolean).slice(0, 6).join(' · ')}</span> },
            { key: 'errors', header: 'Errors', cell: (r: any) => (r.errors?.length ? <ul className="text-xs text-red-700">{r.errors.map((e: any, i: number) => <li key={i}>{e.message}</li>)}</ul> : '—') },
          ]}
        />
        <Pagination page={rowPage} totalPages={Math.ceil(rowTotal / 100)} total={rowTotal} onPage={setRowPage} />
      </Card>
    </>
  );
}
