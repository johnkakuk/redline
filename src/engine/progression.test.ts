import { describe, expect, it } from 'vitest';
import { lbToKg, fromKg, toKg, kgToLb } from '../shared/units';
import {
  acceptDeload, dismissDeload, dismissVariation, evaluate, initialState,
  type EngineState, type ProgressionInput,
} from './progression';
import { floorToIncrement, suggestWeight } from './rounding';

const lb = lbToKg;
const asLb = (kg: number | null) => (kg == null ? null : fromKg(kg, 'lb'));

function input(over: Partial<ProgressionInput> & { reps?: number[]; weightLb?: number | number[] } = {}): ProgressionInput {
  const reps = over.reps ?? [12, 12, 12];
  const wl = over.weightLb ?? 45;
  const weights = Array.isArray(wl) ? wl : reps.map(() => wl);
  return {
    mode: 'double',
    loadType: 'per_hand',
    workingSets: 3,
    repMin: 8,
    repMax: 12,
    incrementKg: lb(5),
    capKg: null,
    hasHarderVariation: false,
    state: stateAt(45),
    units: 'lb',
    sets: reps.map((r, i) => ({ weight_kg: lb(weights[i]), reps: r, completed: true })),
    ...over,
  };
}

function stateAt(weightLb: number | null, over: Partial<EngineState> = {}): EngineState {
  return { ...initialState(8, 3), target_weight_kg: weightLb == null ? null : lb(weightLb), ...over };
}

