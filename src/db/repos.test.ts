import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeEach, describe, expect, it } from 'vitest';
import { lbToKg, fromKg } from '../shared/units';
import { createApi, type DbApi } from './api';
import { MIGRATIONS } from './migrate';
import { wrapDb, type Oo1Db } from './sqlite';

const sqlite3 = await sqlite3InitModule();
const lb = lbToKg;
const asLb = (kg: number | null | undefined) => (kg == null ? null : fromKg(kg, 'lb'));

let api: DbApi;

function fresh(): DbApi {
  const raw = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Oo1Db;
  return createApi(wrapDb(raw), { vfs: 'memory' });
}

const ex = (name: string) => api.findExerciseByName(name)!;

/** Complete every working set of a workout exercise with the given reps (weights from suggestions or override). */
function doSets(workoutId: string, name: string, reps: number[], weightLb?: number) {
  const w = api.getWorkout(workoutId);
  const we = w.exercises.find((e) => e.exercise.name === name)!;
  const working = we.sets.filter((s) => s.kind === 'working');
  working.forEach((s, i) => {
    if (reps[i] == null) return;
    api.completeSet(s.id, { reps: reps[i], ...(weightLb != null ? { weight_kg: lb(weightLb) } : {}) });
  });
  return we;
}

beforeEach(() => {
  api = fresh();
});

describe('boot', () => {
  it('migrates, seeds ~100 exercises with linked variation chains', () => {
    expect(api.boot().schemaVersion).toBe(5);
    expect(api.listExercises().length).toBeGreaterThan(80);
    const push = ex('Push-up');
    expect(push.harder_variation_id).toBe(ex('Decline Push-up').id);
    expect(ex('Decline Push-up').easier_variation_id).toBe(push.id);
    expect(asLb(ex('DB Bench Press').default_increment_kg)).toBe(5);
    expect(asLb(ex('Lat Pulldown').default_increment_kg)).toBe(10);
  });

  it('seeded exercises have the same ids on every install; old random ids are remapped', () => {
    expect(ex('Push-up').id).toBe('seed-push-up');
    expect(fresh().findExerciseByName('DB Bench Press')!.id).toBe(ex('DB Bench Press').id);
  });

  it('includes Hollow Rock (bodyweight abs)', () => {
    expect(ex('Hollow Rock')).toMatchObject({ id: 'seed-hollow-rock', equipment: 'bodyweight', load_type: 'bodyweight', primary_muscle: 'abs' });
  });

  it('hollow progression is chained easier → harder', () => {
    const chain = ['Dead Bug', 'Tuck Hollow Hold', 'Hollow Body Hold', 'Hollow Rock', 'V-Up'];
    chain.forEach((name, i) => {
      const e = ex(name);
      expect(e.equipment).toBe('bodyweight');
      expect(e.harder_variation_id).toBe(i < chain.length - 1 ? ex(chain[i + 1]).id : null);
      expect(e.easier_variation_id).toBe(i > 0 ? ex(chain[i - 1]).id : null);
    });
  });

  it('harder variations are actually harder at a capped dumbbell', () => {
    const harder = (n: string) => { const h = ex(n).harder_variation_id; return h ? api.getExercise(h).name : null; };
    expect(harder('DB Bench Press')).toBe('Paused DB Bench Press');
    expect(harder('Paused DB Bench Press')).toBe('1½-Rep DB Bench Press');
    expect(harder('Incline DB Press')).toBe('Paused Incline DB Press');
    expect(harder('DB Shoulder Press')).toBe('Seated DB Z-Press');
    expect(harder('Single-Arm DB Bench Press')).toBeNull();
    expect(harder('Single-Arm DB Shoulder Press')).toBeNull();
    expect(harder('DB Hip Thrust')).toBe('Single-Leg DB Hip Thrust');
    expect(harder('DB Calf Raise')).toBe('Single-Leg DB Calf Raise');
    expect(harder('Overhead DB Triceps Extension')).toBe('Single-Arm Overhead DB Extension');
    expect(api.getExercise(ex('Seated DB Z-Press').easier_variation_id!).name).toBe('DB Shoulder Press');
  });

  it('existing installs move off retired links, but user-edited links are kept', () => {
    // Simulate an older install: old built-in link on bench, a custom link on shoulder press.
    api.saveExercise({ ...ex('Paused DB Bench Press'), easier_variation_id: null });
    api.saveExercise({ ...ex('DB Bench Press'), harder_variation_id: ex('Single-Arm DB Bench Press').id });
    api.saveExercise({ ...ex('DB Shoulder Press'), harder_variation_id: ex('Arnold Press')?.id ?? ex('Machine Shoulder Press').id });
    api.seedExercises();
    expect(ex('DB Bench Press').harder_variation_id).toBe(ex('Paused DB Bench Press').id);
    expect(ex('DB Shoulder Press').harder_variation_id).toBe(ex('Machine Shoulder Press').id);
  });

  it('seeding is idempotent', () => {
    expect(api.seedExercises()).toBe(0);
  });

  it('search and filters', () => {
    expect(api.listExercises({ search: 'db bench' }).map((e) => e.name)).toContain('DB Bench Press');
    expect(api.listExercises({ equipment: 'kettlebell' }).every((e) => e.equipment === 'kettlebell')).toBe(true);
    expect(api.listExercises({ muscle: 'triceps' }).map((e) => e.name)).toContain('DB Bench Press'); // secondary
  });

  it('equipment caps apply to all seeded exercises of that type', () => {
    api.applyEquipmentCaps({ dumbbell: lb(50) });
    expect(asLb(ex('Incline DB Press').max_load_kg)).toBe(50);
    expect(ex('Barbell Bench Press').max_load_kg).toBeNull();
  });

  it('switching to kg moves default increments to kg-friendly values', () => {
    api.setUnits('kg');
    expect(ex('DB Bench Press').default_increment_kg).toBe(2);
    expect(api.getSettings().default_increment.barbell).toBe(2.5);
  });
});

