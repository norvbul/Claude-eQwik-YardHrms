import Decimal from 'decimal.js';

/**
 * Isolated Decimal constructor so the engine never mutates global decimal.js configuration
 * used by other libraries. Precision 40 significant digits; money is rounded explicitly.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export type DecimalInput = string | number | Dec;

export const ZERO = new D(0);

export function dec(v: DecimalInput | null | undefined): Dec {
  if (v === null || v === undefined || v === '') return ZERO;
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`Invalid numeric value: ${v}`);
  return new D(v as Decimal.Value);
}

/** Money rounding policy: half-up (away from zero for .5) to 2 decimal places, at line level. */
export function roundMoney(v: Dec): Dec {
  return v.toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export function money(v: Dec): string {
  return roundMoney(v).toFixed(2);
}

export function sum(values: Dec[]): Dec {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

export function max(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}

export function min(a: Dec, b: Dec): Dec {
  return a.lessThan(b) ? a : b;
}
