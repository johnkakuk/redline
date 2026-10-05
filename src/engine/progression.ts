// Progression engine: reps first, then weight. Pure: no I/O.
//
// Each exercise has one rep target (the goal at a given weight). Sessions ask for one more rep per set
// until every set reaches the target; then the weight goes up one increment and reps drop just enough
// that tonnage still rises, and the climb starts again. A "stall" is a full session that didn't beat
// the previous one at the same weight; three in a row suggests a deload.
import type { LoadType, ProgressionKind, ProgressionMode, ProgressionState, Units } from '../shared/types';
import { fmtDelta, fmtWeight } from '../shared/units';
import { approxEq, floorToIncrement, gt, lt, suggestWeight } from './rounding';

export type EngineState = Omit<ProgressionState, 'routine_item_id' | 'last_evaluated_workout_id'>;

export interface EngineSet {
  weight_kg: number | null;
  reps: number | null;
  completed: boolean;
}

export interface ProgressionInput {
  mode: ProgressionMode;
  loadType: LoadType;
  workingSets: number;
  /** Reps per set to reach before adding weight. */
  repTarget: number;
  incrementKg: number;
  capKg: number | null;
  hasHarderVariation: boolean;
  /** null = no history for this routine item. */
  state: EngineState | null;
  /** Working sets from the session just finished, in order. Warm-ups excluded by the caller. */
  sets: EngineSet[];
  /** Working sets from the previous evaluated session, to tell progress from a stall. */
  previous?: { weight_kg: number | null; reps: number[] } | null;
  units: Units;
}

export interface ProgressionOutput {
  state: EngineState;
  kind: ProgressionKind;
  reason: string;
}

/** Sessions to wait before re-offering a dismissed variation swap. */
export const VARIATION_SNOOZE = 2;
/** Consecutive sessions without a rep gain before suggesting a deload. */
export const DELOAD_AFTER_STALLS = 3;
export const DELOAD_FACTOR = 0.9;

export function initialState(repTarget: number, workingSets: number): EngineState {
  return {
    target_weight_kg: null,
    target_reps: Array.from({ length: workingSets }, () => repTarget),
    status: 'progressing',
    fail_streak: 0,
    pinned: false,
    prompt_weight_kg: null,
    snooze: 0,
  };
}

/**
 * Reps to aim for after a weight increase: the fewest reps that still beat the old tonnage per set,
 * never below 60% of the target and never above it.
 */
