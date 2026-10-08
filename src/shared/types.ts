// Domain types. Persisted entities use snake_case to match SQLite columns, the export format and the draft schema.

export const MUSCLES = [
  'chest', 'upper_back', 'lats', 'traps', 'front_delts', 'side_delts', 'rear_delts',
  'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'lower_back',
  'glutes', 'quads', 'hamstrings', 'adductors', 'calves',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const EQUIPMENT = ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'pull_up_bar', 'bodyweight', 'band', 'other'] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const LOAD_TYPES = ['total', 'per_hand', 'bodyweight', 'bodyweight_plus'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

export type Units = 'lb' | 'kg';
export type Sex = 'male' | 'female';
export type Intensity = 'light' | 'moderate' | 'vigorous';
export type ProgressionMode = 'double' | 'none';
export type ProgressionStatus = 'progressing' | 'holding' | 'capped' | 'deload_suggested' | 'variation_suggested';
export type SetKind = 'warmup' | 'working';
export type WorkoutStatus = 'active' | 'completed' | 'discarded';
export type PrType = 'max_weight' | 'best_e1rm' | 'reps_at_weight' | 'session_volume';

export interface Settings {
  units: Units;
  sex: Sex | null;
  birth_date: string | null;
  height_cm: number | null;
  default_rest_sec: number;
  calorie_intensity: Intensity;
  protein_target_g: number | null;
  calorie_target: number | null;
  weekly_target: number;
  default_increment: Record<Equipment, number>;
  onboarded: boolean;
  last_export_at: string | null;
  /** Equipment the user has. Bodyweight is always implied. */
  owned_equipment: Equipment[];
  /** Heaviest available load per equipment type (kg). */
  equipment_caps: Partial<Record<Equipment, number>>;
}

export interface Exercise {
  id: string;
  name: string;
  primary_muscle: Muscle;
  secondary_muscles: Muscle[];
  equipment: Equipment;
  load_type: LoadType;
  default_increment_kg: number | null;
  max_load_kg: number | null;
  harder_variation_id: string | null;
  easier_variation_id: string | null;
  default_rest_sec: number | null;
  notes: string | null;
  is_seeded: boolean;
  archived: boolean;
  updated_at: string;
}

export type ExerciseInput = Omit<Exercise, 'id' | 'is_seeded' | 'archived' | 'updated_at'> & { id?: string };

export interface Routine {
  id: string;
  name: string;
  notes: string | null;
  sort_order: number;
  archived: boolean;
}

export interface RoutineItem {
  id: string;
  routine_id: string;
  exercise_id: string;
  sort_order: number;
  group_id: string | null;
  working_sets: number;
  rep_min: number;
  rep_max: number;
  warmup_sets: number;
  rest_sec: number | null;
  progression_mode: ProgressionMode;
  increment_kg: number | null;
  max_load_kg: number | null;
  notes: string | null;
}

export interface ProgressionState {
  routine_item_id: string;
  target_weight_kg: number | null;
  target_reps: number[];
  status: ProgressionStatus;
  fail_streak: number;
  pinned: boolean;
  /** Weight offered by a pending deload prompt. */
  prompt_weight_kg: number | null;
  /** Capped sessions left before re-offering a dismissed variation swap. */
  snooze: number;
  last_evaluated_workout_id: string | null;
}

export interface RoutineItemFull extends RoutineItem {
  exercise: Exercise;
  state: ProgressionState | null;
  harder_variation: Pick<Exercise, 'id' | 'name'> | null;
}

export interface RoutineFull extends Routine {
  items: RoutineItemFull[];
}

export interface RoutineSummary extends Routine {
  exercise_count: number;
  set_count: number;
  last_done_at: string | null;
}

export interface Workout {
  id: string;
  routine_id: string | null;
  name: string;
  started_at: string;
  ended_at: string | null;
  active_duration_sec: number | null;
  bodyweight_kg: number | null;
  kcal_estimate: number | null;
  notes: string | null;
  status: WorkoutStatus;
}

export interface WorkoutSet {
  id: string;
  workout_exercise_id: string;
  sort_order: number;
  kind: SetKind;
  weight_kg: number | null;
  reps: number | null;
  suggested_weight_kg: number | null;
  suggested_reps: number | null;
  overridden: boolean;
  completed_at: string | null;
}

export interface WorkoutExerciseFull {
  id: string;
  workout_id: string;
  exercise_id: string;
  routine_item_id: string | null;
  sort_order: number;
  group_id: string | null;
  notes: string | null;
  exercise: Exercise;
  item: RoutineItem | null;
  state: ProgressionState | null;
  previous: { weight_kg: number | null; reps: number | null; kind: SetKind }[];
  sets: WorkoutSet[];
  increment_kg: number;
  cap_kg: number | null;
  rest_sec: number;
}

export interface WorkoutFull extends Workout {
  exercises: WorkoutExerciseFull[];
}

export interface PrHit {
  type: PrType;
  value: number;
  weight_kg: number | null;
  reps: number | null;
}

export interface ProgressionChange {
  routine_item_id: string;
  exercise_id: string;
  exercise_name: string;
  kind: ProgressionKind;
  reason: string;
  before: ProgressionState | null;
  after: ProgressionState;
  harder_variation: Pick<Exercise, 'id' | 'name'> | null;
  /** A prompt still awaiting a decision (from the item's current state). */
  pending: 'deload' | 'variation' | null;
  pending_weight_kg: number | null;
  undone: boolean;
}

export type ProgressionKind =
  | 'baseline' | 'up' | 'hold' | 'miss' | 'capped' | 'deload' | 'variation' | 'pinned' | 'manual' | 'skipped';

export interface WorkoutSummary {
  workout: Workout;
  working_sets: number;
  tonnage_kg: number;
  prs: (PrHit & { exercise_name: string; load_type: LoadType })[];
  changes: ProgressionChange[];
  added_exercises: { id: string; name: string }[];
  calorie_profile_complete: boolean;
}

export interface BodyWeightEntry { id: string; date: string; weight_kg: number; note: string | null; created_at: string }
/** A day's nutrition totals (sum of its food log). */
export interface NutritionDay { date: string; calories: number | null; protein_g: number | null; entries: number }

/** A saved, reusable meal (per serving). */
export interface Meal { id: string; name: string; calories: number | null; protein_g: number | null; last_used_at: string | null; uses: number }

/** One thing eaten on a day. Calories/protein are totals for the entry (already × servings). */
export interface FoodEntry {
  id: string; date: string; logged_at: string; meal_id: string | null; name: string | null;
  servings: number; calories: number | null; protein_g: number | null;
}