describe('workout loop', () => {
  let routineId: string;
  beforeEach(() => {
    api.applyEquipmentCaps({ dumbbell: lb(50) });
    routineId = api.saveRoutine({
      name: 'Upper B',
      items: [
        { exercise_id: ex('Incline DB Press').id, working_sets: 3, rep_max: 12 },
        { exercise_id: ex('Lateral Raise').id, working_sets: 3, rep_max: 15, group_id: 'g1' },
        { exercise_id: ex('Triceps Pushdown').id, working_sets: 3, rep_max: 12, group_id: 'g1' },
      ],
    });
  });

  it('first session: no weight suggestions, then baseline', () => {
    const wid = api.startWorkout({ routineId });
    const w = api.getWorkout(wid);
    expect(w.exercises).toHaveLength(3);
    expect(w.exercises[1].group_id).toBe(w.exercises[2].group_id);
    expect(w.exercises[0].sets.every((s) => s.suggested_weight_kg == null)).toBe(true);
    expect(w.exercises[0].sets.map((s) => s.suggested_reps)).toEqual([12, 12, 12]);
    expect(asLb(w.exercises[0].cap_kg)).toBe(50);

    doSets(wid, 'Incline DB Press', [10, 9, 8], 45);
    doSets(wid, 'Lateral Raise', [15, 15, 15], 15);
    const sum = api.finishWorkout(wid);
    expect(sum.workout.status).toBe('completed');
    expect(sum.working_sets).toBe(6);
    expect(sum.tonnage_kg).toBeCloseTo(lb(45 * 27 * 2 + 15 * 45 * 2), 6);
    const byName = Object.fromEntries(sum.changes.map((c) => [c.exercise_name, c]));
    expect(byName['Incline DB Press'].kind).toBe('baseline');
    expect(byName['Lateral Raise'].kind).toBe('up');
    expect(byName['Lateral Raise'].reason).toBe('Hit 15/15/15 → +5 lb × 12 next time');
    expect(byName['Triceps Pushdown']).toBeUndefined(); // no sets → removed, not evaluated
    expect(sum.prs).toHaveLength(0); // first session is baseline
  });

  it('next session pre-fills from progression state and warms up', () => {
    let wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [12, 12, 12], 45);
    api.finishWorkout(wid);

    api.saveRoutine({
      ...api.getRoutine(routineId),
      items: api.getRoutine(routineId).items.map((i) => (i.exercise.name === 'Incline DB Press' ? { ...i, warmup_sets: 3 } : i)),
    });
    wid = api.startWorkout({ routineId });
    const we = api.getWorkout(wid).exercises[0];
    const warm = we.sets.filter((s) => s.kind === 'warmup');
    const work = we.sets.filter((s) => s.kind === 'working');
    expect(work.map((s) => asLb(s.suggested_weight_kg))).toEqual([50, 50, 50]);
    expect(warm.map((s) => [asLb(s.suggested_weight_kg), s.suggested_reps])).toEqual([[25, 8], [35, 5], [40, 2]]);
  });

  it('at the cap with a harder variation: prompt, then swap keeps sets and rep range', () => {
    let wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [12, 12, 12], 50);
    let sum = api.finishWorkout(wid);
    const c = sum.changes.find((x) => x.exercise_name === 'Incline DB Press')!;
    expect(c.kind).toBe('variation');
    expect(c.pending).toBe('variation');
    expect(c.harder_variation?.name).toBe('Paused Incline DB Press');

    api.respondVariation(c.routine_item_id, true);
    const r = api.getRoutine(routineId);
    expect(r.items[0].exercise.name).toBe('Paused Incline DB Press');
    expect([r.items[0].working_sets, r.items[0].rep_min, r.items[0].rep_max]).toEqual([3, 12, 12]);
    expect(r.items[0].state?.target_weight_kg).toBeNull();
    sum = api.getSummary(wid);
    expect(sum.changes[0].pending).toBeNull();
  });

  it('dismissing a variation holds at the cap', () => {
    const wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [12, 12, 12], 50);
    const c = api.finishWorkout(wid).changes[0];
    api.respondVariation(c.routine_item_id, false);
    const st = api.getRoutine(routineId).items[0].state!;
    expect(st.status).toBe('capped');
    expect(st.snooze).toBe(2);
  });

  it('suggestions never exceed the cap', () => {
    let wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [12, 12, 12], 45);
    api.finishWorkout(wid);
    wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [12, 12, 12]);
    api.finishWorkout(wid);
    wid = api.startWorkout({ routineId });
    const we = api.getWorkout(wid).exercises[0];
    expect(we.sets.every((s) => (s.suggested_weight_kg ?? 0) <= lb(50) + 1e-9)).toBe(true);
  });

  it('undo reverts this session’s progression', () => {
    let wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [10, 10, 10], 45);
    api.finishWorkout(wid);
    const before = api.getRoutine(routineId).items[0].state!;
    wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [12, 12, 12]);
    api.finishWorkout(wid);
    expect(asLb(api.getRoutine(routineId).items[0].state!.target_weight_kg)).toBe(50);
    api.undoProgression(wid);
    expect(api.getRoutine(routineId).items[0].state).toEqual(before);
    expect(api.getSummary(wid).changes[0].undone).toBe(true);
  });

  it('live PRs after the first session; materialized on finish', () => {
    let wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [10, 10, 10], 40);
    api.finishWorkout(wid);
    wid = api.startWorkout({ routineId });
    const we = api.getWorkout(wid).exercises[0];
    const first = we.sets.find((s) => s.kind === 'working')!;
    const { prs } = api.completeSet(first.id, { weight_kg: lb(45), reps: 10 });
    expect(prs.map((p) => p.type)).toEqual(['max_weight']);
    const sum = api.finishWorkout(wid);
    expect(sum.prs.map((p) => p.type).sort()).toEqual(['best_e1rm', 'max_weight']);
    expect(api.recentPrs({}).length).toBeGreaterThan(0);
  });

  it('only one active workout; discard; resume', () => {
    const a = api.startWorkout({ routineId });
    expect(api.startWorkout({})).toBe(a);
    expect(api.getActiveWorkout()?.id).toBe(a);
    api.discardWorkout(a);
    expect(api.getActiveWorkout()).toBeNull();
  });

  it('a weight entered on set 1 is suggested for later empty sets', () => {
    const wid = api.startWorkout({ routineId });
    const sets = api.getWorkout(wid).exercises[0].sets;
    api.updateSet(sets[0].id, { weight_kg: lb(45) });
    const after = api.getWorkout(wid).exercises[0].sets;
    expect(after.map((s) => asLb(s.suggested_weight_kg))).toEqual([null, 45, 45]);
    expect(api.completeSet(after[1].id).prs).toEqual([]);
    expect(asLb(api.getWorkout(wid).exercises[0].sets[1].weight_kg)).toBe(45);
  });

  it('workoutsBetween finds completed workouts in a time range', () => {
    const wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [10, 10, 10], 45);
    api.finishWorkout(wid);
    const day = 86400000;
    expect(api.workoutsBetween(new Date(Date.now() - day).toISOString(), new Date(Date.now() + day).toISOString()).map((w) => w.id)).toEqual([wid]);
    expect(api.workoutsBetween(new Date(Date.now() + day).toISOString(), new Date(Date.now() + 2 * day).toISOString())).toEqual([]);
  });

  it('a rep range from an older routine collapses to its top', () => {
    const rid = api.saveRoutine({ name: 'Old', items: [{ exercise_id: ex('DB Curl').id, rep_min: 8, rep_max: 12 }] });
    expect(api.getRoutine(rid).items[0]).toMatchObject({ rep_min: 12, rep_max: 12 });
  });

  it('reps climb session to session, then weight goes up with fewer reps', () => {
    const run = (weightLb: number | undefined, reps: number[]) => {
      const wid = api.startWorkout({ routineId });
      doSets(wid, 'Incline DB Press', reps, weightLb);
      return api.finishWorkout(wid).changes.find((c) => c.exercise_name === 'Incline DB Press')!;
    };
    expect(run(40, [10, 10, 10]).reason).toBe('Baseline 40 lb · 10/10/10 · aim 11 next');
    expect(run(undefined, [11, 11, 11]).reason).toBe('11/11/11 · +3 reps · aim 12 next');
    expect(run(undefined, [11, 11, 11]).kind).toBe('miss'); // no gain → stall
    const up = run(undefined, [12, 12, 12]);
    expect(up.reason).toBe('Hit 12/12/12 → +5 lb × 11 next time');
    const wid = api.startWorkout({ routineId });
    const sets = api.getWorkout(wid).exercises[0].sets;
    expect(sets.map((s) => [asLb(s.suggested_weight_kg), s.suggested_reps])).toEqual([[45, 11], [45, 11], [45, 11]]);
    api.discardWorkout(wid);
  });

  it('finishing with nothing completed is refused', () => {
    const a = api.startWorkout({ routineId });
    expect(() => api.finishWorkout(a)).toThrow(/No sets/);
  });

  it('empty workout: add exercise, sets, warm-ups, swap, update routine', () => {
    const wid = api.startWorkout({});
    const weId = api.addExercise(wid, ex('Goblet Squat').id);
    let we = api.getWorkout(wid).exercises[0];
    expect(we.sets).toHaveLength(3);
    api.updateSet(we.sets[0].id, { weight_kg: lb(40) });
    api.addWarmups(weId);
    we = api.getWorkout(wid).exercises[0];
    expect(we.sets.slice(0, 3).map((s) => [s.kind, asLb(s.suggested_weight_kg)])).toEqual([['warmup', 20], ['warmup', 25], ['warmup', 30]]);
    api.addSet(weId);
    expect(api.getWorkout(wid).exercises[0].sets).toHaveLength(7);
    api.swapExercise(weId, ex('KB Goblet Squat').id);
    expect(api.getWorkout(wid).exercises[0].exercise.name).toBe('KB Goblet Squat');
  });

  it('exercises added mid-session can be saved to the routine', () => {
    const wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [10, 10, 10], 45);
    const weId = api.addExercise(wid, ex('Face Pull').id);
    const we = api.getWorkout(wid).exercises.find((e) => e.id === weId)!;
    we.sets.forEach((s) => api.completeSet(s.id, { weight_kg: lb(30), reps: 15 }));
    const sum = api.finishWorkout(wid);
    expect(sum.added_exercises.map((a) => a.name)).toEqual(['Face Pull']);
    expect(api.updateRoutineFromWorkout(wid)).toBe(1);
    const items = api.getRoutine(routineId).items;
    expect(items.at(-1)!.exercise.name).toBe('Face Pull');
    expect(asLb(items.at(-1)!.state!.target_weight_kg)).toBe(30);
  });

  it('calorie estimate uses bodyweight snapshot', () => {
    api.logBodyweight({ date: '2026-10-01', weight_kg: 80 });
    const wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [10, 10, 10], 45);
    const sum = api.finishWorkout(wid);
    expect(sum.workout.bodyweight_kg).toBe(80);
    expect(sum.workout.kcal_estimate).not.toBeNull();
    expect(sum.calorie_profile_complete).toBe(false);
  });

  it('routine editor: remove item soft-deletes, singleton groups dissolve, duplicate', () => {
    const r = api.getRoutine(routineId);
    api.saveRoutine({ id: routineId, name: r.name, items: r.items.filter((i) => i.exercise.name !== 'Triceps Pushdown') });
    const r2 = api.getRoutine(routineId);
    expect(r2.items).toHaveLength(2);
    expect(r2.items[1].group_id).toBeNull();
    const dup = api.duplicateRoutine(routineId);
    expect(api.getRoutine(dup).items).toHaveLength(2);
    expect(api.listRoutines().map((x) => x.name)).toEqual(['Upper B', 'Upper B (copy)']);
  });

  it('next routine rotates after the last completed one', () => {
    const second = api.saveRoutine({ name: 'Lower A', items: [{ exercise_id: ex('Goblet Squat').id }] });
    expect(api.nextRoutine()?.id).toBe(routineId);
    const wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [10, 10, 10], 45);
    api.finishWorkout(wid);
    expect(api.nextRoutine()?.id).toBe(second);
  });

  it('pin freezes, set target writes directly, deload prompt accept', () => {
    const item = api.getRoutine(routineId).items[0];
    api.setTarget(item.id, lb(40), [10, 10, 10]);
    api.setPinned(item.id, true);
    const wid = api.startWorkout({ routineId });
    doSets(wid, 'Incline DB Press', [12, 12, 12]);
    const sum = api.finishWorkout(wid);
    expect(sum.changes[0].kind).toBe('pinned');
    expect(asLb(api.getRoutine(routineId).items[0].state!.target_weight_kg)).toBe(40);
  });
});

