import type { Units } from './types';

export const KG_PER_LB = 0.45359237;

export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const kgToLb = (kg: number) => kg / KG_PER_LB;

/** Convert a user-entered value to kg without rounding (so 50 lb round-trips exactly). */
export function toKg(value: number, units: Units): number {
  return units === 'lb' ? lbToKg(value) : value;
}

/**
 * kg → display number in the user's unit. Rounded to 0.1, and snapped to an integer when within
 * 0.05 so float noise from conversion never shows (50 lb stays 50, not 49.9).
 */
export function fromKg(kg: number, units: Units): number {
  const v = units === 'lb' ? kgToLb(kg) : kg;
  const r = Math.round(v * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 0.05) return Math.round(r);
  return Math.round(r * 10) / 10;
}

export function fmtWeight(kg: number | null | undefined, units: Units, withUnit = false): string {
  if (kg == null) return '—';
  const n = fromKg(kg, units);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return withUnit ? `${s} ${units}` : s;
}

/** Signed weight delta like "+5 lb". */
export function fmtDelta(kg: number, units: Units): string {
  const n = fromKg(Math.abs(kg), units);
  return `${kg < 0 ? '−' : '+'}${Number.isInteger(n) ? n : n.toFixed(1)} ${units}`;
}

/** Compact large numbers: 21400 → "21.4k". */
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 10000) return `${Math.round(n / 1000)}k`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
