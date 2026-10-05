import { ulid } from 'ulid';
import type {
  Equipment, Exercise, ProgressionState, RoutineItem, Settings, WorkoutSet,
} from '../../shared/types';
import type { Db, Row } from '../sqlite';

export const newId = () => ulid();
export const now = () => new Date().toISOString();

const bool = (v: unknown) => v === 1 || v === true;
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string' || !v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};

export function toExercise(r: Row): Exercise {
  return {
    id: r.id as string,
    name: r.name as string,
    primary_muscle: r.primary_muscle as Exercise['primary_muscle'],
    secondary_muscles: json(r.secondary_muscles, []),
    equipment: r.equipment as Equipment,
    load_type: r.load_type as Exercise['load_type'],
    default_increment_kg: (r.default_increment_kg as number | null) ?? null,
    max_load_kg: (r.max_load_kg as number | null) ?? null,
    harder_variation_id: (r.harder_variation_id as string | null) ?? null,
    easier_variation_id: (r.easier_variation_id as string | null) ?? null,
    default_rest_sec: (r.default_rest_sec as number | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    is_seeded: bool(r.is_seeded),
    archived: bool(r.archived),
    updated_at: r.updated_at as string,
  };
}

export function toItem(r: Row): RoutineItem {
  return {
    id: r.id as string,
    routine_id: r.routine_id as string,
    exercise_id: r.exercise_id as string,
    sort_order: r.sort_order as number,
    group_id: (r.group_id as string | null) ?? null,
    working_sets: r.working_sets as number,
    rep_min: r.rep_min as number,
    rep_max: r.rep_max as number,
    warmup_sets: r.warmup_sets as number,
    rest_sec: (r.rest_sec as number | null) ?? null,
    progression_mode: r.progression_mode as RoutineItem['progression_mode'],
    increment_kg: (r.increment_kg as number | null) ?? null,
    max_load_kg: (r.max_load_kg as number | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  };
}

export function toState(r: Row): ProgressionState {
  return {
    routine_item_id: r.routine_item_id as string,
    target_weight_kg: (r.target_weight_kg as number | null) ?? null,
    target_reps: json(r.target_reps_json, []),
    status: r.status as ProgressionState['status'],
    fail_streak: r.fail_streak as number,
    pinned: bool(r.pinned),
    prompt_weight_kg: (r.prompt_weight_kg as number | null) ?? null,
    snooze: r.snooze as number,
    last_evaluated_workout_id: (r.last_evaluated_workout_id as string | null) ?? null,
  };
}

export function toSet(r: Row): WorkoutSet {
  return {
    id: r.id as string,
    workout_exercise_id: r.workout_exercise_id as string,
    sort_order: r.sort_order as number,
    kind: r.kind as WorkoutSet['kind'],
    weight_kg: (r.weight_kg as number | null) ?? null,
    reps: (r.reps as number | null) ?? null,
    suggested_weight_kg: (r.suggested_weight_kg as number | null) ?? null,
    suggested_reps: (r.suggested_reps as number | null) ?? null,
    overridden: bool(r.overridden),
    completed_at: (r.completed_at as string | null) ?? null,
  };
}

export function getExerciseRow(db: Db, id: string): Exercise {
  const r = db.get('SELECT * FROM exercises WHERE id = ?', [id]);
  if (!r) throw new Error(`Exercise ${id} not found`);
  return toExercise(r);
}

export function getStateRow(db: Db, itemId: string): ProgressionState | null {
  const r = db.get('SELECT * FROM progression_state WHERE routine_item_id = ? AND deleted_at IS NULL', [itemId]);
  return r ? toState(r) : null;
}

export function writeState(db: Db, s: ProgressionState) {
  const existing = db.get<{ id: string }>('SELECT id FROM progression_state WHERE routine_item_id = ?', [s.routine_item_id]);
  const vals = [
    s.target_weight_kg, JSON.stringify(s.target_reps), s.status, s.fail_streak, s.pinned ? 1 : 0,
    s.prompt_weight_kg, s.snooze, s.last_evaluated_workout_id,
  ];
  if (existing) {
    db.run(
      `UPDATE progression_state SET target_weight_kg=?, target_reps_json=?, status=?, fail_streak=?, pinned=?,
        prompt_weight_kg=?, snooze=?, last_evaluated_workout_id=?, deleted_at=NULL WHERE id=?`,
      [...vals, existing.id],
    );
  } else {
    db.run(
      `INSERT INTO progression_state (target_weight_kg, target_reps_json, status, fail_streak, pinned,
        prompt_weight_kg, snooze, last_evaluated_workout_id, id, routine_item_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [...vals, newId(), s.routine_item_id],
    );
  }
}

/** Effective increment / cap / rest for an exercise in a routine item context. */
export function effective(settings: Settings, ex: Exercise, item: RoutineItem | null) {
  const increment = item?.increment_kg ?? ex.default_increment_kg ?? settings.default_increment[ex.equipment] ?? 2.5;
  const cap = ex.load_type === 'bodyweight' ? null : item?.max_load_kg ?? ex.max_load_kg ?? null;
  const rest = item?.rest_sec ?? ex.default_rest_sec ?? settings.default_rest_sec;
  return { increment, cap, rest };
}
