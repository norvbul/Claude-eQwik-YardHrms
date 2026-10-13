/**
 * Date helpers operating on ISO calendar dates (YYYY-MM-DD) in UTC to avoid timezone drift.
 */
export type IsoDate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(d: IsoDate): Date {
  if (!ISO_RE.test(d)) throw new Error(`Invalid ISO date: ${d}`);
  const dt = new Date(`${d}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d) throw new Error(`Invalid date: ${d}`);
  return dt;
}

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const dt = parseIsoDate(d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIsoDate(dt);
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDay));
  return r;
}

/** Inclusive list of dates from start to end. */
export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  if (e < s) return [];
  const out: IsoDate[] = [];
  for (let t = s.getTime(); t <= e.getTime(); t += 86_400_000) out.push(toIsoDate(new Date(t)));
  return out;
}

/** Default work week Monday–Friday (ISO weekday numbers 1..5; Sunday = 0 in JS). */
export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

/**
 * Counts working days between two dates inclusive, excluding non-working weekdays and the supplied
 * public holidays (PRD LEA-003). A half day on the start or end is supported via `halfDayStart/End`.
 */
export function workingDaysBetween(
  start: IsoDate,
  end: IsoDate,
  opts: { holidays?: IsoDate[]; workDays?: number[]; halfDayStart?: boolean; halfDayEnd?: boolean } = {},
): number {
  const holidays = new Set(opts.holidays ?? []);
  const workDays = new Set(opts.workDays ?? DEFAULT_WORK_DAYS);
  const days = eachDay(start, end);
  let count = 0;
  days.forEach((d, i) => {
    const wd = parseIsoDate(d).getUTCDay();
    if (!workDays.has(wd) || holidays.has(d)) return;
    let v = 1;
    if (i === 0 && opts.halfDayStart) v -= 0.5;
    if (i === days.length - 1 && opts.halfDayEnd && !(days.length === 1 && opts.halfDayStart)) v -= 0.5;
    count += v;
  });
  return count;
}

export function ageOn(dateOfBirth: IsoDate, on: IsoDate): number {
  const b = parseIsoDate(dateOfBirth);
  const o = parseIsoDate(on);
  let age = o.getUTCFullYear() - b.getUTCFullYear();
  const m = o.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && o.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/**
 * Proration factor for salaried employees hired or terminated within a period:
 * working days employed ÷ working days in the period (documented policy).
 */
export function prorationFactor(
  periodStart: IsoDate,
  periodEnd: IsoDate,
  hireDate: IsoDate | null,
  terminationDate: IsoDate | null,
  opts: { holidays?: IsoDate[]; workDays?: number[] } = {},
): number {
  const total = workingDaysBetween(periodStart, periodEnd, opts);
  if (total === 0) return 1;
  const s = hireDate && hireDate > periodStart ? hireDate : periodStart;
  const e = terminationDate && terminationDate < periodEnd ? terminationDate : periodEnd;
  if (e < s) return 0;
  const employed = workingDaysBetween(s, e, opts);
  return Math.min(1, Math.round((employed / total) * 1_000_000) / 1_000_000);
}

/** Minutes since midnight from HH:mm. */
export function parseTime(t: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!m) throw new Error(`Invalid time ${t}; expected HH:mm`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Regular hours worked for a shift. If end <= start the shift is treated as overnight (crosses midnight).
 * Returns hours rounded to 2 dp; throws when the break exceeds the span.
 */
export function shiftHours(start: string, end: string, breakHours: number): { hours: number; overnight: boolean; spanMinutes: number } {
  const s = parseTime(start);
  let e = parseTime(end);
  const overnight = e <= s;
  if (overnight) e += 24 * 60;
  const span = e - s;
  const net = span / 60 - breakHours;
  if (breakHours < 0) throw new Error('Break hours cannot be negative');
  if (net < 0) throw new Error('Break hours exceed the shift length');
  return { hours: Math.round(net * 100) / 100, overnight, spanMinutes: span };
}

/** Returns [startMinuteAbs, endMinuteAbs] relative to the work date's midnight, for overlap checks. */
export function shiftInterval(start: string, end: string): [number, number] {
  const s = parseTime(start);
  let e = parseTime(end);
  if (e <= s) e += 24 * 60;
  return [s, e];
}

export function intervalsOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/** Suggested period end for a frequency starting at `start`. */
export function periodEndFor(frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY', start: IsoDate): IsoDate {
  if (frequency === 'WEEKLY') return addDays(start, 6);
  if (frequency === 'FORTNIGHTLY') return addDays(start, 13);
  const s = parseIsoDate(start);
  const next = addMonths(s, 1);
  return addDays(toIsoDate(next), -1);
}
