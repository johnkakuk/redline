import { floorToIncrement } from './rounding';

export const WARMUP_SCHEME = [
  { pct: 0.5, reps: 8 },
  { pct: 0.7, reps: 5 },
  { pct: 0.85, reps: 2 },
] as const;

/** Warm-up ramp from the first working weight, rounded down to the increment. */
export function warmupSets(firstWorkingKg: number, incrementKg: number, count: number = WARMUP_SCHEME.length) {
  return WARMUP_SCHEME.slice(0, Math.max(0, Math.min(count, WARMUP_SCHEME.length))).map(({ pct, reps }) => ({
    weight_kg: floorToIncrement(firstWorkingKg * pct, incrementKg),
    reps,
  }));
}