describe('migration 004 (pull-up bar) on an existing install', () => {
  const upgrade = (equipmentJson: string | null) => {
    const raw = wrapDb(new sqlite3.oo1.DB(':memory:', 'c') as unknown as Oo1Db);
    for (const m of MIGRATIONS.filter((x) => x.version <= 3)) raw.exec(m.sql);
    raw.run(equipmentJson == null ? `INSERT INTO settings (id) VALUES ('me')` : `INSERT INTO settings (id, equipment_json) VALUES ('me', ?)`, equipmentJson == null ? [] : [equipmentJson]);
    raw.run(`INSERT INTO exercises (id, name, primary_muscle, equipment, load_type, is_seeded) VALUES ('x', 'Pull-up', 'lats', 'bodyweight', 'bodyweight', 1)`);
    raw.run(`INSERT INTO exercises (id, name, primary_muscle, equipment, load_type, is_seeded) VALUES ('y', 'Pull-up', 'lats', 'bodyweight', 'bodyweight', 0)`);
    raw.exec(MIGRATIONS.find((x) => x.version === 4)!.sql);
    return {
      owned: JSON.parse(raw.get<{ e: string }>(`SELECT equipment_json AS e FROM settings`)!.e) as string[],
      seeded: raw.get<{ e: string }>(`SELECT equipment AS e FROM exercises WHERE id = 'x'`)!.e,
      custom: raw.get<{ e: string }>(`SELECT equipment AS e FROM exercises WHERE id = 'y'`)!.e,
    };
  };

  it('default "own everything" installs gain the bar; seeded bar exercises move, custom ones do not', () => {
    const r = upgrade(null);
    expect(r.owned).toContain('pull_up_bar');
    expect(r.seeded).toBe('pull_up_bar');
    expect(r.custom).toBe('bodyweight');
  });

  it('installs that picked their equipment keep their choice', () => {
    expect(upgrade('["dumbbell"]').owned).toEqual(['dumbbell']);
  });
});

