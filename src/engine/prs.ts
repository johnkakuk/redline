// Personal records. Only one kind is tracked: best session volume per exercise
// (tonnage for loaded exercises, total reps for bodyweight-only ones).
import type { LoadType, PrHit, PrType } from '../shared/types';
import { gt } from './rounding';
import { setTonnage } from './volume';

export interface PrSet {
  set_id: string;
  workout_id: string;
  weight_kg: number | null;
  reps: number | null;
  completed_at: string;
}

export interface PrEvent extends PrHit {
  set_id: string | null;
  workout_id: string;
  achieved_at: string;
  /** First session for this exercise: establishes the record, not shown as a PR. */
  baseline: boolean;
}

/** One set's contribution to session volume. */
export function setVolume(weightKg: number | null, reps: number | null, loadType: LoadType): number {
  if (reps == null || reps <= 0) return 0;
  return loadType === 'bodyweight' ? reps : setTonnage(weightKg ?? 0, reps, loadType);
}

export const sessionVolume = (sets: { weight_kg: number | null; reps: number | null }[], loadType: LoadType) =>
  sets.reduce((a, s) => a + setVolume(s.weight_kg, s.reps, loadType), 0);

/** Walk an exercise's completed working sets and emit an event each time a session sets a new volume record. */
export function computePrEvents(sets: PrSet[], loadType: LoadType): PrEvent[] {
  const sorted = [...sets].sort((a, b) => a.completed_at.localeCompare(b.completed_at));
  const firstWorkout = sorted[0]?.workout_id;
  const sessions = new Map<string, { vol: number; at: string; lastSet: string }>();
  for (const s of sorted) {
    const g = sessions.get(s.workout_id) ?? { vol: 0, at: s.completed_at, lastSet: s.set_id };
    g.vol += setVolume(s.weight_kg, s.reps, loadType);
    g.at = s.completed_at;
    g.lastSet = s.set_id;
    sessions.set(s.workout_id, g);
  }
  const events: PrEvent[] = [];
  let best = -Infinity;
  for (const [workoutId, { vol, at }] of [...sessions.entries()].sort((a, b) => a[1].at.localeCompare(b[1].at))) {
    if (vol > 0 && gt(vol, best)) {
      best = vol;
      events.push({ set_id: null, workout_id: workoutId, achieved_at: at, baseline: workoutId === firstWorkout, type: 'session_volume', value: vol, weight_kg: null, reps: null });
    }
  }
  return events;
}

/**
 * Live check after completing a set: did this set push the session's volume past the previous best session?
 * Fires once per session (on the set that crosses the line). No badge during an exercise's first session.
 */
export function detectVolumePr(
  set: { weight_kg: number | null; reps: number | null },
  earlierThisSession: { weight_kg: number | null; reps: number | null }[],
  previousBest: number,
  loadType: LoadType,
): PrHit[] {
  if (!(previousBest > 0)) return [];
  const before = sessionVolume(earlierThisSession, loadType);
  const after = before + setVolume(set.weight_kg, set.reps, loadType);
  if (gt(after, previousBest) && !gt(before, previousBest)) {
    return [{ type: 'session_volume', value: after, weight_kg: null, reps: null }];
  }
  return [];
}

export const PR_LABEL: Record<PrType, string> = {
  max_weight: 'Heaviest',
  best_e1rm: 'Best e1RM',
  reps_at_weight: 'Rep PR',
  session_volume: 'Volume PR',
};

/** "2.7k lb" for loaded exercises, "22 reps" for bodyweight-only. `display` converts kg to the user's unit. */
export function fmtVolume(value: number, loadType: LoadType, display: (kg: number) => number, units: string): string {
  if (loadType === 'bodyweight') return `${Math.round(value)} reps`;
  const v = display(value);
  return `${v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : Math.round(v)} ${units}`;
}
