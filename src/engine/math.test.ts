import { describe, expect, it } from 'vitest';
import { lbToKg } from '../shared/units';
import { activeSeconds, correctedMet, estimateKcal, MET, mifflinStJeor } from './calories';
import { e1rm } from './e1rm';
import { computePrEvents, detectVolumePr, sessionVolume } from './prs';
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

describe('PRs (session volume only)', () => {
  const set = (id: string, wid: string, w: number, r: number, at: string) =>
    ({ set_id: id, workout_id: wid, weight_kg: w, reps: r, completed_at: at });

  it('first session is the baseline; only sessions beating the best volume are records', () => {
    const ev = computePrEvents([
      set('a', 'w1', 50, 10, '2026-01-01T10:00:00Z'), // w1: 500 + 450 = 950
      set('b', 'w1', 50, 9, '2026-01-01T10:05:00Z'),
      set('c', 'w2', 50, 8, '2026-01-08T10:00:00Z'), // w2: 400 + 400 = 800 (no record)
      set('d', 'w2', 50, 8, '2026-01-08T10:05:00Z'),
      set('e', 'w3', 55, 9, '2026-01-15T10:00:00Z'), // w3: 495 + 495 = 990 (record)
      set('f', 'w3', 55, 9, '2026-01-15T10:05:00Z'),
    ], 'total');
    expect(ev.map((e) => [e.type, e.workout_id, e.value, e.baseline])).toEqual([
      ['session_volume', 'w1', 950, true],
      ['session_volume', 'w3', 990, false],
    ]);
  });

  it('per-hand volume counts both dumbbells; bodyweight counts reps', () => {
    expect(sessionVolume([{ weight_kg: 20, reps: 10 }], 'per_hand')).toBe(400);
    expect(sessionVolume([{ weight_kg: null, reps: 12 }, { weight_kg: null, reps: 10 }], 'bodyweight')).toBe(22);
  });

  it('live: badge on the set that pushes the session past the previous best, once', () => {
    // Previous best session: 950. Set 1 brings 500 (no), set 2 crosses to 1000 (PR), set 3 is already past (no repeat).
    expect(detectVolumePr({ weight_kg: 50, reps: 10 }, [], 950, 'total')).toEqual([]);
    expect(detectVolumePr({ weight_kg: 50, reps: 10 }, [{ weight_kg: 50, reps: 10 }], 950, 'total'))
      .toEqual([{ type: 'session_volume', value: 1000, weight_kg: null, reps: null }]);
    expect(detectVolumePr({ weight_kg: 50, reps: 10 }, [{ weight_kg: 50, reps: 10 }, { weight_kg: 50, reps: 10 }], 950, 'total')).toEqual([]);
  });

  it('live: no badge during an exercise\'s first session', () => {
    expect(detectVolumePr({ weight_kg: 50, reps: 10 }, [], 0, 'total')).toEqual([]);
  });
});
