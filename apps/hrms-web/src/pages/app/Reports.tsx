import { Alert, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, Input, PageHeader, Spinner, cn, formatMoney, formatNumber } from '@yardhrms/ui';
import { BarChart3, Lock } from 'lucide-react';
import { useState } from 'react';
import { DownloadButton, RefSelect, useReferenceData } from '@/components/common';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface ReportDef {
  type: string;
  name: string;
  group: string;
  allowed: boolean;
}
interface ReportResult {
  title: string;
  columns: { key: string; label: string; type?: string }[];
  rows: Record<string, any>[];
  totals?: Record<string, any>;
}

export function Reports() {
  const { can } = useSession();
  const ref = useReferenceData();
  const catalog = useApi<ReportDef[]>(['reports-catalog'], '/reports');
  const [active, setActive] = useState<string | null>(null);
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({ from, to });
  const result = useApi<ReportResult>(['report', active], active ? `/reports/${active}` : null, params, { keepPrevious: false });
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  const groups = ['HR', 'Payroll'];
  const fmt = (c: { type?: string }, v: any) => (c.type === 'money' ? formatMoney(v, '') : c.type === 'number' ? formatNumber(v) : v ?? '');
  return (
    <>
      <PageHeader title="Reports" description="HR and payroll reports — every report is tenant-scoped and permission checked; exports are audited" />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardBody className="space-y-5">
            {catalog.isLoading && <Spinner />}
            {groups.map((g) => (
              <div key={g}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</p>
                <ul className="space-y-0.5">
                  {catalog.data
                    ?.filter((r) => r.group === g)
                    .map((r) => (
                      <li key={r.type}>
                        <button
                          disabled={!r.allowed}
                          onClick={() => setActive(r.type)}
                          className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm', active === r.type ? 'bg-brand/10 font-medium text-brand' : 'hover:bg-slate-50', !r.allowed && 'cursor-not-allowed opacity-50')}
                          title={!r.allowed ? 'Not available for your role or plan' : undefined}
                        >
                          {r.name}
                          {!r.allowed && <Lock className="h-3.5 w-3.5" />}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </CardBody>
        </Card>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardBody className="flex flex-wrap items-end gap-3">
              <Field label="From">{(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
              <Field label="To">{(p) => <Input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
              {active === 'employee-roster' && <Field label="Department">{(p) => <RefSelect {...p} items={ref.data?.departments} value={departmentId} onChange={setDepartmentId} placeholder="All" />}</Field>}
              <Button onClick={() => setParams({ from, to, departmentId: departmentId ?? undefined })} disabled={!active}>
                Run report
              </Button>
              {active && can('reports.export') && (
                <div className="ml-auto flex gap-2">
                  <DownloadButton path={`/reports/${active}?${qs}&format=csv`} label="CSV" />
                  <DownloadButton path={`/reports/${active}?${qs}&format=xlsx`} label="Excel" />
                  <DownloadButton path={`/reports/${active}?${qs}&format=pdf`} label="PDF" />
                </div>
              )}
            </CardBody>
          </Card>
          {!active ? (
            <Card>
              <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Choose a report" description="Select a report from the list to preview it here." />
            </Card>
          ) : result.error ? (
            <Alert tone="error">{(result.error as Error).message}</Alert>
          ) : (
            <Card>
              <CardHeader title={result.data?.title ?? 'Loading…'} description={result.data ? `${result.data.rows.length} rows` : undefined} />
              <DataTable
                loading={result.isLoading}
                rows={result.data?.rows.map((r, i) => ({ ...r, __i: i }))}
                rowKey={(r) => String(r.__i)}
                empty={<EmptyState title="No data for the selected period" />}
                columns={(result.data?.columns ?? []).map((c) => ({ key: c.key, header: c.label, align: c.type === 'money' || c.type === 'number' ? 'right' : 'left', cell: (r: any) => fmt(c, r[c.key]) }))}
              />
              {result.data?.totals && (
                <div className="flex flex-wrap justify-end gap-6 border-t border-slate-100 px-5 py-3 text-sm font-semibold">
                  {result.data.columns
                    .filter((c) => result.data!.totals![c.key] !== undefined)
                    .map((c) => (
                      <span key={c.key}>
                        {c.label}: {fmt(c, result.data!.totals![c.key])}
                      </span>
                    ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