describe('equipment + starter programs', () => {
  const equipmentOf = (ids: string[]) => ids.flatMap((id) => api.getRoutine(id).items.map((i) => i.exercise.equipment));

  it('defaults to owning everything; caps can be set and cleared', () => {
    expect(api.getSettings().owned_equipment).toContain('barbell');
    api.setEquipment(['dumbbell'], { dumbbell: lb(50), kettlebell: null });
    expect(api.getSettings().owned_equipment).toEqual(['dumbbell']);
    expect(asLb(api.getSettings().equipment_caps.dumbbell)).toBe(50);
    expect(asLb(ex('DB Curl').max_load_kg)).toBe(50);
    api.setEquipment(['dumbbell'], { dumbbell: null });
    expect(ex('DB Curl').max_load_kg).toBeNull();
  });

  it('no equipment → bodyweight-only program', () => {
    api.setEquipment([], {});
    const ids = api.createStarterProgram('equipment');
    expect(api.listRoutines().map((r) => r.name)).toEqual(['Bodyweight A', 'Bodyweight B', 'Bodyweight C']);
    expect(new Set(equipmentOf(ids))).toEqual(new Set(['bodyweight']));
    const a = api.getRoutine(ids[0]).items;
    expect(a.map((i) => i.exercise.name)).toContain('Push-up');
    expect(a.find((i) => i.exercise.name === 'Plank')).toMatchObject({ rep_min: 45, rep_max: 45 });
  });

  it('dumbbells only → dumbbell + bodyweight exercises', () => {
    api.setEquipment(['dumbbell'], {});
    const ids = api.createStarterProgram('equipment');
    const eq = new Set(equipmentOf(ids));
    expect([...eq].every((e) => e === 'dumbbell' || e === 'bodyweight')).toBe(true);
    expect(api.getRoutine(ids[0]).items[0].exercise.name).toBe('Goblet Squat');
    const b = api.getRoutine(ids[1]).items;
    expect(b.filter((i) => i.group_id).map((i) => i.exercise.name)).toEqual(['DB Curl', 'Overhead DB Triceps Extension']);
  });

  it('full gym → barbell compounds with warm-ups', () => {
    const ids = api.createStarterProgram('equipment');
    const first = api.getRoutine(ids[0]).items[0];
    expect(first.exercise.name).toBe('Barbell Back Squat');
    expect(first.warmup_sets).toBe(2);
    expect(api.listRoutines()[0].name).toBe('Full Body A');
  });

  it('pull-up bar: its exercises need it; the bodyweight program uses it when owned', () => {
    expect(ex('Pull-up').equipment).toBe('pull_up_bar');
    expect(api.getSettings().owned_equipment).toContain('pull_up_bar'); // default: everything
    api.setEquipment(['pull_up_bar'], {});
    const ids = api.createStarterProgram('bodyweight');
    const names = ids.flatMap((id) => api.getRoutine(id).items.map((i) => i.exercise.name));
    expect(names).toContain('Pull-up');
    expect(names).toContain('Hanging Knee Raise');
    expect(api.listRoutines()[0].name).toBe('Bodyweight A');
  });

  it('no bar → bar exercises swapped for floor/table alternatives', () => {
    api.setEquipment([], {});
    const names = api.createStarterProgram('bodyweight').flatMap((id) => api.getRoutine(id).items.map((i) => i.exercise.name));
    expect(names).not.toContain('Pull-up');
    expect(names).toContain('Feet-Elevated Inverted Row');
    expect(names).toContain('Side Plank');
  });

  it('bodyweight program ignores owned equipment', () => {
    const ids = api.createStarterProgram('bodyweight');
    expect(new Set(equipmentOf(ids))).toEqual(new Set(['bodyweight', 'pull_up_bar']));
  });

  it('library filters by several muscles and sorts', () => {
    const list = api.listExercises({ musclesIn: ['calves', 'forearms'], equipmentIn: ['dumbbell'] });
    expect(list.map((e) => e.name)).toEqual(['DB Calf Raise', 'DB Curl', 'DB Farmer Carry', 'DB Shrug', 'Hammer Curl', 'Single-Leg DB Calf Raise']);
    expect(api.listExercises({ musclesIn: ['calves', 'forearms'], equipmentIn: ['dumbbell'], sort: 'za' })[0].name).toBe('Single-Leg DB Calf Raise');
  });

  it('library filter by owned equipment', () => {
    const list = api.listExercises({ equipmentIn: ['bodyweight'] });
    expect(list.length).toBeGreaterThan(15);
    expect(list.every((e) => e.equipment === 'bodyweight')).toBe(true);
  });
});

