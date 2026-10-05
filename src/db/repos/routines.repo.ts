import { acceptDeload, dismissDeload, dismissVariation, initialState } from '../../engine/progression';
import type { ProgressionState, RoutineFull, RoutineItem, RoutineItemFull, RoutineSummary } from '../../shared/types';
import type { Db } from '../sqlite';
import { getExerciseRow, getStateRow, newId, toItem, writeState } from './common';

export type RoutineItemInput = Partial<Omit<RoutineItem, 'routine_id' | 'sort_order'>> & { exercise_id: string };

export interface RoutineInput {
  id?: string;
  name: string;
  notes?: string | null;
  items: RoutineItemInput[];
}

export function listRoutines(db: Db, includeArchived = false): RoutineSummary[] {
  return db.all<Omit<RoutineSummary, 'archived'> & { archived: number }>(
    `SELECT r.id, r.name, r.notes, r.sort_order, r.archived,
       (SELECT count(*) FROM routine_items i WHERE i.routine_id = r.id AND i.deleted_at IS NULL) AS exercise_count,
       (SELECT coalesce(sum(i.working_sets), 0) FROM routine_items i WHERE i.routine_id = r.id AND i.deleted_at IS NULL) AS set_count,
       (SELECT max(w.started_at) FROM workouts w WHERE w.routine_id = r.id AND w.status = 'completed' AND w.deleted_at IS NULL) AS last_done_at
     FROM routines r WHERE r.deleted_at IS NULL ${includeArchived ? '' : 'AND r.archived = 0'}
     ORDER BY r.archived, r.sort_order, r.created_at`,
  ).map((r) => ({ ...r, archived: Boolean(r.archived) }));
}

export function getRoutineItems(db: Db, routineId: string): RoutineItem[] {
  return db
    .all('SELECT * FROM routine_items WHERE routine_id = ? AND deleted_at IS NULL ORDER BY sort_order', [routineId])
    .map(toItem);
}

export function getItem(db: Db, itemId: string): RoutineItem {
  const r = db.get('SELECT * FROM routine_items WHERE id = ?', [itemId]);
  if (!r) throw new Error(`Routine item ${itemId} not found`);
  return toItem(r);
}

export function fullItem(db: Db, item: RoutineItem): RoutineItemFull {
  const exercise = getExerciseRow(db, item.exercise_id);
  const harder = exercise.harder_variation_id
    ? db.get<{ id: string; name: string }>('SELECT id, name FROM exercises WHERE id = ?', [exercise.harder_variation_id]) ?? null
    : null;
  return { ...item, exercise, state: getStateRow(db, item.id), harder_variation: harder };
}

export function getRoutine(db: Db, id: string): RoutineFull {
  const r = db.get<{ id: string; name: string; notes: string | null; sort_order: number; archived: number }>(
    'SELECT id, name, notes, sort_order, archived FROM routines WHERE id = ?', [id],
  );
  if (!r) throw new Error('Routine not found');
  return { ...r, archived: Boolean(r.archived), items: getRoutineItems(db, id).map((i) => fullItem(db, i)) };
}

function clampItem(i: RoutineItemInput) {
  const working_sets = Math.max(1, Math.min(20, Math.round(i.working_sets ?? 3)));
  // One rep target per exercise, stored in both columns. A range (e.g. from an older routine) keeps its top.
  const rep_max = Math.max(1, Math.round(i.rep_max ?? i.rep_min ?? 10));
  const rep_min = rep_max;
  return {
    working_sets, rep_min, rep_max,
    warmup_sets: Math.max(0, Math.min(3, Math.round(i.warmup_sets ?? 0))),
    rest_sec: i.rest_sec ?? null,
    progression_mode: i.progression_mode ?? 'double',
    increment_kg: i.increment_kg ?? null,
    max_load_kg: i.max_load_kg ?? null,
    notes: i.notes?.trim() || null,
    group_id: i.group_id ?? null,
  };
}