describe('progression engine', () => {
  it('success under cap → +increment, reps reset to rep_min', () => {
    const out = evaluate(input());
    expect(out.kind).toBe('up');
    expect(asLb(out.state.target_weight_kg)).toBe(50);
    expect(out.state.target_reps).toEqual([8, 8, 8]);
    expect(out.state.status).toBe('progressing');
    expect(out.reason).toBe('Hit 12/12/12 → +5 lb next time');
  });

  it('success exactly reaching the cap still progresses', () => {
    const out = evaluate(input({ capKg: lb(50) }));
    expect(out.kind).toBe('up');
    expect(asLb(out.state.target_weight_kg)).toBe(50);
  });

  it('success at the cap without a harder variation → capped, holds at cap', () => {
    const out = evaluate(input({ capKg: lb(50), weightLb: 50, state: stateAt(50) }));
    expect(out.kind).toBe('capped');
    expect(out.state.status).toBe('capped');
    expect(asLb(out.state.target_weight_kg)).toBe(50);
    expect(out.reason).toContain('Link a harder variation');
  });

  it('success at the cap with a harder variation → variation_suggested', () => {
    const out = evaluate(input({ capKg: lb(50), weightLb: 50, state: stateAt(50), hasHarderVariation: true }));
    expect(out.kind).toBe('variation');
    expect(out.state.status).toBe('variation_suggested');
    expect(asLb(out.state.target_weight_kg)).toBe(50);
  });

  it('dismissed variation is re-offered after 2 more capped sessions', () => {
    let state = dismissVariation(stateAt(50, { status: 'variation_suggested' }));
    const base = { capKg: lb(50), weightLb: 50, hasHarderVariation: true };
    let out = evaluate(input({ ...base, state }));
    expect(out.kind).toBe('capped');
    state = out.state;
    out = evaluate(input({ ...base, state }));
    expect(out.kind).toBe('capped');
    state = out.state;
    out = evaluate(input({ ...base, state }));
    expect(out.kind).toBe('variation');
  });

  it('partial reps → hold weight, per-set target = min(last + 1, rep_max)', () => {
    const out = evaluate(input({ reps: [12, 11, 9] }));
    expect(out.kind).toBe('hold');
    expect(asLb(out.state.target_weight_kg)).toBe(45);
    expect(out.state.target_reps).toEqual([12, 12, 10]);
    expect(out.state.status).toBe('holding');
    expect(out.state.fail_streak).toBe(0);
  });

  it('3 misses in a row → deload suggested at 90% rounded down; streak resets', () => {
    let state = stateAt(100);
    const miss = { reps: [8, 7, 6], weightLb: 100 };
    let out = evaluate(input({ ...miss, state }));
    expect(out.kind).toBe('miss');
    expect(out.state.fail_streak).toBe(1);
    out = evaluate(input({ ...miss, state: out.state }));
    expect(out.state.fail_streak).toBe(2);
    out = evaluate(input({ ...miss, state: out.state }));
    expect(out.kind).toBe('deload');
    expect(out.state.status).toBe('deload_suggested');
    expect(asLb(out.state.prompt_weight_kg)).toBe(90);
    expect(out.state.fail_streak).toBe(0);
    state = acceptDeload(out.state);
    expect(asLb(state.target_weight_kg)).toBe(90);
    expect(state.status).toBe('holding');
    expect(dismissDeload(out.state).target_weight_kg).toBe(out.state.target_weight_kg);
  });

  it('deload rounds down to the increment (95 lb × 0.9 = 85.5 → 85)', () => {
    let out = evaluate(input({ reps: [6, 6, 6], weightLb: 95, state: stateAt(95, { fail_streak: 2 }) }));
    expect(asLb(out.state.prompt_weight_kg)).toBe(85);
  });

  it('training lighter than target is not a miss', () => {
    const out = evaluate(input({ reps: [8, 7, 6], weightLb: 40, state: stateAt(45, { fail_streak: 2 }) }));
    expect(out.kind).toBe('hold');
    expect(out.state.fail_streak).toBe(2);
    expect(asLb(out.state.target_weight_kg)).toBe(45);
  });

  it('lighter session that hits rep_max climbs back toward the target, never past it', () => {
    const out = evaluate(input({ reps: [12, 12, 12], weightLb: 35, state: stateAt(45) }));
    expect(out.kind).toBe('up');
    expect(asLb(out.state.target_weight_kg)).toBe(40);
    const out2 = evaluate(input({ reps: [12, 12, 12], weightLb: 40, state: stateAt(45) }));
    expect(asLb(out2.state.target_weight_kg)).toBe(45);
  });

  it('heavier than target and short of rep_min holds the old target without a miss', () => {
    const out = evaluate(input({ reps: [7, 6, 6], weightLb: 50, state: stateAt(45) }));
    expect(out.kind).toBe('hold');
    expect(out.state.fail_streak).toBe(0);
    expect(asLb(out.state.target_weight_kg)).toBe(45);
  });

  it('heavier than target within range adopts the heavier weight', () => {
    const out = evaluate(input({ reps: [10, 9, 9], weightLb: 50, state: stateAt(45) }));
    expect(asLb(out.state.target_weight_kg)).toBe(50);
  });

  it('pinned items never change', () => {
    const state = stateAt(45, { pinned: true });
    const out = evaluate(input({ state }));
    expect(out.kind).toBe('pinned');
    expect(out.state).toEqual(state);
  });

  it('progression mode none never changes', () => {
    const out = evaluate(input({ mode: 'none' }));
    expect(out.kind).toBe('manual');
    expect(asLb(out.state.target_weight_kg)).toBe(45);
  });

  it('per-hand cap applies to each dumbbell: 45 → cap 50 → stops at 50', () => {
    const out = evaluate(input({ capKg: lb(50) }));
    expect(asLb(out.state.target_weight_kg)).toBe(50);
    const out2 = evaluate(input({ capKg: lb(50), weightLb: 50, state: out.state }));
    expect(asLb(out2.state.target_weight_kg)).toBe(50);
    expect(out2.state.status).toBe('capped');
  });

  it('cap not on the increment grid never produces a suggestion above the cap', () => {
    const out = evaluate(input({ capKg: lb(52.5), weightLb: 50, state: stateAt(50) }));
    expect(out.state.target_weight_kg! <= lb(52.5) + 1e-9).toBe(true);
    expect(out.state.status).toBe('capped');
  });

  it('no history → baseline from the session', () => {
    const out = evaluate(input({ state: null, reps: [10, 9, 8], weightLb: 45 }));
    expect(out.kind).toBe('baseline');
    expect(asLb(out.state.target_weight_kg)).toBe(45);
    expect(out.state.target_reps).toEqual([11, 10, 9]);
  });

  it('no history and a perfect session → progresses immediately', () => {
    const out = evaluate(input({ state: null }));
    expect(out.kind).toBe('up');
    expect(asLb(out.state.target_weight_kg)).toBe(50);
  });

  it('incomplete session (2 of 3 sets) holds even at rep_max', () => {
    const out = evaluate(input({ reps: [12, 12], weightLb: 45 }));
    expect(out.kind).toBe('hold');
    expect(asLb(out.state.target_weight_kg)).toBe(45);
  });

  it('no completed sets → skipped, state untouched', () => {
    const i = input();
    i.sets = i.sets.map((s) => ({ ...s, completed: false }));
    const out = evaluate(i);
    expect(out.kind).toBe('skipped');
    expect(out.state).toEqual(i.state);
  });

  describe('bodyweight', () => {
    const bw = (reps: number[], over: Partial<ProgressionInput> = {}) =>
      evaluate({
        ...input({ reps }),
        loadType: 'bodyweight',
        repMin: 8,
        repMax: 15,
        state: { ...initialState(8, 3) },
        sets: reps.map((r) => ({ weight_kg: null, reps: r, completed: true })),
        ...over,
      });

    it('progresses reps only', () => {
      const out = bw([10, 9, 8]);
      expect(out.state.target_weight_kg).toBeNull();
      expect(out.state.target_reps).toEqual([11, 10, 9]);
    });

    it('at rep_max with a harder variation → variation suggested', () => {
      const out = bw([15, 15, 15], { hasHarderVariation: true });
      expect(out.kind).toBe('variation');
    });

    it('at rep_max without a variation → capped with a hint', () => {
      const out = bw([15, 15, 15]);
      expect(out.kind).toBe('capped');
      expect(out.reason).toContain('harder variation');
    });
  });

  it('bodyweight_plus starts adding load at rep_max', () => {
    const out = evaluate({
      ...input(),
      loadType: 'bodyweight_plus',
      state: { ...initialState(8, 3), target_weight_kg: 0 },
      sets: [12, 12, 12].map((r) => ({ weight_kg: null, reps: r, completed: true })),
    });
    expect(out.kind).toBe('up');
    expect(asLb(out.state.target_weight_kg)).toBe(5);
  });

  describe('increment rounding', () => {
    it('2.5 lb increments', () => {
      const out = evaluate(input({ incrementKg: lb(2.5), weightLb: 45 }));
      expect(asLb(out.state.target_weight_kg)).toBe(47.5);
    });
    it('5 lb increments round an off-grid baseline down', () => {
      const out = evaluate(input({ state: null, weightLb: 47, reps: [10, 10, 10] }));
      expect(asLb(out.state.target_weight_kg)).toBe(45);
    });
    it('floorToIncrement tolerates float noise', () => {
      expect(floorToIncrement(lb(50), lb(5))).toBeCloseTo(lb(50), 9);
      expect(floorToIncrement(lb(49.99), lb(5))).toBeCloseTo(lb(45), 9);
      expect(suggestWeight(lb(60), lb(5), lb(50))).toBeCloseTo(lb(50), 9);
    });
  });

  describe('units', () => {
    it('50 lb ↔ kg ↔ 50 lb round-trips', () => {
      expect(fromKg(toKg(50, 'lb'), 'lb')).toBe(50);
      expect(kgToLb(lbToKg(50))).toBeCloseTo(50, 9);
    });
    it('every whole and half pound value from 0–600 round-trips', () => {
      for (let v = 0; v <= 600; v += 0.5) expect(fromKg(toKg(v, 'lb'), 'lb')).toBe(v);
    });
    it('kg values display as kg', () => {
      expect(fromKg(toKg(22.5, 'kg'), 'kg')).toBe(22.5);
      expect(fromKg(lbToKg(50), 'kg')).toBe(22.7);
    });
  });
});
