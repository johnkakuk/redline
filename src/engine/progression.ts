// Double progression engine. Pure: no I/O. See PLAN.md §5.
import type { LoadType, ProgressionKind, ProgressionMode, ProgressionState, Units } from '../shared/types';
import { fmtDelta, fmtWeight } from '../shared/units';
import { floorToIncrement, gt, lt, suggestWeight } from './rounding';

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
  repMin: number;
  repMax: number;
  incrementKg: number;
  capKg: number | null;
  hasHarderVariation: boolean;
  /** null = no history for this routine item. */
  state: EngineState | null;
  /** Working sets from the session just finished, in order. Warm-ups excluded by the caller. */
  sets: EngineSet[];
  units: Units;
}

export interface ProgressionOutput {
  state: EngineState;
  kind: ProgressionKind;
  reason: string;
}

/** Sessions to wait before re-offering a dismissed variation swap. */
export const VARIATION_SNOOZE = 2;
export const DELOAD_AFTER_MISSES = 3;
export const DELOAD_FACTOR = 0.9;

export function initialState(repMin: number, workingSets: number): EngineState {
  return {
    target_weight_kg: null,
    target_reps: Array.from({ length: workingSets }, () => repMin),
    status: 'progressing',
    fail_streak: 0,
    pinned: false,
    prompt_weight_kg: null,
    snooze: 0,
  };
}

export function evaluate(input: ProgressionInput): ProgressionOutput {
  const { mode, loadType, workingSets, repMin, repMax, incrementKg: inc, capKg: cap, units } = input;
  const base: EngineState = input.state
    ? { ...input.state, target_reps: [...input.state.target_reps] }
    : initialState(repMin, workingSets);
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
  const allMax = allDone && done.every((s) => s.reps >= repMax);
  const allMin = done.every((s) => s.reps >= repMin);
  const repsUp = () =>
    Array.from({ length: workingSets }, (_, i) => Math.max(repMin, Math.min((done[i]?.reps ?? repMin - 1) + 1, repMax)));
  const repsAt = (n: number) => Array.from({ length: workingSets }, () => n);

  // Rule 6: bodyweight-only exercises progress reps, then graduate to a harder variation.
  if (loadType === 'bodyweight') {
    const st: EngineState = { ...base, target_weight_kg: null, prompt_weight_kg: null };
    if (allMax) {
      st.target_reps = repsAt(repMax);
      st.fail_streak = 0;
      if (input.hasHarderVariation && base.snooze <= 0) {
        return { state: { ...st, status: 'variation_suggested' }, kind: 'variation', reason: `Hit ${repsStr}. Ready for a harder variation` };
      }
      return {
        state: { ...st, status: 'capped', snooze: Math.max(0, base.snooze - 1) },
        kind: 'capped',
        reason: input.hasHarderVariation ? `Hit ${repsStr} · at max reps` : `Hit ${repsStr} · link a harder variation to keep progressing`,
      };
    }
    if (allMin) {
      return { state: { ...st, status: 'holding', fail_streak: 0, target_reps: repsUp() }, kind: 'hold', reason: allDone ? `${repsStr} · reps up next time` : `${done.length} of ${workingSets} sets · hold` };
    }
    return {
      state: { ...st, status: 'holding', fail_streak: base.fail_streak + 1, target_reps: repsUp() },
      kind: 'miss',
      reason: `${repsStr} · below ${repMin}. Hold`,
    };
  }

  // Loaded exercises. Evaluate against the lightest working weight actually used (rules 1 & 5).
  const used = Math.min(...done.map((s) => s.weight));
  const baseline = base.target_weight_kg == null;
  const target = base.target_weight_kg ?? suggestWeight(used, inc, cap);
  const lighter = !baseline && lt(used, target);
  const evalW = used;
  const st: EngineState = { ...base, prompt_weight_kg: null };

  if (allMax) {
    const next = evalW + inc;
    if (cap != null && gt(next, cap)) {
      // Rule 2: success, but the next step would exceed the equipment cap.
      const atCap = Math.min(cap, Math.max(floorToIncrement(cap, inc), Math.min(evalW, cap)));
      const capState: EngineState = { ...st, target_weight_kg: atCap, target_reps: repsAt(repMax), fail_streak: 0 };
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
    return {
      state: { ...st, target_weight_kg: newTarget, target_reps: repsAt(repMin), status: 'progressing', fail_streak: 0, snooze: 0 },
      kind: 'up',
      reason: lighter && !gt(next, target)
        ? `Hit ${repsStr} at ${w(evalW)} → back to ${w(newTarget)}`
        : `Hit ${repsStr} → ${fmtDelta(newTarget - evalW, units)} next time`,
    };
  }

  if (lighter) {
    // Rule 5: trained lighter on purpose. Not a miss; keep the original target.
    return {
      state: { ...st, target_weight_kg: target, target_reps: repsUp(), status: 'holding' },
      kind: 'hold',
      reason: `${repsStr} at ${w(evalW)} (lighter) · hold ${w(target)}`,
    };
  }

  // Trained at (or above) target: adopt the weight used.
  const held = suggestWeight(Math.max(evalW, target), inc, cap);

  if (allMin) {
    return {
      state: { ...st, target_weight_kg: held, target_reps: repsUp(), status: 'holding', fail_streak: 0 },
      kind: baseline ? 'baseline' : 'hold',
      reason: baseline
        ? `Baseline ${w(held)} · ${repsStr}`
        : allDone ? `${repsStr} · reps up next time` : `${done.length} of ${workingSets} sets · hold`,
    };
  }

  if (!baseline && gt(used, target)) {
    // Tried heavier than target and fell short: not a miss at the target weight.
    return {
      state: { ...st, target_weight_kg: target, target_reps: repsUp(), status: 'holding' },
      kind: 'hold',
      reason: `${repsStr} at ${w(evalW)} (heavier) · hold ${w(target)}`,
    };
  }

  // Rule 4: miss.
  const streak = base.fail_streak + 1;
  if (streak >= DELOAD_AFTER_MISSES) {
    const deload = suggestWeight(held * DELOAD_FACTOR, inc, cap);
    return {
      state: { ...st, target_weight_kg: held, target_reps: repsUp(), status: 'deload_suggested', fail_streak: 0, prompt_weight_kg: deload },
      kind: 'deload',
      reason: `Under ${repMin} reps ${DELOAD_AFTER_MISSES} sessions running · deload to ${w(deload)}?`,
    };
  }
  return {
    state: { ...st, target_weight_kg: held, target_reps: repsUp(), status: 'holding', fail_streak: streak },
    kind: baseline ? 'baseline' : 'miss',
    reason: baseline ? `Baseline ${w(held)} · ${repsStr}` : `${repsStr} · below ${repMin}. Hold ${w(held)}`,
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

/** Per-set suggestion for the next session from a state. */
export function suggestionFor(state: EngineState | null, setIndex: number, repMin: number) {
  return {
    weight_kg: state?.target_weight_kg ?? null,
    reps: state?.target_reps[setIndex] ?? state?.target_reps[state.target_reps.length - 1] ?? repMin,
  };
}
