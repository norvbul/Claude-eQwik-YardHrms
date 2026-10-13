/** Formatting helpers (en-JM conventions). Money values arrive as decimal strings from the API. */
export function formatMoney(v: string | number | null | undefined, currency = 'JMD'): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${currency ? currency + ' ' : ''}${int}.${(f + '00').slice(0, 2)}`;
}

export function formatNumber(v: string | number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-JM', { minimumFractionDigits: 0, maximumFractionDigits: dp }) : String(v);
}

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const s = typeof v === 'string' ? v : v.toISOString();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-JM', { year: 'numeric', month: 'short', day: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}/.test(s) && s.length <= 10 ? 'UTC' : undefined });
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-JM', { dateStyle: 'medium', timeStyle: 'short' });
}

export function isoDay(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : '';
}

export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
