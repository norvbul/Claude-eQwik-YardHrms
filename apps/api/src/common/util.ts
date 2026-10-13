import { Prisma } from '@prisma/client';
import type { Paginated } from '@yardhrms/types';

export function toDate(iso: string): Date;
export function toDate(iso: string | null | undefined): Date | null;
export function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

export function isoDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function decOrNull(v: string | null | undefined): Prisma.Decimal | null {
  return v === null || v === undefined || v === '' ? null : new Prisma.Decimal(v);
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function fullName(e: { firstName: string; middleName?: string | null; lastName: string }): string {
  return [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ');
}

/** Keeps only keys whose values changed; used for before/after audit metadata. */
export function diff(before: Record<string, any>, after: Record<string, any>): { before: Record<string, any>; after: Record<string, any> } {
  const b: Record<string, any> = {};
  const a: Record<string, any> = {};
  for (const key of Object.keys(after)) {
    const bv = normalize(before[key]);
    const av = normalize(after[key]);
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[key] = bv;
      a[key] = av;
    }
  }
  return { before: b, after: a };
}

function normalize(v: any): any {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Prisma.Decimal) return v.toString();
  return v ?? null;
}
