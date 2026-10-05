import type { LoadType, Muscle } from '../shared/types';

export const SECONDARY_WEIGHT = 0.5;
export const VOLUME_BAND = { min: 10, max: 20 } as const;

/** Tonnage for one set. Per-hand loads count both hands. */
export function setTonnage(weightKg: number | null, reps: number | null, loadType: LoadType): number {
  if (weightKg == null || reps == null) return 0;
  return weightKg * reps * (loadType === 'per_hand' ? 2 : 1);
}

export interface MuscleSetInput {
  primary: Muscle;
  secondary: Muscle[];
  sets: number;
}

/** Working sets per muscle: 1.0 for the primary muscle, 0.5 for each secondary. */
export function setsPerMuscle(rows: MuscleSetInput[]): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {};
  for (const r of rows) {
    out[r.primary] = (out[r.primary] ?? 0) + r.sets;
    for (const m of r.secondary) {
      if (m !== r.primary) out[m] = (out[m] ?? 0) + r.sets * SECONDARY_WEIGHT;
    }
  }
  return out;
}
