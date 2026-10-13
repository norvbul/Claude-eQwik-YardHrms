import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, cn } from './primitives';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  align?: 'left' | 'right' | 'center';
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: { key: string; order: 'asc' | 'desc' };
  onSortChange?: (s: { key: string; order: 'asc' | 'desc' }) => void;
  empty?: ReactNode;
  caption?: string;
  selectable?: { selected: Set<string>; onChange: (s: Set<string>) => void; isSelectable?: (row: T) => boolean };
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

export function DataTable<T>({ columns, rows, loading, rowKey, onRowClick, sort, onSortChange, empty, caption, selectable }: DataTableProps<T>) {
  const selectableRows = (rows ?? []).filter((r) => selectable?.isSelectable?.(r) ?? true);
  const allSelected = !!selectable && selectableRows.length > 0 && selectableRows.every((r) => selectable.selected.has(rowKey(r)));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-slate-50">
          <tr>
            {selectable && (
              <th scope="col" className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={allSelected}
                  onChange={(e) => selectable.onChange(new Set(e.target.checked ? selectableRows.map(rowKey) : []))}
                />
              </th>
            )}
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.order === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500', c.align === 'right' && 'text-right', c.hideOnMobile && 'hidden md:table-cell', c.className)}
                >
                  {c.sortable && onSortChange ? (
                    <button className="inline-flex items-center gap-1 hover:text-slate-800" onClick={() => onSortChange({ key: c.key, order: active && sort!.order === 'asc' ? 'desc' : 'asc' })}>
                      {c.header}
                      {active && (sort!.order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk${i}`}>
                {selectable && <td className="px-3 py-3" />}
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3', c.hideOnMobile && 'hidden md:table-cell')}>
                    <Skeleton className="h-4 w-full max-w-[160px]" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            rows?.map((r) => {
              const key = rowKey(r);
              const canSelect = selectable?.isSelectable?.(r) ?? true;
              return (
                <tr
                  key={key}
                  className={cn(onRowClick && 'cursor-pointer hover:bg-slate-50', selectable?.selected.has(key) && 'bg-brand/5')}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {selectable && (
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {canSelect && (
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={selectable.selected.has(key)}
                          onChange={(e) => {
                            const next = new Set(selectable.selected);
                            if (e.target.checked) next.add(key);
                            else next.delete(key);
                            selectable.onChange(next);
                          }}
                        />
                      )}
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3 text-slate-700', c.align === 'right' && 'text-right tabular-nums', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && <div className="border-t border-slate-100">{empty ?? <EmptyState title="Nothing here yet" />}</div>}
    </div>
  );
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total?: number; onPage: (p: number) => void }) {
  if (totalPages <= 1 && !total) return null;
  return (
    <nav className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600" aria-label="Pagination">
      <span>{total !== undefined ? `${total.toLocaleString()} record${total === 1 ? '' : 's'}` : ''}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" icon={<ChevronLeft className="h-4 w-4" />} />
        <span>
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page" icon={<ChevronRight className="h-4 w-4" />} />
      </div>
    </nav>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', delay = 300 }: { value: string; onChange: (v: string) => void; placeholder?: string; delay?: number }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), delay);
    return () => clearTimeout(t);
  }, [local, value, onChange, delay]);
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        type="search"
        aria-label={placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon ?? <Inbox className="h-6 w-6" aria-hidden />}</div>
      <p className="font-medium text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumb }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-sm text-slate-500">{breadcrumb}</div>}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'brand', loading }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'brand' | 'amber' | 'sky' | 'rose' | 'violet' | 'emerald'; loading?: boolean }) {
  const toneMap = { brand: 'bg-brand/10 text-brand', amber: 'bg-amber-100 text-amber-700', sky: 'bg-sky-100 text-sky-700', rose: 'bg-rose-100 text-rose-700', violet: 'bg-violet-100 text-violet-700', emerald: 'bg-emerald-100 text-emerald-700' };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          {loading ? <Skeleton className="mt-2 h-7 w-20" /> : <p className="mt-1 truncate text-2xl font-semibold tabular-nums text-slate-900">{value}</p>}
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {icon && <div className={cn('rounded-lg p-2', toneMap[tone])}>{icon}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; hidden?: boolean }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              value === t.value ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, action }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const map = { info: 'border-sky-200 bg-sky-50 text-sky-900', warning: 'border-amber-200 bg-amber-50 text-amber-900', error: 'border-red-200 bg-red-50 text-red-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-900' };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm', map[tone])}>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function KeyValue({ items, columns = 2 }: { items: { label: ReactNode; value: ReactNode }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{it.label}</dt>
          <dd className="mt-1 break-words text-sm text-slate-900">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center p-10" role="status">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}
