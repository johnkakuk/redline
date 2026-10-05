import { activeSeconds, estimateKcal, profileComplete, type Profile } from '../../engine/calories';
import { evaluate, initialState } from '../../engine/progression';
import { detectSetPrs } from '../../engine/prs';
import { approxEq } from '../../engine/rounding';
import { setTonnage } from '../../engine/volume';
import { warmupSets } from '../../engine/warmups';
import { ageFrom } from '../../shared/time';
import type {
  Exercise, PrHit, ProgressionChange, ProgressionKind, ProgressionState, RoutineItem, SetKind, Settings, Workout,
  WorkoutExerciseFull, WorkoutFull, WorkoutSet, WorkoutSummary,
} from '../../shared/types';
import type { Db, Row } from '../sqlite';
import { effective, getExerciseRow, getStateRow, newId, now, toItem, toSet, writeState } from './common';
import { rebuildPrs } from './analytics.repo';
import { latestBodyweightKg } from './body.repo';
import { getItem, getRoutineItems } from './routines.repo';
import { getSettings } from './settings.repo';

const SET_ORDER = `ORDER BY CASE kind WHEN 'warmup' THEN 0 ELSE 1 END, sort_order`;

function toWorkout(r: Row): Workout {
  return {
    id: r.id as string,
    routine_id: (r.routine_id as string | null) ?? null,
    name: r.name as string,
    started_at: r.started_at as string,
    ended_at: (r.ended_at as string | null) ?? null,
    active_duration_sec: (r.active_duration_sec as number | null) ?? null,
    bodyweight_kg: (r.bodyweight_kg as number | null) ?? null,
    kcal_estimate: (r.kcal_estimate as number | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    status: r.status as Workout['status'],
  };
}

function getWorkoutRow(db: Db, id: string): Workout {
  const r = db.get('SELECT * FROM workouts WHERE id = ?', [id]);
  if (!r) throw new Error('Workout not found');
  return toWorkout(r);
}

function insertSet(db: Db, weId: string, order: number, kind: SetKind, sw: number | null, sr: number | null) {
  const id = newId();
  db.run(
    'INSERT INTO sets (id, workout_exercise_id, sort_order, kind, suggested_weight_kg, suggested_reps) VALUES (?,?,?,?,?,?)',
    [id, weId, order, kind, sw, sr],
  );
  return id;
}

export function getActiveWorkoutId(db: Db): string | null {
  return db.get<{ id: string }>(`SELECT id FROM workouts WHERE status = 'active' AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1`)?.id ?? null;
}

/** Last completed top working set for an exercise, used to seed suggestions for ad-hoc exercises. */
function lastWorkingSets(db: Db, exerciseId: string, excludeWorkoutId: string | null) {
  const we = db.get<{ id: string }>(
    `SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
     WHERE we.exercise_id = ? AND w.status = 'completed' AND w.deleted_at IS NULL AND we.deleted_at IS NULL AND w.id != ?
     ORDER BY w.started_at DESC LIMIT 1`, [exerciseId, excludeWorkoutId ?? ''],
  );
  if (!we) return [];
  return db
    .all(`SELECT * FROM sets WHERE workout_exercise_id = ? AND deleted_at IS NULL AND completed_at IS NOT NULL ${SET_ORDER}`, [we.id])
    .map(toSet);
}

function addPlannedSets(db: Db, settings: Settings, weId: string, ex: Exercise, item: RoutineItem, state: ProgressionState | null) {
  const { increment } = effective(settings, ex, item);
  const weight = ex.load_type === 'bodyweight' ? null : state?.target_weight_kg ?? (ex.load_type === 'bodyweight_plus' ? 0 : null);
  let order = 0;
  if (item.warmup_sets > 0 && weight != null && weight > 0) {
    for (const w of warmupSets(weight, increment, item.warmup_sets)) insertSet(db, weId, order++, 'warmup', w.weight_kg, w.reps);
  }
  for (let i = 0; i < item.working_sets; i++) {
    const reps = state?.target_reps[i] ?? state?.target_reps.at(-1) ?? item.rep_min;
    insertSet(db, weId, order++, 'working', weight, reps);
  }
}

export function startWorkout(db: Db, opts: { routineId?: string | null } = {}): string {
  const active = getActiveWorkoutId(db);
  if (active) return active;
  return db.tx(() => {
    const settings = getSettings(db);
    const id = newId();
    const routine = opts.routineId
      ? db.get<{ id: string; name: string }>('SELECT id, name FROM routines WHERE id = ?', [opts.routineId])
      : undefined;
    db.run('INSERT INTO workouts (id, routine_id, name, started_at, bodyweight_kg, status) VALUES (?,?,?,?,?,?)', [
      id, routine?.id ?? null, routine?.name ?? 'Workout', now(), latestBodyweightKg(db), 'active',
    ]);
    if (routine) {
      getRoutineItems(db, routine.id).forEach((item, idx) => {
        const weId = newId();
        db.run(
          'INSERT INTO workout_exercises (id, workout_id, exercise_id, routine_item_id, sort_order, group_id) VALUES (?,?,?,?,?,?)',
          [weId, id, item.exercise_id, item.id, idx, item.group_id],
        );
        addPlannedSets(db, settings, weId, getExerciseRow(db, item.exercise_id), item, getStateRow(db, item.id));
      });
    }
    return id;
  });
}

export function getWorkout(db: Db, id: string): WorkoutFull {
  const w = getWorkoutRow(db, id);
  const settings = getSettings(db);
  const wes = db.all('SELECT * FROM workout_exercises WHERE workout_id = ? AND deleted_at IS NULL ORDER BY sort_order', [id]);
  const exercises: WorkoutExerciseFull[] = wes.map((r) => {
    const exercise = getExerciseRow(db, r.exercise_id as string);
    const itemRow = r.routine_item_id ? db.get('SELECT * FROM routine_items WHERE id = ?', [r.routine_item_id as string]) : undefined;
    const item = itemRow ? toItem(itemRow) : null;
    const eff = effective(settings, exercise, item);
    return {
      id: r.id as string,
      workout_id: id,
      exercise_id: exercise.id,
      routine_item_id: item?.id ?? null,
      sort_order: r.sort_order as number,
      group_id: (r.group_id as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      exercise,
      item,
      state: item ? getStateRow(db, item.id) : null,
      previous: lastWorkingSets(db, exercise.id, id).map((s) => ({ weight_kg: s.weight_kg, reps: s.reps, kind: s.kind })),
      sets: db.all(`SELECT * FROM sets WHERE workout_exercise_id = ? AND deleted_at IS NULL ${SET_ORDER}`, [r.id as string]).map(toSet),
      increment_kg: eff.increment,
      cap_kg: eff.cap,
      rest_sec: eff.rest,
    };
  });
  return { ...w, exercises };
}

export function getActiveWorkout(db: Db): WorkoutFull | null {
  const id = getActiveWorkoutId(db);
  return id ? getWorkout(db, id) : null;
}

function getSetRow(db: Db, setId: string): WorkoutSet {
  const r = db.get('SELECT * FROM sets WHERE id = ?', [setId]);
  if (!r) throw new Error('Set not found');
  return toSet(r);
}

export function updateSet(db: Db, setId: string, patch: { weight_kg?: number | null; reps?: number | null }) {
  const s = getSetRow(db, setId);
  const weight = patch.weight_kg !== undefined ? patch.weight_kg : s.weight_kg;
  const reps = patch.reps !== undefined ? patch.reps : s.reps;
  const overridden =
    (weight != null && (s.suggested_weight_kg == null || !approxEq(weight, s.suggested_weight_kg))) ||
    (reps != null && reps !== s.suggested_reps);
  db.run('UPDATE sets SET weight_kg = ?, reps = ?, overridden = ? WHERE id = ?', [weight, reps, overridden ? 1 : 0, setId]);
  // Carry an entered weight forward to later sets that have no suggestion yet (e.g. a first session).
  if (patch.weight_kg != null) {
    db.run(
      `UPDATE sets SET suggested_weight_kg = ? WHERE workout_exercise_id = ? AND kind = ? AND sort_order > ?
       AND weight_kg IS NULL AND suggested_weight_kg IS NULL AND completed_at IS NULL AND deleted_at IS NULL`,
      [patch.weight_kg, s.workout_exercise_id, s.kind, s.sort_order],
    );
  }
}

/** Complete a set (filling untouched values from the suggestion) and check for live PRs. */
export function completeSet(db: Db, setId: string, values?: { weight_kg?: number | null; reps?: number | null }): { prs: PrHit[] } {
  return db.tx(() => {
    if (values) updateSet(db, setId, values);
    const s = getSetRow(db, setId);
    const weight = s.weight_kg ?? s.suggested_weight_kg;
    const reps = s.reps ?? s.suggested_reps;
    if (reps == null || reps <= 0) throw new Error('Enter reps first');
    const we = db.get<{ exercise_id: string; workout_id: string }>('SELECT exercise_id, workout_id FROM workout_exercises WHERE id = ?', [s.workout_exercise_id])!;
    const ex = getExerciseRow(db, we.exercise_id);
    db.run('UPDATE sets SET weight_kg = ?, reps = ?, completed_at = ? WHERE id = ?', [
      ex.load_type === 'bodyweight' ? null : weight, reps, now(), setId,
    ]);
    if (s.kind !== 'working') return { prs: [] };
    const history = db.all<{ weight_kg: number | null; reps: number | null }>(
      `SELECT s.weight_kg, s.reps FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
       WHERE we.exercise_id = ? AND s.kind = 'working' AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL
         AND w.deleted_at IS NULL AND s.id != ? AND (w.status = 'completed' OR w.id = ?)`,
      [we.exercise_id, setId, we.workout_id],
    );
    // No badges during an exercise's first ever session.
    const priorSessions = db.get<{ n: number }>(
      `SELECT count(*) AS n FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
       WHERE we.exercise_id = ? AND w.status = 'completed' AND w.deleted_at IS NULL AND we.deleted_at IS NULL`, [we.exercise_id],
    )!.n;
    if (priorSessions === 0) return { prs: [] };
    return { prs: detectSetPrs({ weight_kg: ex.load_type === 'bodyweight' ? null : weight, reps }, history, ex.load_type) };
  });
}

export function uncompleteSet(db: Db, setId: string) {
  db.run('UPDATE sets SET completed_at = NULL WHERE id = ?', [setId]);
}

export function addSet(db: Db, weId: string, kind: SetKind = 'working'): string {
  return db.tx(() => {
    const sets = db.all(`SELECT * FROM sets WHERE workout_exercise_id = ? AND deleted_at IS NULL ${SET_ORDER}`, [weId]).map(toSet);
    const sameKind = sets.filter((s) => s.kind === kind);
    const last = sameKind.at(-1);
    const order = Math.max(-1, ...sets.map((s) => s.sort_order)) + 1;
    return insertSet(db, weId, order, kind, last?.weight_kg ?? last?.suggested_weight_kg ?? null, last?.reps ?? last?.suggested_reps ?? null);
  });
}

export function removeSet(db: Db, setId: string) {
  db.run('UPDATE sets SET deleted_at = ? WHERE id = ?', [now(), setId]);
}

/** "Add warm-ups": 50%×8, 70%×5, 85%×2 of the first working weight. Replaces unfinished warm-ups. */
export function addWarmups(db: Db, weId: string) {
  db.tx(() => {
    const sets = db.all(`SELECT * FROM sets WHERE workout_exercise_id = ? AND deleted_at IS NULL ${SET_ORDER}`, [weId]).map(toSet);
    const first = sets.find((s) => s.kind === 'working');
    const base = first ? first.weight_kg ?? first.suggested_weight_kg : null;
    if (!base) throw new Error('Set a working weight first');
    const we = db.get<{ exercise_id: string; routine_item_id: string | null }>('SELECT exercise_id, routine_item_id FROM workout_exercises WHERE id = ?', [weId])!;
    const ex = getExerciseRow(db, we.exercise_id);
    const item = we.routine_item_id ? getItem(db, we.routine_item_id) : null;
    const { increment } = effective(getSettings(db), ex, item);
    const ts = now();
    for (const s of sets) if (s.kind === 'warmup' && !s.completed_at) db.run('UPDATE sets SET deleted_at = ? WHERE id = ?', [ts, s.id]);
    const minOrder = Math.min(0, ...sets.map((s) => s.sort_order));
    warmupSets(base, increment).forEach((w, i) => insertSet(db, weId, minOrder - 3 + i, 'warmup', w.weight_kg, w.reps));
  });
}

export function addExercise(db: Db, workoutId: string, exerciseId: string, opts: { sets?: number; groupId?: string | null } = {}): string {
  return db.tx(() => {
    const max = db.get<{ m: number | null }>('SELECT max(sort_order) AS m FROM workout_exercises WHERE workout_id = ? AND deleted_at IS NULL', [workoutId])?.m ?? -1;
    const weId = newId();
    db.run('INSERT INTO workout_exercises (id, workout_id, exercise_id, sort_order, group_id) VALUES (?,?,?,?,?)', [
      weId, workoutId, exerciseId, max + 1, opts.groupId ?? null,
    ]);
    const ex = getExerciseRow(db, exerciseId);
    const last = lastWorkingSets(db, exerciseId, workoutId).filter((s) => s.kind === 'working');
    const top = last.reduce<WorkoutSet | null>((a, s) => (!a || (s.weight_kg ?? 0) > (a.weight_kg ?? 0) ? s : a), null);
    const n = opts.sets ?? Math.max(3, last.length || 3);
    for (let i = 0; i < n; i++) {
      insertSet(db, weId, i, 'working', ex.load_type === 'bodyweight' ? null : top?.weight_kg ?? null, last[i]?.reps ?? top?.reps ?? null);
    }
    return weId;
  });
}

/** Swap the exercise mid-session. Unlinks from the routine item so progression isn't applied to the wrong lift. */
export function swapExercise(db: Db, weId: string, exerciseId: string) {
  db.tx(() => {
    db.run('UPDATE workout_exercises SET exercise_id = ?, routine_item_id = NULL WHERE id = ?', [exerciseId, weId]);
    const ex = getExerciseRow(db, exerciseId);
    const last = lastWorkingSets(db, exerciseId, null).filter((s) => s.kind === 'working');
    const top = last[0];
    db.run(
      `UPDATE sets SET suggested_weight_kg = ?, weight_kg = NULL, overridden = 0 WHERE workout_exercise_id = ? AND completed_at IS NULL`,
      [ex.load_type === 'bodyweight' ? null : top?.weight_kg ?? null, weId],
    );
  });
}

export function removeWorkoutExercise(db: Db, weId: string) {
  db.run('UPDATE workout_exercises SET deleted_at = ? WHERE id = ?', [now(), weId]);
}

export function reorderWorkoutExercises(db: Db, ids: string[]) {
  db.tx(() => ids.forEach((id, i) => db.run('UPDATE workout_exercises SET sort_order = ? WHERE id = ?', [i, id])));
}

export function setWorkoutExerciseNotes(db: Db, weId: string, notes: string) {
  db.run('UPDATE workout_exercises SET notes = ? WHERE id = ?', [notes.trim() || null, weId]);
}

export function updateWorkoutMeta(db: Db, id: string, patch: { name?: string; notes?: string | null }) {
  if (patch.name !== undefined) db.run('UPDATE workouts SET name = ? WHERE id = ?', [patch.name.trim() || 'Workout', id]);
  if (patch.notes !== undefined) db.run('UPDATE workouts SET notes = ? WHERE id = ?', [patch.notes?.trim() || null, id]);
}

export function discardWorkout(db: Db, id: string) {
  db.run(`UPDATE workouts SET status = 'discarded', ended_at = ? WHERE id = ?`, [now(), id]);
}

export function profileOf(s: Settings): Profile {
  return { sex: s.sex, heightCm: s.height_cm, ageYears: s.birth_date ? ageFrom(s.birth_date) : null };
}

export function finishWorkout(db: Db, id: string): WorkoutSummary {
  db.tx(() => {
    const w = getWorkoutRow(db, id);
    if (w.status !== 'active') throw new Error('Workout is not active');
    const settings = getSettings(db);
    const ts = now();
    const done = db.get<{ n: number }>(
      `SELECT count(*) AS n FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ? AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL`, [id],
    )!.n;
    if (done === 0) throw new Error('No sets completed');

    // Unfinished sets and empty exercises don't belong in history.
    db.run(
      `UPDATE sets SET deleted_at = ? WHERE completed_at IS NULL AND deleted_at IS NULL
       AND workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)`, [ts, id],
    );
    db.run(
      `UPDATE workout_exercises SET deleted_at = ? WHERE workout_id = ? AND deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM sets s WHERE s.workout_exercise_id = workout_exercises.id AND s.deleted_at IS NULL)`, [ts, id],
    );

    const completions = db.all<{ completed_at: string }>(
      `SELECT s.completed_at FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ? AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL`, [id],
    ).map((r) => Date.parse(r.completed_at));
    const endMs = Math.max(Date.now(), ...completions);
    const activeSec = activeSeconds(Date.parse(w.started_at), endMs, completions);
    const bw = w.bodyweight_kg ?? latestBodyweightKg(db);
    const kcal = bw ? estimateKcal(settings.calorie_intensity, bw, activeSec, profileOf(settings)) : null;
    db.run(
      `UPDATE workouts SET status = 'completed', ended_at = ?, active_duration_sec = ?, bodyweight_kg = ?, kcal_estimate = ? WHERE id = ?`,
      [new Date(endMs).toISOString(), activeSec, bw, kcal, id],
    );

    const full = getWorkout(db, id);
    const seen = new Set<string>();
    for (const we of full.exercises) {
      if (!we.item || seen.has(we.item.id)) continue;
      seen.add(we.item.id);
      const item = we.item;
      const members = full.exercises.filter((x) => x.item?.id === item.id);
      const sets = members.flatMap((m) => m.sets).filter((s) => s.kind === 'working');
      const before = getStateRow(db, item.id);
      const out = evaluate({
        mode: item.progression_mode,
        loadType: we.exercise.load_type,
        workingSets: item.working_sets,
        repMin: item.rep_min,
        repMax: item.rep_max,
        incrementKg: we.increment_kg,
        capKg: we.cap_kg,
        hasHarderVariation: !!we.exercise.harder_variation_id,
        state: before,
        sets: sets.map((s) => ({ weight_kg: s.weight_kg, reps: s.reps, completed: !!s.completed_at })),
        units: settings.units,
      });
      const after: ProgressionState = { ...out.state, routine_item_id: item.id, last_evaluated_workout_id: id };
      writeState(db, after);
      db.run(
        `INSERT INTO progression_history (id, routine_item_id, workout_id, kind, reason, before_json, after_json) VALUES (?,?,?,?,?,?,?)`,
        [newId(), item.id, id, out.kind, out.reason, before ? JSON.stringify(before) : null, JSON.stringify(after)],
      );
    }
    rebuildPrs(db, [...new Set(full.exercises.map((e) => e.exercise_id))]);
  });
  return getSummary(db, id);
}

export function getSummary(db: Db, id: string): WorkoutSummary {
  const workout = getWorkoutRow(db, id);
  const settings = getSettings(db);
  const sets = db.all<{ weight_kg: number | null; reps: number | null; load_type: Exercise['load_type'] }>(
    `SELECT s.weight_kg, s.reps, e.load_type FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
     JOIN exercises e ON e.id = we.exercise_id
     WHERE we.workout_id = ? AND s.kind = 'working' AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL`, [id],
  );
  const prRows = db.all<{ exercise_id: string; exercise_name: string; type: PrHit['type']; value: number; weight_kg: number | null; reps: number | null }>(
    `SELECT p.exercise_id, e.name AS exercise_name, p.type, max(p.value) AS value, p.weight_kg, p.reps
     FROM personal_records p JOIN exercises e ON e.id = p.exercise_id
     WHERE p.workout_id = ? AND p.baseline = 0 AND p.deleted_at IS NULL
     GROUP BY p.exercise_id, p.type ORDER BY e.name`, [id],
  );
  const hist = db.all<{ routine_item_id: string; kind: ProgressionKind; reason: string; before_json: string | null; after_json: string; undone: number }>(
    `SELECT h.routine_item_id, h.kind, h.reason, h.before_json, h.after_json, h.undone FROM progression_history h
     JOIN routine_items i ON i.id = h.routine_item_id WHERE h.workout_id = ? AND h.deleted_at IS NULL ORDER BY i.sort_order`, [id],
  );
  const changes: ProgressionChange[] = hist.map((h) => {
    const item = getItem(db, h.routine_item_id);
    const ex = getExerciseRow(db, item.exercise_id);
    const current = getStateRow(db, item.id);
    const harder = ex.harder_variation_id ? db.get<{ id: string; name: string }>('SELECT id, name FROM exercises WHERE id = ?', [ex.harder_variation_id]) ?? null : null;
    const isLatest = current?.last_evaluated_workout_id === id;
    return {
      routine_item_id: item.id,
      exercise_id: ex.id,
      exercise_name: ex.name,
      kind: h.kind,
      reason: h.reason,
      before: h.before_json ? JSON.parse(h.before_json) : null,
      after: JSON.parse(h.after_json),
      harder_variation: harder,
      pending: isLatest && current?.status === 'deload_suggested' ? 'deload' : isLatest && current?.status === 'variation_suggested' && harder ? 'variation' : null,
      pending_weight_kg: isLatest ? current?.prompt_weight_kg ?? null : null,
      undone: h.undone === 1,
    };
  });
  const added = workout.routine_id
    ? db.all<{ id: string; name: string }>(
        `SELECT we.id, e.name FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id
         WHERE we.workout_id = ? AND we.routine_item_id IS NULL AND we.deleted_at IS NULL ORDER BY we.sort_order`, [id],
      )
    : [];
  return {
    workout,
    working_sets: sets.length,
    tonnage_kg: sets.reduce((a, s) => a + setTonnage(s.weight_kg, s.reps, s.load_type), 0),
    prs: prRows.map(({ exercise_id: _e, ...p }) => p),
    changes,
    added_exercises: added,
    calorie_profile_complete: profileComplete(profileOf(settings)),
  };
}

/** Revert this session's progression changes. */
export function undoProgression(db: Db, workoutId: string) {
  db.tx(() => {
    const rows = db.all<{ id: string; routine_item_id: string; before_json: string | null }>(
      'SELECT id, routine_item_id, before_json FROM progression_history WHERE workout_id = ? AND undone = 0 AND deleted_at IS NULL', [workoutId],
    );
    for (const r of rows) {
      if (r.before_json) writeState(db, JSON.parse(r.before_json));
      else db.run('UPDATE progression_state SET deleted_at = ? WHERE routine_item_id = ?', [now(), r.routine_item_id]);
      db.run('UPDATE progression_history SET undone = 1 WHERE id = ?', [r.id]);
    }
  });
}

/** Append exercises added mid-session to the routine, with the session's weight as the starting target. */
export function updateRoutineFromWorkout(db: Db, workoutId: string): number {
  return db.tx(() => {
    const w = getWorkout(db, workoutId);
    if (!w.routine_id) return 0;
    let order = (db.get<{ m: number | null }>('SELECT max(sort_order) AS m FROM routine_items WHERE routine_id = ? AND deleted_at IS NULL', [w.routine_id])?.m ?? -1) + 1;
    let n = 0;
    for (const we of w.exercises) {
      if (we.routine_item_id) continue;
      const working = we.sets.filter((s) => s.kind === 'working' && s.completed_at);
      if (!working.length) continue;
      const reps = working.map((s) => s.reps ?? 0);
      const repMin = Math.max(1, Math.min(...reps));
      const repMax = Math.max(repMin + 2, ...reps);
      const itemId = newId();
      db.run(
        `INSERT INTO routine_items (id, routine_id, exercise_id, sort_order, working_sets, rep_min, rep_max) VALUES (?,?,?,?,?,?,?)`,
        [itemId, w.routine_id, we.exercise_id, order++, working.length, repMin, repMax],
      );
      db.run('UPDATE workout_exercises SET routine_item_id = ? WHERE id = ?', [itemId, we.id]);
      const used = we.exercise.load_type === 'bodyweight' ? null : Math.min(...working.map((s) => s.weight_kg ?? 0));
      writeState(db, {
        ...initialState(repMin, working.length),
        routine_item_id: itemId,
        target_weight_kg: used,
        target_reps: working.map((s) => Math.min((s.reps ?? repMin) + 1, repMax)),
        status: 'holding',
        last_evaluated_workout_id: workoutId,
      });
      n++;
    }
    return n;
  });
}

export interface WorkoutListRow {
  id: string; name: string; started_at: string; active_duration_sec: number | null; sets: number; tonnage_kg: number;
  kcal_estimate: number | null; exercises: string;
}

/** Completed workouts that started in [fromIso, toIso). The UI passes local-day bounds. */
export function workoutsBetween(db: Db, fromIso: string, toIso: string): { id: string; name: string; started_at: string }[] {
  return db.all(
    `SELECT id, name, started_at FROM workouts
     WHERE status = 'completed' AND deleted_at IS NULL AND started_at >= ? AND started_at < ? ORDER BY started_at`,
    [fromIso, toIso],
  );
}

export function listWorkouts(db: Db, opts: { limit?: number; exerciseId?: string } = {}): WorkoutListRow[] {
  return db.all<WorkoutListRow>(
    `SELECT w.id, w.name, w.started_at, w.active_duration_sec, w.kcal_estimate,
       (SELECT count(*) FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
         WHERE we.workout_id = w.id AND s.kind = 'working' AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL) AS sets,
       (SELECT coalesce(sum(s.weight_kg * s.reps * CASE e.load_type WHEN 'per_hand' THEN 2 ELSE 1 END), 0)
         FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN exercises e ON e.id = we.exercise_id
         WHERE we.workout_id = w.id AND s.kind = 'working' AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL) AS tonnage_kg,
       (SELECT group_concat(name, ' · ') FROM (SELECT e.name FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id
         WHERE we.workout_id = w.id AND we.deleted_at IS NULL ORDER BY we.sort_order)) AS exercises
     FROM workouts w WHERE w.status = 'completed' AND w.deleted_at IS NULL
     ${opts.exerciseId ? 'AND EXISTS (SELECT 1 FROM workout_exercises we WHERE we.workout_id = w.id AND we.exercise_id = ? AND we.deleted_at IS NULL)' : ''}
     ORDER BY w.started_at DESC LIMIT ?`,
    opts.exerciseId ? [opts.exerciseId, opts.limit ?? 50] : [opts.limit ?? 50],
  );
}

export function deleteWorkout(db: Db, id: string) {
  db.tx(() => {
    const exIds = db.all<{ exercise_id: string }>('SELECT DISTINCT exercise_id FROM workout_exercises WHERE workout_id = ?', [id]).map((r) => r.exercise_id);
    db.run('UPDATE workouts SET deleted_at = ? WHERE id = ?', [now(), id]);
    rebuildPrs(db, exIds);
  });
}

