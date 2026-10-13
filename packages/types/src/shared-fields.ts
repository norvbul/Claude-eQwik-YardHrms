import { z } from 'zod';
export { decimalString, optionalText, positiveMoney, moneyString, rateFraction } from './common';

export const isoDateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const hhmmField = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:mm (24-hour)');
/** Tolerant email for employee records (may be absent or shared per PRD §9.3). */
export const emailSchemaLoose = z
  .string()
  .trim()
  .toLowerCase()
  .max(190)
  .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address')
  .transform((v) => (v === '' ? null : v));