export function rampReps(fromKg: number, toKg: number, repTarget: number): number {
  if (!(fromKg > 0) || !(toKg > 0)) return Math.max(1, repTarget - 2);
  const r = Math.floor((repTarget * fromKg) / toKg + 1e-9) + 1;
  return Math.max(Math.ceil(repTarget * 0.6), Math.min(repTarget, r));
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function evaluate(input: ProgressionInput): ProgressionOutput {
  const { mode, loadType, workingSets, repTarget: T, incrementKg: inc, capKg: cap, units } = input;
  const base: EngineState = input.state
    ? { ...input.state, target_reps: [...input.state.target_reps] }
    : initialState(T, workingSets);
  const w = (kg: number) => fmtWeight(kg, units, true);

  if (mode === 'none') return { state: base, kind: 'manual', reason: 'Progression off' };
  if (base.pinned) return { state: base, kind: 'pinned', reason: 'Pinned · target unchanged' };

  const done = input.sets
    .filter((s) => s.completed && s.reps != null)
    .map((s) => ({
      reps: s.reps as number,
      weight: s.weight_kg ?? (loadType === 'bodyweight' || loadType === 'bodyweight_plus' ? 0 : null),
    }))
    .filter((s) => loadType === 'bodyweight' || s.weight != null) as { reps: number; weight: number }[];

  if (done.length === 0) return { state: base, kind: 'skipped', reason: 'No working sets logged' };

  const repsStr = done.map((s) => s.reps).join('/');
  const allDone = done.length >= workingSets;
  const atTarget = allDone && done.every((s) => s.reps >= T);
  const repsAt = (n: number) => Array.from({ length: workingSets }, () => n);
  /** One more rep per set, up to the target. */
  const repsUp = () => Array.from({ length: workingSets }, (_, i) =>
    done[i] ? Math.max(1, Math.min(done[i].reps + 1, T)) : base.target_reps[i] ?? T);
  const aim = (r: number[]) => (new Set(r).size === 1 ? `${r[0]}` : r.join('/'));

  /** Compare with the previous session at the same weight: gained reps, stalled, or no comparison. */
  const versusLast = (weight: number): { gain: number } | 'stall' | null => {
    const prev = input.previous;
    if (!prev || !prev.reps.length || !allDone) return null;
    if (!approxEq(prev.weight_kg ?? 0, weight)) return null;
    const gain = sum(done.map((s) => s.reps)) - sum(prev.reps);
    return gain > 0 ? { gain } : 'stall';
  };

  // Bodyweight-only exercises progress reps, then graduate to a harder variation.
  if (loadType === 'bodyweight') {
    const st: EngineState = { ...base, target_weight_kg: null, prompt_weight_kg: null };
    if (atTarget) {
      st.target_reps = repsAt(T);
      st.fail_streak = 0;
      if (input.hasHarderVariation && base.snooze <= 0) {
        return { state: { ...st, status: 'variation_suggested' }, kind: 'variation', reason: `Hit ${repsStr}. Ready for a harder variation` };
      }
      return {
        state: { ...st, status: 'capped', snooze: Math.max(0, base.snooze - 1) },
        kind: 'capped',
        reason: input.hasHarderVariation ? `Hit ${repsStr} · at your rep target` : `Hit ${repsStr} · link a harder variation to keep progressing`,
      };
    }
    const next = repsUp();
    if (!allDone) {
      return { state: { ...st, status: 'holding', target_reps: next }, kind: 'hold', reason: `${done.length} of ${workingSets} sets · aim ${aim(next)} next` };
    }
    const vs = versusLast(0);
    if (vs === 'stall') {
      return { state: { ...st, status: 'holding', fail_streak: base.fail_streak + 1, target_reps: next }, kind: 'miss', reason: `${repsStr} · no rep gain. Aim ${aim(next)}` };
    }
    return {
      state: { ...st, status: 'holding', fail_streak: 0, target_reps: next },
      kind: 'hold',
      reason: vs ? `${repsStr} · +${vs.gain} reps · aim ${aim(next)} next` : `${repsStr} · aim ${aim(next)} next`,
    };
  }

  // Loaded exercises. Evaluate against the lightest working weight actually used.
  const used = Math.min(...done.map((s) => s.weight));
  const baseline = base.target_weight_kg == null;
  const target = base.target_weight_kg ?? suggestWeight(used, inc, cap);
  const lighter = !baseline && lt(used, target);
  const evalW = used;
  const st: EngineState = { ...base, prompt_weight_kg: null };

  if (atTarget) {
    const next = evalW + inc;
    if (cap != null && gt(next, cap)) {
      // Success, but the next step would exceed the equipment cap.
      const atCap = Math.min(cap, Math.max(floorToIncrement(cap, inc), Math.min(evalW, cap)));
      const capState: EngineState = { ...st, target_weight_kg: atCap, target_reps: repsAt(T), fail_streak: 0 };
      if (input.hasHarderVariation && base.snooze <= 0) {
        return { state: { ...capState, status: 'variation_suggested' }, kind: 'variation', reason: `Hit ${repsStr} at your ${w(atCap)} max` };
      }
      return {
        state: { ...capState, status: 'capped', snooze: Math.max(0, base.snooze - 1) },
        kind: 'capped',
        reason: input.hasHarderVariation
          ? `Hit ${repsStr} · at your ${w(atCap)} max`
          : `Hit ${repsStr} · at your ${w(atCap)} max. Link a harder variation or raise the cap`,
      };
    }
    let newTarget = suggestWeight(next, inc, cap);
    if (lighter) newTarget = Math.min(newTarget, target);
    const r = rampReps(evalW, newTarget, T);
    return {
      state: { ...st, target_weight_kg: newTarget, target_reps: repsAt(r), status: 'progressing', fail_streak: 0, snooze: 0 },
      kind: 'up',
      reason: lighter && !gt(next, target)
        ? `Hit ${repsStr} at ${w(evalW)} → back to ${w(newTarget)} × ${r}`
        : `Hit ${repsStr} → ${fmtDelta(newTarget - evalW, units)}${r < T ? ` × ${r}` : ''} next time`,
    };
  }

  const next = repsUp();

  if (lighter) {
    // Trained lighter on purpose. Not a stall; keep the original target.
    return {
      state: { ...st, target_weight_kg: target, target_reps: next, status: 'holding' },
      kind: 'hold',
      reason: `${repsStr} at ${w(evalW)} (lighter) · hold ${w(target)}`,
    };
  }

  // Trained at (or above) target: adopt the weight used.
  const held = suggestWeight(Math.max(evalW, target), inc, cap);

  if (baseline) {
    return {
      state: { ...st, target_weight_kg: held, target_reps: next, status: 'holding', fail_streak: 0 },
      kind: 'baseline',
      reason: `Baseline ${w(held)} · ${repsStr} · aim ${aim(next)} next`,
    };
  }
  if (!allDone) {
    return {
      state: { ...st, target_weight_kg: held, target_reps: next, status: 'holding' },
      kind: 'hold',
      reason: `${done.length} of ${workingSets} sets · hold ${w(held)}`,
    };
  }
  if (gt(used, target)) {
    return {
      state: { ...st, target_weight_kg: held, target_reps: next, status: 'holding', fail_streak: 0 },
      kind: 'hold',
      reason: `${repsStr} at ${w(held)} · aim ${aim(next)} next`,
    };
  }

  const vs = versusLast(held);
  if (vs !== 'stall') {
    return {
      state: { ...st, target_weight_kg: held, target_reps: next, status: 'holding', fail_streak: 0 },
      kind: 'hold',
      reason: vs ? `${repsStr} · +${vs.gain} reps · aim ${aim(next)} next` : `${repsStr} · aim ${aim(next)} next`,
    };
  }

  // Stall: no rep gain at the same weight.
  const streak = base.fail_streak + 1;
  if (streak >= DELOAD_AFTER_STALLS) {
    const deload = suggestWeight(held * DELOAD_FACTOR, inc, cap);
    return {
      state: { ...st, target_weight_kg: held, target_reps: next, status: 'deload_suggested', fail_streak: 0, prompt_weight_kg: deload },
      kind: 'deload',
      reason: `No rep gain ${DELOAD_AFTER_STALLS} sessions running · deload to ${w(deload)}?`,
    };
  }
  return {
    state: { ...st, target_weight_kg: held, target_reps: next, status: 'holding', fail_streak: streak },
    kind: 'miss',
    reason: `${repsStr} · no rep gain. Hold ${w(held)}`,
  };
}

export function acceptDeload(s: EngineState): EngineState {
  return {
    ...s,
    target_weight_kg: s.prompt_weight_kg ?? s.target_weight_kg,
    status: 'holding',
    prompt_weight_kg: null,
    fail_streak: 0,
  };
}

export function dismissDeload(s: EngineState): EngineState {
  return { ...s, status: 'holding', prompt_weight_kg: null, fail_streak: 0 };
}

export function dismissVariation(s: EngineState): EngineState {
  return { ...s, status: 'capped', snooze: VARIATION_SNOOZE };
}
