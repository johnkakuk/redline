const EPS = 1e-6;

/** Round down to a multiple of `inc` (tolerant of float noise from unit conversion). */
export function floorToIncrement(w: number, inc: number): number {
  if (!(inc > 0)) return w;
  return Math.floor(w / inc + EPS) * inc;
}

/** A suggested weight: rounded down to the increment grid and never above the cap. */
export function suggestWeight(w: number, inc: number, cap: number | null): number {
  const capped = cap != null ? Math.min(w, cap) : w;
  return Math.max(0, floorToIncrement(capped, inc));
}

export const approxEq = (a: number, b: number) => Math.abs(a - b) < EPS;
export const lt = (a: number, b: number) => a < b - EPS;
export const gt = (a: number, b: number) => a > b + EPS;
