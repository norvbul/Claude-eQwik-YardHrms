import type { DateOrder } from './mapping';

/** Result of normalising one value: either a clean value or a human-readable problem. */
export type Norm<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Norm<T> => ({ ok: true, value });
const fail = <T>(error: string): Norm<T> => ({ ok: false, error });

const pad = (n: number) => String(n).padStart(2, '0');
function isoIfValid(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * Dates from Sheets exports arrive as ISO strings, ISO timestamps (exported in the sheet's time zone),
 * locale strings (03/04/2024) or spreadsheet serial numbers. Ambiguous day/month order uses `order`.
 */
export function normDate(raw: string, order: DateOrder): Norm<string | null> {
  const v = raw.trim();
  if (!v) return ok(null);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(v);
  if (m) {
    const iso = isoIfValid(+m[1], +m[2], +m[3]);
    return iso ? ok(iso) : fail(`"${v}" is not a valid date`);
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] - (+m[3] > 50 ? 100 : 0) : +m[3];
    const [a, b] = [+m[1], +m[2]];
    const iso = order === 'MDY' ? isoIfValid(year, a, b) : isoIfValid(year, b, a);
    return iso ? ok(iso) : fail(`"${v}" is not a valid date in ${order} order`);
  }
  if (/^\d{4,5}(\.\d+)?$/.test(v)) {
    // Spreadsheet serial (days since 1899-12-30)
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86_400_000);
    return ok(dt.toISOString().slice(0, 10));
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})$/.exec(v);
  if (m && months.includes(m[2].toLowerCase())) {
    const iso = isoIfValid(+m[3], months.indexOf(m[2].toLowerCase()) + 1, +m[1]);
    if (iso) return ok(iso);
  }
  return fail(`"${v}" is not a recognised date`);
}

/** Money: strips currency symbols/codes, thousands separators and accounting negatives "(1,200.00)". */
export function normMoney(raw: string, opts: { allowNegative?: boolean } = {}): Norm<string | null> {
  let v = raw.trim();
  if (!v) return ok(null);
  let neg = false;
  if (/^\(.*\)$/.test(v)) {
    neg = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/^(JMD|J\$|\$|USD)\s*/i, '').replace(/,/g, '').trim();
  if (v.startsWith('-')) {
    neg = true;
    v = v.slice(1);
  }
  if (!/^\d{1,15}(\.\d+)?$/.test(v)) return fail(`"${raw}" is not a valid amount`);
  if (neg && !opts.allowNegative) return fail(`"${raw}" is negative`);
  // Round half-up to 2 decimal places using string arithmetic (no float drift)
  const [int, frac = ''] = v.split('.');
  let cents = BigInt(int) * 100n + BigInt((frac + '00').slice(0, 2));
  if ((frac[2] ?? '0') >= '5') cents += 1n;
  const s = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  return ok(neg && s !== '0.00' ? `-${s}` : s);
}

export function normDecimal(raw: string, dp = 2): Norm<string | null> {
  const v = raw.trim().replace(/,/g, '');
  if (!v) return ok(null);
  if (!/^-?\d+(\.\d+)?$/.test(v)) return fail(`"${raw}" is not a number`);
  return ok(Number(v).toFixed(dp));
}

export function normEmail(raw: string): Norm<string | null> {
  const v = raw.trim().toLowerCase();
  if (!v) return ok(null);
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v) ? ok(v) : fail(`"${raw}" is not a valid email address`);
}

/** Jamaican TRN: 9 digits (commonly written 123-456-789). */
export function normTrn(raw: string): Norm<string | null> {
  const digits = raw.replace(/[\s-]/g, '');
  if (!digits) return ok(null);
  return /^\d{9}$/.test(digits) ? ok(digits) : fail(`TRN "${raw}" must have 9 digits`);
}

