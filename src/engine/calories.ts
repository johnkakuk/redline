// Resistance-training calorie estimate (labelled "est." in the UI). See PLAN.md §6.
import type { Intensity, Sex } from '../shared/types';

/** Compendium of Physical Activities, resistance training. */
export const MET: Record<Intensity, number> = { light: 3.5, moderate: 5.0, vigorous: 6.0 };

/** Gaps between activity longer than this are treated as pauses and excluded. */
export const PAUSE_THRESHOLD_SEC = 10 * 60;

export interface Profile {
  sex: Sex | null;
  ageYears: number | null;
  heightCm: number | null;
}

/** Mifflin-St Jeor resting metabolic rate, kcal/day. */
export function mifflinStJeor(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (sex === 'male' ? 5 : -161);
}

export function profileComplete(p: Profile): boolean {
  return p.sex != null && p.ageYears != null && p.heightCm != null;
}

/** MET corrected for the user's RMR, or the raw MET when the profile is incomplete. */
export function correctedMet(intensity: Intensity, weightKg: number, p: Profile): number {
  const met = MET[intensity];
  if (!profileComplete(p)) return met;
  const rmr = mifflinStJeor(weightKg, p.heightCm!, p.ageYears!, p.sex!);
  const rmrMl = ((rmr / 1440 / 5) * 1000) / weightKg; // ml O2 / kg / min
  return (met * 3.5) / rmrMl;
}

export function estimateKcal(intensity: Intensity, weightKg: number, activeSec: number, p: Profile): number {
  return correctedMet(intensity, weightKg, p) * weightKg * (activeSec / 3600);
}

/**
 * Active seconds between start and end, excluding gaps between activity events
 * (set completions) that exceed the pause threshold.
 */
export function activeSeconds(startMs: number, endMs: number, eventMs: number[]): number {
  const points = [startMs, ...eventMs.filter((t) => t > startMs && t < endMs).sort((a, b) => a - b), endMs];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const gap = (points[i] - points[i - 1]) / 1000;
    if (gap <= PAUSE_THRESHOLD_SEC) total += gap;
  }
  return Math.round(total);
}
