-- REDLINE schema v1. Every table is sync-ready: ULID id, created_at/updated_at (ISO UTC ms), soft delete.
-- Weights are stored in kg.

CREATE TABLE settings (
  id TEXT PRIMARY KEY CHECK (id = 'me'),
  units TEXT NOT NULL DEFAULT 'lb' CHECK (units IN ('lb', 'kg')),
  sex TEXT CHECK (sex IN ('male', 'female')),
  birth_date TEXT,
  height_cm REAL,
  default_rest_sec INTEGER NOT NULL DEFAULT 90,
  calorie_intensity TEXT NOT NULL DEFAULT 'moderate' CHECK (calorie_intensity IN ('light', 'moderate', 'vigorous')),
  protein_target_g INTEGER,
  calorie_target INTEGER,
  weekly_target INTEGER NOT NULL DEFAULT 3,
  default_increment_json TEXT NOT NULL DEFAULT '{}',
  onboarded INTEGER NOT NULL DEFAULT 0,
  last_export_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  primary_muscle TEXT NOT NULL,
  secondary_muscles TEXT NOT NULL DEFAULT '[]',
  equipment TEXT NOT NULL,
  load_type TEXT NOT NULL DEFAULT 'total',
  default_increment_kg REAL,
  max_load_kg REAL,
  harder_variation_id TEXT REFERENCES exercises(id),
  easier_variation_id TEXT REFERENCES exercises(id),
  default_rest_sec INTEGER,
  notes TEXT,
  is_seeded INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE routine_items (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id),
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  group_id TEXT,
  working_sets INTEGER NOT NULL DEFAULT 3,
  rep_min INTEGER NOT NULL DEFAULT 8,
  rep_max INTEGER NOT NULL DEFAULT 12,
  warmup_sets INTEGER NOT NULL DEFAULT 0,
  rest_sec INTEGER,
  progression_mode TEXT NOT NULL DEFAULT 'double' CHECK (progression_mode IN ('double', 'none')),
  increment_kg REAL,
  max_load_kg REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE progression_state (
  id TEXT PRIMARY KEY,
  routine_item_id TEXT NOT NULL UNIQUE REFERENCES routine_items(id),
  target_weight_kg REAL,
  target_reps_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'progressing',
  fail_streak INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  prompt_weight_kg REAL,
  snooze INTEGER NOT NULL DEFAULT 0,
  last_evaluated_workout_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

-- One row per routine item per finished workout: powers the "Next time" list and Undo.
CREATE TABLE progression_history (
  id TEXT PRIMARY KEY,
  routine_item_id TEXT NOT NULL REFERENCES routine_items(id),
  workout_id TEXT NOT NULL REFERENCES workouts(id),
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE workouts (
  id TEXT PRIMARY KEY,
  routine_id TEXT REFERENCES routines(id),
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  active_duration_sec INTEGER,
  bodyweight_kg REAL,
  kcal_estimate REAL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discarded')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE workout_exercises (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES workouts(id),
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  routine_item_id TEXT REFERENCES routine_items(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  group_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE sets (
  id TEXT PRIMARY KEY,
  workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'working' CHECK (kind IN ('warmup', 'working')),
  weight_kg REAL,
  reps INTEGER,
  suggested_weight_kg REAL,
  suggested_reps INTEGER,
  overridden INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE personal_records (
  id TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  type TEXT NOT NULL,
  value REAL NOT NULL,
  weight_kg REAL,
  reps INTEGER,
  set_id TEXT,
  workout_id TEXT NOT NULL,
  achieved_at TEXT NOT NULL,
  baseline INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE body_weight (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE nutrition_day (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  calories INTEGER,
  protein_g INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE INDEX idx_sets_we ON sets(workout_exercise_id);
CREATE INDEX idx_we_exercise ON workout_exercises(exercise_id, workout_id);
CREATE INDEX idx_we_workout ON workout_exercises(workout_id);
CREATE INDEX idx_workouts_started ON workouts(started_at);
CREATE INDEX idx_body_weight_date ON body_weight(date);
CREATE INDEX idx_items_routine ON routine_items(routine_id);
CREATE INDEX idx_pr_exercise ON personal_records(exercise_id);
CREATE INDEX idx_ph_workout ON progression_history(workout_id);