/** Save a routine and its full item list. Items missing from the input are soft-deleted. */
export function saveRoutine(db: Db, input: RoutineInput): string {
  const name = input.name.trim() || 'Untitled routine';
  return db.tx(() => {
    let id = input.id;
    if (id) {
      db.run('UPDATE routines SET name = ?, notes = ? WHERE id = ?', [name, input.notes?.trim() || null, id]);
    } else {
      id = newId();
      const max = db.get<{ m: number | null }>('SELECT max(sort_order) AS m FROM routines')?.m ?? -1;
      db.run('INSERT INTO routines (id, name, notes, sort_order) VALUES (?, ?, ?, ?)', [id, name, input.notes?.trim() || null, max + 1]);
    }
    const existing = new Map(getRoutineItems(db, id).map((i) => [i.id, i]));
    const keep = new Set<string>();
    input.items.forEach((raw, idx) => {
      const c = clampItem(raw);
      const prev = raw.id ? existing.get(raw.id) : undefined;
      if (prev) {
        keep.add(prev.id);
        db.run(
          `UPDATE routine_items SET exercise_id=?, sort_order=?, group_id=?, working_sets=?, rep_min=?, rep_max=?, warmup_sets=?,
            rest_sec=?, progression_mode=?, increment_kg=?, max_load_kg=?, notes=? WHERE id=?`,
          [raw.exercise_id, idx, c.group_id, c.working_sets, c.rep_min, c.rep_max, c.warmup_sets, c.rest_sec,
            c.progression_mode, c.increment_kg, c.max_load_kg, c.notes, prev.id],
        );
        if (prev.exercise_id !== raw.exercise_id) {
          // Different exercise: its history doesn't apply. Start fresh.
          db.run('UPDATE progression_state SET deleted_at = ? WHERE routine_item_id = ?', [new Date().toISOString(), prev.id]);
        } else if (prev.working_sets !== c.working_sets) {
          const st = getStateRow(db, prev.id);
          if (st) writeState(db, { ...st, target_reps: resize(st.target_reps, c.working_sets, c.rep_max) });
        }
      } else {
        const itemId = raw.id && !existing.has(raw.id) && !db.get('SELECT 1 FROM routine_items WHERE id = ?', [raw.id]) ? raw.id : newId();
        keep.add(itemId);
        db.run(
          `INSERT INTO routine_items (id, routine_id, exercise_id, sort_order, group_id, working_sets, rep_min, rep_max, warmup_sets,
            rest_sec, progression_mode, increment_kg, max_load_kg, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [itemId, id, raw.exercise_id, idx, c.group_id, c.working_sets, c.rep_min, c.rep_max, c.warmup_sets, c.rest_sec,
            c.progression_mode, c.increment_kg, c.max_load_kg, c.notes],
        );
      }
    });
    const ts = new Date().toISOString();
    for (const old of existing.keys()) {
      if (!keep.has(old)) db.run('UPDATE routine_items SET deleted_at = ? WHERE id = ?', [ts, old]);
    }
    normalizeGroups(db, id);
    return id;
  });
}

const resize = (reps: number[], n: number, repMin: number) =>
  Array.from({ length: n }, (_, i) => reps[i] ?? reps[reps.length - 1] ?? repMin);

/** A superset needs 2+ adjacent members; drop singleton groups. */
function normalizeGroups(db: Db, routineId: string) {
  const items = getRoutineItems(db, routineId);
  const counts = new Map<string, number>();
  for (const i of items) if (i.group_id) counts.set(i.group_id, (counts.get(i.group_id) ?? 0) + 1);
  for (const i of items) {
    if (i.group_id && (counts.get(i.group_id) ?? 0) < 2) db.run('UPDATE routine_items SET group_id = NULL WHERE id = ?', [i.id]);
  }
}

export function reorderRoutines(db: Db, ids: string[]) {
  db.tx(() => ids.forEach((id, i) => db.run('UPDATE routines SET sort_order = ? WHERE id = ?', [i, id])));
}

export function archiveRoutine(db: Db, id: string, archived: boolean) {
  db.run('UPDATE routines SET archived = ? WHERE id = ?', [archived ? 1 : 0, id]);
}

export function deleteRoutine(db: Db, id: string) {
  db.run('UPDATE routines SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), id]);
}

export function duplicateRoutine(db: Db, id: string): string {
  const r = getRoutine(db, id);
  const groupMap = new Map<string, string>();
  return saveRoutine(db, {
    name: `${r.name} (copy)`,
    notes: r.notes,
    items: r.items.map(({ id: _id, exercise: _e, state: _s, harder_variation: _h, routine_id: _r, sort_order: _o, ...rest }) => ({
      ...rest,
      group_id: rest.group_id ? groupMap.get(rest.group_id) ?? groupMap.set(rest.group_id, newId()).get(rest.group_id)! : null,
    })),
  });
}

/** Rotate through routines in order after the last completed one. */
export function nextRoutine(db: Db): RoutineSummary | null {
  const routines = listRoutines(db);
  if (!routines.length) return null;
  const last = db.get<{ routine_id: string }>(
    `SELECT routine_id FROM workouts WHERE status = 'completed' AND routine_id IS NOT NULL AND deleted_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  );
  const idx = last ? routines.findIndex((r) => r.id === last.routine_id) : -1;
  return routines[(idx + 1) % routines.length];
}

// ── Manual overrides ──

function stateOrInitial(db: Db, itemId: string): ProgressionState {
  const st = getStateRow(db, itemId);
  if (st) return st;
  const item = getItem(db, itemId);
  return { ...initialState(item.rep_max, item.working_sets), routine_item_id: itemId, last_evaluated_workout_id: null };
}

export function setPinned(db: Db, itemId: string, pinned: boolean) {
  writeState(db, { ...stateOrInitial(db, itemId), pinned });
}

/** "Set next target" from the exercise sheet. */
export function setTarget(db: Db, itemId: string, weightKg: number | null, reps: number[] | null) {
  const st = stateOrInitial(db, itemId);
  const item = getItem(db, itemId);
  writeState(db, {
    ...st,
    target_weight_kg: weightKg,
    target_reps: reps ? resize(reps, item.working_sets, item.rep_max) : st.target_reps,
    status: 'holding',
    prompt_weight_kg: null,
    fail_streak: 0,
  });
}

export function respondDeload(db: Db, itemId: string, accept: boolean) {
  const st = stateOrInitial(db, itemId);
  writeState(db, { ...st, ...(accept ? acceptDeload(st) : dismissDeload(st)) });
}

/**
 * Accept: swap the routine item to the harder variation, keeping sets and rep range. The new starting weight
 * is the last logged weight for that exercise, else empty for the user to fill.
 * Dismiss: hold at cap and ask again after 2 more capped sessions.
 */
export function respondVariation(db: Db, itemId: string, accept: boolean) {
  db.tx(() => {
    const st = stateOrInitial(db, itemId);
    if (!accept) { writeState(db, { ...st, ...dismissVariation(st) }); return; }
    const item = getItem(db, itemId);
    const ex = getExerciseRow(db, item.exercise_id);
    if (!ex.harder_variation_id) throw new Error('No harder variation linked');
    const last = db.get<{ weight_kg: number | null }>(
      `SELECT s.weight_kg FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       WHERE we.exercise_id = ? AND s.kind = 'working' AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL
         AND we.deleted_at IS NULL AND w.status = 'completed'
       ORDER BY s.completed_at DESC LIMIT 1`, [ex.harder_variation_id],
    );
    db.run('UPDATE routine_items SET exercise_id = ? WHERE id = ?', [ex.harder_variation_id, itemId]);
    writeState(db, {
      ...initialState(item.rep_max, item.working_sets),
      routine_item_id: itemId,
      target_weight_kg: last?.weight_kg ?? null,
      last_evaluated_workout_id: st.last_evaluated_workout_id,
    });
  });
}
