import { Button, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Select, StatusBadge, formatDate } from '@yardhrms/ui';
import { FileSpreadsheet, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useReferenceData } from '@/components/common';
import { usePaged } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Employee } from '@/lib/types';
import { EmployeeForm } from './EmployeeForm';

export function Employees() {
  const { can, hasFeature, readOnly } = useSession();
  const navigate = useNavigate();
  const ref = useReferenceData();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [departmentId, setDepartmentId] = useState('');
  const [payFrequency, setPayFrequency] = useState('');
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' }>({ key: 'lastName', order: 'asc' });
  const [creating, setCreating] = useState(false);
  const q = usePaged<Employee>(['employees'], '/employees', { page, pageSize: 25, search: search || undefined, status: status || undefined, departmentId: departmentId || undefined, payFrequency: payFrequency || undefined, sort: sort.key, order: sort.order });
  const canWrite = can('employees.write') && !readOnly;
  return (
    <>
      <PageHeader
        title="Employees"
        description="Searchable employee directory with role-based access to sensitive data"
        actions={
          canWrite && (
            <>
              {hasFeature('BULK_IMPORT') && can('imports.manage') && (
                <Link to="/app/imports">
                  <Button variant="outline" icon={<FileSpreadsheet className="h-4 w-4" />}>
                    Import
                  </Button>
                </Link>
              )}
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Add employee
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search name, number or email"
          />
          <Select className="w-40" aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="TERMINATED">Terminated</option>
          </Select>
          <Select className="w-48" aria-label="Department" value={departmentId} onChange={(e) => (setDepartmentId(e.target.value), setPage(1))}>
            <option value="">All departments</option>
            {ref.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select className="w-44" aria-label="Pay frequency" value={payFrequency} onChange={(e) => (setPayFrequency(e.target.value), setPage(1))}>
            <option value="">All frequencies</option>
            <option value="WEEKLY">Weekly</option>
            <option value="FORTNIGHTLY">Fortnightly</option>
            <option value="MONTHLY">Monthly</option>
          </Select>
        </div>
        <DataTable<Employee>
          caption="Employees"
          loading={q.isLoading}
          rows={q.data?.items}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/app/employees/${r.id}`)}
          sort={sort}
          onSortChange={setSort}
          empty={
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title={search ? 'No employees match your search' : 'No employees yet'}
              description={canWrite ? 'Add your first employee or import a spreadsheet.' : undefined}
              action={canWrite ? <Button onClick={() => setCreating(true)}>Add employee</Button> : undefined}
            />
          }
          columns={[
            { key: 'employeeNumber', header: 'Emp #', sortable: true, cell: (r) => <span className="font-mono text-xs">{r.employeeNumber}</span> },
            {
              key: 'lastName',
              header: 'Name',
              sortable: true,
              cell: (r) => (
                <div>
                  <p className="font-medium text-slate-900">
                    {r.firstName} {r.lastName}
                  </p>
                  <p className="text-xs text-slate-500">{r.position?.name ?? r.email ?? ''}</p>
                </div>
              ),
            },
            { key: 'department', header: 'Department', hideOnMobile: true, cell: (r) => r.department?.name ?? '—' },
            { key: 'payFrequency', header: 'Pay', hideOnMobile: true, cell: (r) => `${r.payFrequency.toLowerCase()} · ${r.payType.toLowerCase()}` },
            { key: 'hireDate', header: 'Hired', sortable: true, hideOnMobile: true, cell: (r) => formatDate(r.hireDate) },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      </Card>
      <EmployeeForm open={creating} onClose={() => setCreating(false)} onSaved={(e) => navigate(`/app/employees/${e.id}`)} />
    </>
  );
}