describe('analytics', () => {
  it('week stats, strength lifts, volume, consistency', () => {
    const rid = api.saveRoutine({ name: 'Full', items: [{ exercise_id: ex('DB Bench Press').id }, { exercise_id: ex('Pull-up').id }] });
    for (let i = 0; i < 3; i++) {
      const wid = api.startWorkout({ routineId: rid });
      doSets(wid, 'DB Bench Press', [10, 10, 10], 40 + i * 5);
      doSets(wid, 'Pull-up', [8, 8, 8]);
      api.finishWorkout(wid);
    }
    const ws = api.weekStats();
    expect(ws.current.sessions).toBe(3);
    expect(ws.current.sets).toBe(18);
    const lifts = api.strengthLifts();
    expect(lifts.map((l) => l.name).sort()).toEqual(['DB Bench Press', 'Pull-up']);
    const s = api.strengthSeries(ex('DB Bench Press').id);
    expect(s.metric).toBe('e1rm');
    expect(s.points).toHaveLength(3);
    expect(api.strengthSeries(ex('Pull-up').id).metric).toBe('reps');
    const vol = api.volumeByMuscle(api.weekStats().trained_dates.length ? (api.weeklyTrend(1)[0].week) : '');
    expect(vol.find((v) => v.muscle === 'chest')?.sets).toBe(9);
    expect(vol.find((v) => v.muscle === 'biceps')?.sets).toBe(4.5);
    expect(api.muscleWeeks(4).weeks).toHaveLength(4);
    const c = api.consistency();
    expect(c.total_sessions).toBe(3);
    expect(c.current_streak).toBe(1);
    expect(api.exerciseHistory(ex('DB Bench Press').id)).toHaveLength(3);
    const d = api.exerciseDetail(ex('DB Bench Press').id);
    expect(asLb(d.bests.max_weight?.value)).toBe(50);
    expect(d.routines).toHaveLength(1);
    expect(api.listWorkouts()).toHaveLength(3);
  });
});

