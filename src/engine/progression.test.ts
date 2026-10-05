import { describe, expect, it } from 'vitest';
import { fromKg, kgToLb, lbToKg, toKg } from '../shared/units';
import {
  acceptDeload, dismissDeload, dismissVariation, evaluate, initialState, rampReps,
  type EngineState, type ProgressionInput,
} from './progression';
import { floorToIncrement, suggestWeight } from './rounding';

const lb = lbToKg;
const asLb = (kg: number | null) => (kg == null ? null : fromKg(kg, 'lb'));
const T = 12;

function input(over: Partial<ProgressionInput> & { reps?: number[]; weightLb?: number | number[]; prev?: [number, number[]] } = {}): ProgressionInput {
  const reps = over.reps ?? [12, 12, 12];
  const wl = over.weightLb ?? 45;
  const weights = Array.isArray(wl) ? wl : reps.map(() => wl);
  return {
    mode: 'double',
    loadType: 'per_hand',
    workingSets: 3,
    repTarget: T,
    incrementKg: lb(5),
    capKg: null,
    hasHarderVariation: false,
    state: stateAt(45),
    units: 'lb',
    sets: reps.map((r, i) => ({ weight_kg: lb(weights[i]), reps: r, completed: true })),
    previous: over.prev ? { weight_kg: lb(over.prev[0]), reps: over.prev[1] } : null,
    ...over,
  };
}

function stateAt(weightLb: number | null, over: Partial<EngineState> = {}): EngineState {
  return { ...initialState(T, 3), target_weight_kg: weightLb == null ? null : lb(weightLb), ...over };
}

