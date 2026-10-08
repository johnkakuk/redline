// Shared by the app and the Cloudflare Worker.

/** Tables mirrored to the cloud, in foreign-key order. personal_records is rebuilt from sets, so it isn't synced. */
export const SYNCED_TABLES = [
  'settings', 'exercises', 'routines', 'routine_items', 'workouts', 'progression_state', 'progression_history',
  'workout_exercises', 'sets', 'body_weight', 'nutrition_day', 'meals', 'food_log',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** Columns stored as JSON text on the phone and jsonb in Postgres. */
export const JSON_COLUMNS: Partial<Record<SyncedTable, string[]>> = {
  settings: ['default_increment_json', 'equipment_json', 'equipment_caps_json'],
  exercises: ['secondary_muscles'],
  progression_state: ['target_reps_json'],
  progression_history: ['before_json', 'after_json'],
};

/** Max rows per push request and per pull page. */
export const SYNC_BATCH = 500;

export type SyncRow = Record<string, unknown> & { id: string; updated_at: string };

export interface PushResponse { written: number }
export interface PullResponse { rows: SyncRow[]; next: string | null }