describe('body', () => {
  it('bodyweight + nutrition', () => {
    api.logBodyweight({ date: '2026-10-01', weight_kg: 80 });
    api.logBodyweight({ date: '2026-10-02', weight_kg: 79.5 });
    expect(api.latestBodyweightKg()).toBe(79.5);
    api.upsertNutrition('2026-10-02', { calories: 2400 });
    api.upsertNutrition('2026-10-02', { protein_g: 180 });
    expect(api.getNutrition('2026-10-02')).toMatchObject({ calories: 2400, protein_g: 180 });
  });
});

describe('sync bookkeeping', () => {
  it('pushes everything once, then only what changed; imports and resets behave', async () => {
    await new Promise((r) => setTimeout(r, 5)); // rows from the current millisecond wait for the next sync
    const first = api.changesSince();
    expect(first.count).toBe(1 + api.listExercises({ includeArchived: true }).length); // settings + seeded exercises
    expect(Object.keys(first.tables)).toEqual(['settings', 'exercises']);
    api.setSyncState({ user_id: 'u1', pushed_until: first.until });
    expect(api.pendingSyncCount()).toBe(0);
    await new Promise((r) => setTimeout(r, 5));
    api.logBodyweight({ date: '2026-10-01', weight_kg: 80 });
    api.saveExercise({ ...ex('Push-up'), notes: 'elbows in' });
    await new Promise((r) => setTimeout(r, 5));
    const next = api.changesSince();
    expect(next.count).toBe(2);
    expect(next.tables.body_weight).toHaveLength(1);
    expect(next.tables.exercises[0].notes).toBe('elbows in');
    expect(api.changesSince().count).toBe(2); // watermark only moves when the app confirms the push
    api.setSyncState({ pushed_until: next.until });
    api.importAll(JSON.parse(JSON.stringify(api.exportAll())), 'merge');
    expect(api.getSyncState().pushed_until).toBe('');
    api.resetApp();
    expect(api.getSyncState().user_id).toBeNull();
  });
});