describe('progression engine: reps first, then weight', () => {
  it('hitting the rep target on every set adds weight and drops reps so tonnage still rises', () => {
    const out = evaluate(input());
    expect(out.kind).toBe('up');
    expect(asLb(out.state.target_weight_kg)).toBe(50);
    expect(out.state.target_reps).toEqual([11, 11, 11]); // 45×12 = 540 → 50×11 = 550
    expect(out.state.status).toBe('progressing');
    expect(out.reason).toBe('Hit 12/12/12 → +5 lb × 11 next time');
  });

  it('short of the target: one more rep per set next time, capped at the target', () => {
    const out = evaluate(input({ reps: [12, 11, 9] }));
    expect(out.kind).toBe('hold');
    expect(asLb(out.state.target_weight_kg)).toBe(45);
    expect(out.state.target_reps).toEqual([12, 12, 10]);
    expect(out.state.fail_streak).toBe(0);
  });

  it('a full cycle: climb reps at 45, step to 50 × 11, climb back to 12', () => {
    let st: EngineState = stateAt(45, { target_reps: [10, 10, 10] });
    let prev: [number, number[]] = [45, [9, 9, 9]];
    const seen: string[] = [];
    const sessions: [number, number[]][] = [[45, [10, 10, 10]], [45, [11, 11, 11]], [45, [12, 12, 12]], [50, [11, 11, 11]], [50, [12, 12, 12]]];
    for (const [wt, reps] of sessions) {
      const out = evaluate(input({ state: st, weightLb: wt, reps, prev }));
      seen.push(`${asLb(out.state.target_weight_kg)}×${out.state.target_reps[0]}`);
      st = out.state;
      prev = [wt, reps];
    }
    expect(seen).toEqual(['45×11', '45×12', '50×11', '50×12', '55×11']);
  });

  it('tonnage per set never drops when the weight goes up', () => {
    for (const [from, to, t] of [[45, 50, 12], [20, 25, 12], [225, 230, 5], [10, 15, 10], [100, 105, 8]]) {
      const r = rampReps(lb(from), lb(to), t);
      expect(to * r).toBeGreaterThan(from * t);
      expect(r).toBeLessThanOrEqual(t);
    }
    expect(rampReps(lb(20), lb(25), 12)).toBe(10);
    expect(rampReps(lb(225), lb(230), 5)).toBe(5); // small relative jump: keep the reps
  });

  it('gaining reps at the same weight is progress, never a stall', () => {
    const out = evaluate(input({ reps: [10, 9, 8], prev: [45, [9, 8, 8]], state: stateAt(45, { fail_streak: 2 }) }));
    expect(out.kind).toBe('hold');
    expect(out.state.fail_streak).toBe(0);
    expect(out.reason).toBe('10/9/8 · +2 reps · aim 11/10/9 next');
  });

  it('three sessions without a rep gain → deload suggested at 90%, rounded down', () => {
    let state = stateAt(100);
    const stall = { reps: [8, 7, 6], weightLb: 100, prev: [100, [8, 7, 6]] as [number, number[]] };
    let out = evaluate(input({ ...stall, state }));
    expect(out.kind).toBe('miss');
    expect(out.state.fail_streak).toBe(1);
    out = evaluate(input({ ...stall, state: out.state }));
    expect(out.state.fail_streak).toBe(2);
    out = evaluate(input({ ...stall, state: out.state }));
    expect(out.kind).toBe('deload');
    expect(out.state.status).toBe('deload_suggested');
    expect(asLb(out.state.prompt_weight_kg)).toBe(90);
    expect(out.state.fail_streak).toBe(0);
    state = acceptDeload(out.state);
    expect(asLb(state.target_weight_kg)).toBe(90);
    expect(state.status).toBe('holding');
    expect(dismissDeload(out.state).target_weight_kg).toBe(out.state.target_weight_kg);
  });

  it('no previous session at this weight → no stall counted', () => {
    const out = evaluate(input({ reps: [8, 7, 6], prev: [40, [12, 12, 12]], state: stateAt(45, { fail_streak: 1 }) }));
    expect(out.kind).toBe('hold');
    expect(out.state.fail_streak).toBe(0);
  });

  it('deload rounds down to the increment (95 lb × 0.9 = 85.5 → 85)', () => {
    const out = evaluate(input({ reps: [6, 6, 6], weightLb: 95, state: stateAt(95, { fail_streak: 2 }), prev: [95, [6, 6, 6]] }));
    expect(asLb(out.state.prompt_weight_kg)).toBe(85);
  });

  it('success at the cap without a harder variation → capped, holds at cap', () => {
    const out = evaluate(input({ capKg: lb(50), weightLb: 50, state: stateAt(50) }));
    expect(out.kind).toBe('capped');
    expect(out.state.status).toBe('capped');
    expect(asLb(out.state.target_weight_kg)).toBe(50);
    expect(out.state.target_reps).toEqual([12, 12, 12]);
    expect(out.reason).toContain('Link a harder variation');
  });

  it('success exactly reaching the cap still progresses', () => {
    const out = evaluate(input({ capKg: lb(50) }));
    expect(out.kind).toBe('up');
    expect(asLb(out.state.target_weight_kg)).toBe(50);
  });

  it('success at the cap with a harder variation → variation suggested', () => {
    const out = evaluate(input({ capKg: lb(50), weightLb: 50, state: stateAt(50), hasHarderVariation: true }));
    expect(out.kind).toBe('variation');
    expect(out.state.status).toBe('variation_suggested');
  });

  it('dismissed variation is re-offered after 2 more capped sessions', () => {
    let state = dismissVariation(stateAt(50, { status: 'variation_suggested' }));
    const base = { capKg: lb(50), weightLb: 50, hasHarderVariation: true };
    let out = evaluate(input({ ...base, state }));
    expect(out.kind).toBe('capped');
    state = out.state;
    out = evaluate(input({ ...base, state }));
    expect(out.kind).toBe('capped');
    out = evaluate(input({ ...base, state: out.state }));
    expect(out.kind).toBe('variation');
  });

  it('lifting more than the cap is allowed; suggestions still never exceed it', () => {
    const out = evaluate(input({ capKg: lb(50), weightLb: 55, state: stateAt(50) }));
    expect(out.state.target_weight_kg! <= lb(50) + 1e-9).toBe(true);
  });

  it('cap not on the increment grid never produces a suggestion above the cap', () => {
    const out = evaluate(input({ capKg: lb(52.5), weightLb: 50, state: stateAt(50) }));
    expect(out.state.target_weight_kg! <= lb(52.5) + 1e-9).toBe(true);
    expect(out.state.status).toBe('capped');
  });

  it('training lighter than target is not a stall and keeps the target', () => {
    const out = evaluate(input({ reps: [8, 7, 6], weightLb: 40, state: stateAt(45, { fail_streak: 2 }) }));
    expect(out.kind).toBe('hold');
    expect(out.state.fail_streak).toBe(2);
    expect(asLb(out.state.target_weight_kg)).toBe(45);
  });

  it('lighter session that hits the target climbs back toward the old target, never past it', () => {
    expect(asLb(evaluate(input({ weightLb: 35, state: stateAt(45) })).state.target_weight_kg)).toBe(40);
    expect(asLb(evaluate(input({ weightLb: 40, state: stateAt(45) })).state.target_weight_kg)).toBe(45);
  });

  it('heavier than target adopts the heavier weight', () => {
    const out = evaluate(input({ reps: [10, 9, 9], weightLb: 50, state: stateAt(45) }));
    expect(asLb(out.state.target_weight_kg)).toBe(50);
    expect(out.state.fail_streak).toBe(0);
  });

  it('pinned items never change; progression off never changes', () => {
    const state = stateAt(45, { pinned: true });
    expect(evaluate(input({ state })).state).toEqual(state);
    expect(evaluate(input({ mode: 'none' })).kind).toBe('manual');
  });

  it('no history → baseline from the session, reps up next time', () => {
    const out = evaluate(input({ state: null, reps: [10, 9, 8] }));
    expect(out.kind).toBe('baseline');
    expect(asLb(out.state.target_weight_kg)).toBe(45);
    expect(out.state.target_reps).toEqual([11, 10, 9]);
  });

  it('no history and every set at the target → progresses immediately', () => {
    const out = evaluate(input({ state: null }));
    expect(out.kind).toBe('up');
    expect(asLb(out.state.target_weight_kg)).toBe(50);
  });

  it('incomplete session (2 of 3 sets) holds even at the target', () => {
    const out = evaluate(input({ reps: [12, 12] }));
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
        repTarget: 15,
        state: { ...initialState(15, 3) },
        sets: reps.map((r) => ({ weight_kg: null, reps: r, completed: true })),
        ...over,
      });

    it('progresses reps only', () => {
      const out = bw([10, 9, 8]);
      expect(out.state.target_weight_kg).toBeNull();
      expect(out.state.target_reps).toEqual([11, 10, 9]);
    });

    it('stalls are counted against the previous session', () => {
      expect(bw([10, 9, 8], { previous: { weight_kg: null, reps: [10, 9, 8] } }).kind).toBe('miss');
      expect(bw([10, 9, 9], { previous: { weight_kg: null, reps: [10, 9, 8] } }).kind).toBe('hold');
    });

    it('at the target with a harder variation → variation suggested', () => {
      expect(bw([15, 15, 15], { hasHarderVariation: true }).kind).toBe('variation');
    });

    it('at the target without a variation → capped with a hint', () => {
      const out = bw([15, 15, 15]);
      expect(out.kind).toBe('capped');
      expect(out.reason).toContain('harder variation');
    });
  });

  it('bodyweight_plus starts adding load at the target', () => {
    const out = evaluate({
      ...input(),
      loadType: 'bodyweight_plus',
      state: { ...initialState(T, 3), target_weight_kg: 0 },
      sets: [12, 12, 12].map((r) => ({ weight_kg: null, reps: r, completed: true })),
    });
    expect(out.kind).toBe('up');
    expect(asLb(out.state.target_weight_kg)).toBe(5);
    expect(out.state.target_reps).toEqual([10, 10, 10]);
  });

  describe('increment rounding', () => {
    it('2.5 lb increments', () => {
      expect(asLb(evaluate(input({ incrementKg: lb(2.5) })).state.target_weight_kg)).toBe(47.5);
    });
    it('5 lb increments round an off-grid baseline down', () => {
      expect(asLb(evaluate(input({ state: null, weightLb: 47, reps: [10, 10, 10] })).state.target_weight_kg)).toBe(45);
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
