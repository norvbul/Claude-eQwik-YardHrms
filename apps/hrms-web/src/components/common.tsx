import { useQuery } from '@tanstack/react-query';
import { Button, Select, cn, errorMessage, useToast } from '@yardhrms/ui';
import { Download, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { EmployeeOption, ReferenceData } from '@/lib/types';

export function useReferenceData() {
  return useQuery({ queryKey: ['reference-data'], queryFn: () => api.get<ReferenceData>('/reference-data'), staleTime: 5 * 60_000 });
}

/**
 * Searchable employee selector used for delegated leave/timesheet/overtime entry (PRD §13.3).
 * Only ACTIVE employees are offered; `eligibleFor` narrows to timesheet- or overtime-eligible staff.
 */
export function EmployeePicker({
  value,
  onChange,
  eligibleFor,
  placeholder = 'Search employees…',
  id,
  allowSelf,
  selfLabel = 'Myself',
}: {
  value: string | null;
  onChange: (id: string | null, emp?: EmployeeOption) => void;
  eligibleFor?: 'timesheet' | 'overtime';
  placeholder?: string;
  id?: string;
  allowSelf?: boolean;
  selfLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<EmployeeOption | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const { data, isFetching } = useQuery({
    queryKey: ['employee-options', debounced, eligibleFor],
    queryFn: () => api.get<EmployeeOption[]>('/employees/options', { search: debounced || undefined, eligibleFor }),
    enabled: open,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!value) setSelected(null);
  }, [value]);
  const label = (e: EmployeeOption) => `${e.firstName} ${e.lastName} (${e.employeeNumber})`;
  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          placeholder={value ? undefined : allowSelf ? `${selfLabel} (or search)` : placeholder}
          value={open ? query : selected ? label(selected) : value ? '' : ''}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && (
        <ul role="listbox" className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {allowSelf && (
            <li>
              <button
                type="button"
                className="w-full px-3 py-2 text-left font-medium hover:bg-slate-50"
                onClick={() => {
                  setSelected(null);
                  onChange(null);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {selfLabel}
              </button>
            </li>
          )}
          {isFetching && !data && <li className="px-3 py-2 text-slate-400">Searching…</li>}
          {data?.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === e.id}
                className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50', value === e.id && 'bg-brand/5')}
                onClick={() => {
                  setSelected(e);
                  onChange(e.id, e);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span>
                  {e.firstName} {e.lastName} <span className="text-slate-400">· {e.employeeNumber}</span>
                </span>
                <span className="text-xs text-slate-400">{e.payFrequency.toLowerCase()}</span>
              </button>
            </li>
          ))}
          {data && data.length === 0 && <li className="px-3 py-2 text-slate-400">No eligible active employees found</li>}
        </ul>
      )}
    </div>
  );
}

export function DownloadButton({ path, label, method = 'GET', variant = 'outline', size = 'sm', icon, open }: { path: string; label: ReactNode; method?: 'GET' | 'POST'; variant?: 'outline' | 'primary' | 'ghost' | 'secondary'; size?: 'sm' | 'md'; icon?: ReactNode; open?: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      variant={variant}
      size={size}
      loading={busy}
      icon={icon ?? <Download className="h-4 w-4" />}
      onClick={async () => {
        setBusy(true);
        try {
          await api.download(path, { method, open });
        } catch (e) {
          toast.error('Download failed', errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

export function RefSelect({ items, value, onChange, placeholder = 'None', id, ...rest }: { items: { id: string; name: string; active?: boolean }[] | undefined; value: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string; id?: string; 'aria-invalid'?: boolean }) {
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      <option value="">{placeholder}</option>
      {items
        ?.filter((i) => i.active !== false || i.id === value)
        .map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
    </Select>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{children}</h2>
      {action}
    </div>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={cn('grid gap-4', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3')}>{children}</div>;
}