describe('data portability', () => {
  it('export → reset → import(replace) restores everything', () => {
    const rid = api.saveRoutine({ name: 'Upper', items: [{ exercise_id: ex('DB Bench Press').id }] });
    const wid = api.startWorkout({ routineId: rid });
    doSets(wid, 'DB Bench Press', [10, 10, 10], 40);
    api.finishWorkout(wid);
    api.logBodyweight({ date: '2026-10-01', weight_kg: 80 });
    api.updateSettings({ onboarded: true, units: 'lb' });

    const file = JSON.parse(JSON.stringify(api.exportAll()));
    const before = api.dataStats();
    api.resetApp();
    expect(api.dataStats().workouts).toBe(0);
    expect(api.previewImport(file).counts.workouts).toBe(1);
    api.importAll(file, 'replace');
    expect(api.dataStats()).toEqual(before);
    expect(api.getRoutine(rid).items[0].state).not.toBeNull();
    expect(api.getSettings().onboarded).toBe(true);
  });

  it('merge is last-write-wins by updated_at', () => {
    const file = JSON.parse(JSON.stringify(api.exportAll()));
    const id = ex('Push-up').id;
    api.saveExercise({ ...ex('Push-up'), notes: 'local edit' });
    // older incoming row → local wins
    api.importAll(file, 'merge');
    expect(ex('Push-up').notes).toBe('local edit');
    // newer incoming row → incoming wins
    const row = file.tables.exercises.find((r: { id: string }) => r.id === id);
    row.notes = 'from file';
    row.updated_at = '2999-01-01T00:00:00.000Z';
    api.importAll(file, 'merge');
    expect(ex('Push-up').notes).toBe('from file');
  });

  it('rejects junk', () => {
    expect(() => api.importAll({ hello: 1 }, 'merge')).toThrow(/Not a Redline export/);
  });

  it('CSV export', () => {
    const rid = api.saveRoutine({ name: 'U', items: [{ exercise_id: ex('DB Bench Press').id }] });
    const wid = api.startWorkout({ routineId: rid });
    doSets(wid, 'DB Bench Press', [10, 10, 10], 40);
    api.finishWorkout(wid);
    const csv = api.exportSetsCsv().trim().split('\n');
    expect(csv[0]).toBe('date,workout,exercise,kind,weight_lb,reps,e1rm_lb,completed_at');
    expect(csv).toHaveLength(4);
    expect(csv[1]).toContain(',DB Bench Press,working,40,10,53.3,');
  });
});
