import type { LoadType, PrHit, PrType } from '../shared/types';
import { e1rm } from './e1rm';
import { approxEq, gt } from './rounding';
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

const weightKey = (w: number) => (Math.round(w * 1000) / 1000).toFixed(3);

/**
 * Walk an exercise's completed working sets chronologically and emit an event whenever a record improves.
 * reps_at_weight only fires when an earlier set at the same weight was beaten.
 */
export function computePrEvents(sets: PrSet[], loadType: LoadType): PrEvent[] {
  const sorted = [...sets].sort((a, b) => a.completed_at.localeCompare(b.completed_at));
  const events: PrEvent[] = [];
  const firstWorkout = sorted[0]?.workout_id;
  let maxW = -Infinity;
  let bestE = -Infinity;
  let bestVol = -Infinity;
  const repsAt = new Map<string, number>();
  const sessionVol = new Map<string, { vol: number; at: string }>();
  const weighted = loadType !== 'bodyweight';

  for (const s of sorted) {
    if (s.reps == null || s.reps <= 0) continue;
    const baseline = s.workout_id === firstWorkout;
    const base = { set_id: s.set_id, workout_id: s.workout_id, achieved_at: s.completed_at, baseline };
    const w = s.weight_kg ?? 0;

    if (weighted && s.weight_kg != null && w > 0) {
      if (gt(w, maxW)) {
        maxW = w;
        events.push({ ...base, type: 'max_weight', value: w, weight_kg: w, reps: s.reps });
      }
      const e = e1rm(w, s.reps);
      if (e != null && gt(e, bestE)) {
        bestE = e;
        events.push({ ...base, type: 'best_e1rm', value: e, weight_kg: w, reps: s.reps });
      }
    }
    const k = weightKey(w);
    const prev = repsAt.get(k);
    if (prev != null && s.reps > prev && !baseline) {
      events.push({ ...base, type: 'reps_at_weight', value: s.reps, weight_kg: weighted ? w : null, reps: s.reps });
    }
    if (prev == null || s.reps > prev) repsAt.set(k, s.reps);

    const sv = sessionVol.get(s.workout_id) ?? { vol: 0, at: s.completed_at };
    sv.vol += weighted ? setTonnage(w, s.reps, loadType) : s.reps;
    sv.at = s.completed_at;
    sessionVol.set(s.workout_id, sv);
  }

  // Session volume records, in workout order.
  for (const [workoutId, { vol, at }] of [...sessionVol.entries()].sort((a, b) => a[1].at.localeCompare(b[1].at))) {
    if (vol > 0 && gt(vol, bestVol)) {
      bestVol = vol;
      events.push({ set_id: null, workout_id: workoutId, achieved_at: at, baseline: workoutId === firstWorkout, type: 'session_volume', value: vol, weight_kg: null, reps: null });
    }
  }
  return events;
}

/**
 * Live PR check for a just-completed set against all other completed sets for the exercise.
 * No badges for an exercise's first ever session.
 */
export function detectSetPrs(
  set: { weight_kg: number | null; reps: number | null },
  history: { weight_kg: number | null; reps: number | null }[],
  loadType: LoadType,
): PrHit[] {
  if (set.reps == null || set.reps <= 0 || history.length === 0) return [];
  const hits: PrHit[] = [];
  const w = set.weight_kg ?? 0;
  const weighted = loadType !== 'bodyweight' && w > 0;
  if (weighted) {
    const maxW = Math.max(...history.map((h) => h.weight_kg ?? 0));
    if (gt(w, maxW)) hits.push({ type: 'max_weight', value: w, weight_kg: w, reps: set.reps });
    const e = e1rm(w, set.reps);
    const bestE = Math.max(0, ...history.map((h) => (h.weight_kg && h.reps ? e1rm(h.weight_kg, h.reps) ?? 0 : 0)));
    if (e != null && gt(e, bestE) && !hits.some((x) => x.type === 'max_weight')) {
      hits.push({ type: 'best_e1rm', value: e, weight_kg: w, reps: set.reps });
    }
  }
  const atWeight = history.filter((h) => approxEq(h.weight_kg ?? 0, w) && h.reps != null).map((h) => h.reps as number);
  if (atWeight.length && set.reps > Math.max(...atWeight) && hits.length === 0) {
    hits.push({ type: 'reps_at_weight', value: set.reps, weight_kg: weighted ? w : null, reps: set.reps });
  }
  return hits;
}

export const PR_LABEL: Record<PrType, string> = {
  max_weight: 'Heaviest',
  best_e1rm: 'Best e1RM',
  reps_at_weight: 'Rep PR',
  session_volume: 'Session volume',
};