/** NIS/NHT numbers vary in historical format; keep alphanumerics, reject obviously wrong values. */
export function normIdentifier(raw: string, label: string): Norm<string | null> {
  const v = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!v) return ok(null);
  return /^[A-Z0-9]{5,20}$/.test(v) ? ok(v) : fail(`${label} "${raw}" is not a valid identifier`);
}

const PARISHES = ['Kingston', 'St. Andrew', 'St. Thomas', 'Portland', 'St. Mary', 'St. Ann', 'Trelawny', 'St. James', 'Hanover', 'Westmoreland', 'St. Elizabeth', 'Manchester', 'Clarendon', 'St. Catherine'];
const parishKey = (s: string) => s.toLowerCase().replace(/saint/g, 'st').replace(/[^a-z]/g, '');
export function normParish(raw: string): Norm<string | null> {
  const v = raw.trim();
  if (!v) return ok(null);
  const hit = PARISHES.find((p) => parishKey(p) === parishKey(v));
  return hit ? ok(hit) : fail(`"${raw}" is not a Jamaican parish`);
}

export function normEnum<T extends string>(raw: string, allowed: readonly T[], label: string, synonyms: Record<string, T> = {}): Norm<T | null> {
  const v = raw.trim();
  if (!v) return ok(null);
  const key = v.toUpperCase().replace(/[\s-]+/g, '_');
  if ((allowed as readonly string[]).includes(key)) return ok(key as T);
  const syn = Object.entries(synonyms).find(([k]) => k.toUpperCase().replace(/[\s-]+/g, '_') === key);
  return syn ? ok(syn[1]) : fail(`${label} "${raw}" must be one of ${allowed.join(', ')}`);
}

export const PAY_FREQUENCIES = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'] as const;
export const PAY_FREQUENCY_SYNONYMS: Record<string, (typeof PAY_FREQUENCIES)[number]> = {
  'BI-WEEKLY': 'FORTNIGHTLY', BIWEEKLY: 'FORTNIGHTLY', 'EVERY 2 WEEKS': 'FORTNIGHTLY', W: 'WEEKLY', F: 'FORTNIGHTLY', M: 'MONTHLY', SALARY: 'MONTHLY',
};
export const PAY_TYPES = ['SALARY', 'HOURLY'] as const;
export const PAY_TYPE_SYNONYMS: Record<string, (typeof PAY_TYPES)[number]> = { SALARIED: 'SALARY', FIXED: 'SALARY', WAGE: 'HOURLY', HOURLY_RATE: 'HOURLY' };
export const GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] as const;
export const GENDER_SYNONYMS: Record<string, (typeof GENDERS)[number]> = { F: 'FEMALE', M: 'MALE' };
export const EMPLOYEE_STATUSES = ['ACTIVE', 'INACTIVE', 'TERMINATED'] as const;
export const STATUS_SYNONYMS: Record<string, (typeof EMPLOYEE_STATUSES)[number]> = {
  CURRENT: 'ACTIVE', EMPLOYED: 'ACTIVE', SEPARATED: 'TERMINATED', RESIGNED: 'TERMINATED', DISMISSED: 'TERMINATED', LEFT: 'TERMINATED', SUSPENDED: 'INACTIVE', 'ON LEAVE': 'INACTIVE',
};

export function normBool(raw: string): Norm<boolean | null> {
  const v = raw.trim().toLowerCase();
  if (!v) return ok(null);
  if (['y', 'yes', 'true', '1', 'x'].includes(v)) return ok(true);
  if (['n', 'no', 'false', '0'].includes(v)) return ok(false);
  return fail(`"${raw}" is not Yes/No`);
}

export function normCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

/** Name casing cleanup for ALL-CAPS/lower-case legacy entries; leaves mixed case as entered. */
export function normName(raw: string): string {
  const v = raw.trim().replace(/\s+/g, ' ');
  if (v !== v.toUpperCase() && v !== v.toLowerCase()) return v;
  return v.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}
