import { describe, expect, it } from 'vitest';
import { lbToKg } from '../shared/units';
import { activeSeconds, correctedMet, estimateKcal, MET, mifflinStJeor } from './calories';
import { e1rm } from './e1rm';
import { computePrEvents, detectSetPrs } from './prs';
import { setsPerMuscle, setTonnage } from './volume';
import { warmupSets } from './warmups';

describe('e1rm', () => {
  it('Epley for 2–12 reps', () => expect(e1rm(100, 10)).toBeCloseTo(133.333, 2));
  it('single = weight', () => expect(e1rm(100, 1)).toBe(100));
  it('null above 12 reps or no load', () => {
    expect(e1rm(100, 13)).toBeNull();
    expect(e1rm(0, 5)).toBeNull();
  });
});

describe('calories', () => {
  const profile = { sex: 'male' as const, ageYears: 35, heightCm: 180 };

  it('Mifflin-St Jeor', () => {
    expect(mifflinStJeor(80, 180, 35, 'male')).toBe(1755);
    expect(mifflinStJeor(60, 165, 30, 'female')).toBe(1320.25);
  });

  it('corrected MET scales by the ratio of standard to actual RMR', () => {
    // RMR 1755 kcal/day @ 80 kg → 1755/1440/5*1000/80 = 3.047 ml/kg/min
    const rmrMl = ((1755 / 1440 / 5) * 1000) / 80;
    expect(correctedMet('moderate', 80, profile)).toBeCloseTo((5 * 3.5) / rmrMl, 6);
  });

  it('falls back to raw MET without a full profile', () => {
    expect(correctedMet('vigorous', 80, { sex: null, ageYears: null, heightCm: null })).toBe(MET.vigorous);
  });

  it('kcal = MET × kg × hours', () => {
    expect(estimateKcal('moderate', 80, 3600, { sex: null, ageYears: 35, heightCm: 180 })).toBe(400);
    expect(estimateKcal('moderate', 80, 3600, profile)).toBeGreaterThan(400);
  });

  it('active seconds exclude pauses longer than 10 minutes', () => {
    const t0 = 0;
    const min = 60_000;
    // sets every 2 min for 20 min, then a 30 min gap, then 2 more sets
    const events = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 50, 52].map((m) => t0 + m * min);
    expect(activeSeconds(t0, 54 * min, events)).toBe(24 * 60);
  });
});

describe('volume', () => {
  it('tonnage doubles for per-hand loads', () => {
    expect(setTonnage(20, 10, 'per_hand')).toBe(400);
    expect(setTonnage(20, 10, 'total')).toBe(200);
    expect(setTonnage(null, 10, 'total')).toBe(0);
  });
  it('primary 1.0, secondary 0.5', () => {
    expect(setsPerMuscle([
      { primary: 'chest', secondary: ['triceps', 'front_delts'], sets: 3 },
      { primary: 'triceps', secondary: [], sets: 3 },
    ])).toEqual({ chest: 3, triceps: 4.5, front_delts: 1.5 });
  });
});

describe('warm-ups', () => {
  it('50/70/85% rounded down to the increment', () => {
    const w = warmupSets(lbToKg(100), lbToKg(5)).map((s) => [Math.round(s.weight_kg / lbToKg(1)), s.reps]);
    expect(w).toEqual([[50, 8], [70, 5], [85, 2]]);
    const w2 = warmupSets(lbToKg(45), lbToKg(5)).map((s) => Math.round(s.weight_kg / lbToKg(1)));
    expect(w2).toEqual([20, 30, 35]);
  });
});

describe('PRs', () => {
  const set = (id: string, wid: string, w: number, r: number, at: string) =>
    ({ set_id: id, workout_id: wid, weight_kg: w, reps: r, completed_at: at });

  it('first session is baseline; later improvements are events', () => {
    const ev = computePrEvents([
      set('a', 'w1', 50, 10, '2026-01-01T10:00:00Z'),
      set('b', 'w1', 50, 9, '2026-01-01T10:05:00Z'),
      set('c', 'w2', 50, 12, '2026-01-08T10:00:00Z'),
      set('d', 'w2', 55, 8, '2026-01-08T10:05:00Z'),
    ], 'total');
    const nonBase = ev.filter((e) => !e.baseline).map((e) => `${e.type}:${e.set_id ?? e.workout_id}`);
    expect(nonBase).toEqual(['best_e1rm:c', 'reps_at_weight:c', 'max_weight:d', 'session_volume:w2']);
    expect(ev.filter((e) => e.baseline).map((e) => e.type)).toContain('max_weight');
  });

  it('live detection: none on first session, then heaviest / e1RM / rep PR', () => {
    expect(detectSetPrs({ weight_kg: 50, reps: 10 }, [], 'total')).toEqual([]);
    const hist = [{ weight_kg: 50, reps: 10 }];
    expect(detectSetPrs({ weight_kg: 55, reps: 5 }, hist, 'total').map((h) => h.type)).toEqual(['max_weight']);
    expect(detectSetPrs({ weight_kg: 50, reps: 11 }, hist, 'total').map((h) => h.type)).toEqual(['best_e1rm']);
    expect(detectSetPrs({ weight_kg: 50, reps: 10 }, hist, 'total')).toEqual([]);
    expect(detectSetPrs({ weight_kg: null, reps: 12 }, [{ weight_kg: null, reps: 10 }], 'bodyweight').map((h) => h.type)).toEqual(['reps_at_weight']);
  });
});
