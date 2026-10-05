import { e1rm } from '../../engine/e1rm';
import { EXPORT_APP, ExportFile } from '../../shared/schemas/export';
import { fromKg } from '../../shared/units';
import { SCHEMA_VERSION, SYNC_TABLES } from '../migrate';
import type { Db } from '../sqlite';
import { seedExercises } from './exercises.repo';
import { ensureSettings, getSettings, updateSettings } from './settings.repo';
import { clearSyncState, resetSyncWatermark } from './sync.repo';

// Insert order respects foreign keys.
const TABLE_ORDER = [
  'settings', 'exercises', 'routines', 'routine_items', 'workouts', 'progression_state', 'progression_history',
  'workout_exercises', 'sets', 'personal_records', 'body_weight', 'nutrition_day',
] as const satisfies readonly (typeof SYNC_TABLES)[number][];

export function exportAll(db: Db): ExportFile {
  const exportedAt = new Date().toISOString();
  const tables: ExportFile['tables'] = {};
  for (const t of TABLE_ORDER) tables[t] = db.all(`SELECT * FROM ${t}`);
  updateSettings(db, { last_export_at: exportedAt });
  return { app: EXPORT_APP, schemaVersion: SCHEMA_VERSION, exportedAt, tables };
}

export function parseImport(json: unknown): ExportFile {
  const parsed = ExportFile.safeParse(json);
  if (!parsed.success) throw new Error('Not a Redline export file');
  if (parsed.data.schemaVersion > SCHEMA_VERSION) throw new Error('This export is from a newer version of the app. Update first.');
  return parsed.data;
}

export function previewImport(_db: Db, json: unknown) {
  const f = parseImport(json);
  return {
    exportedAt: f.exportedAt,
    counts: Object.fromEntries(TABLE_ORDER.map((t) => [t, (f.tables[t] ?? []).filter((r) => !r.deleted_at).length])),
  };
}

function columns(db: Db, table: string): Set<string> {
  return new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
}

/**
 * Import an export file. "replace" wipes local data first; "merge" upserts by id with last-write-wins on updated_at.
 * Returns rows written per table.
 */
export function importAll(db: Db, json: unknown, mode: 'replace' | 'merge'): Record<string, number> {
  const f = parseImport(json);
  const written: Record<string, number> = {};
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.tx(() => {
      if (mode === 'replace') for (const t of [...TABLE_ORDER].reverse()) db.run(`DELETE FROM ${t}`);
      for (const t of TABLE_ORDER) {
        const cols = columns(db, t);
        let n = 0;
        for (const row of f.tables[t] ?? []) {
          const keys = Object.keys(row).filter((k) => cols.has(k));
          if (!keys.includes('id')) continue;
          if (mode === 'merge') {
            const existing = db.get<{ updated_at: string }>(`SELECT updated_at FROM ${t} WHERE id = ?`, [row.id as string]);
            if (existing && String(row.updated_at ?? '') <= existing.updated_at) continue;
          }
          db.run(
            `INSERT OR REPLACE INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
            keys.map((k) => row[k] as string | number | null),
          );
          n++;
        }
        written[t] = n;
      }
      ensureSettings(db);
      // Imported rows keep their original updated_at, so push everything again.
      resetSyncWatermark(db);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return written;
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Flat CSV of every completed set, in the user's unit. */
export function exportSetsCsv(db: Db): string {
  const units = getSettings(db).units;
  const rows = db.all<{ started_at: string; workout: string; exercise: string; kind: string; sort_order: number; weight_kg: number | null; reps: number | null; completed_at: string }>(
    `SELECT w.started_at, w.name AS workout, e.name AS exercise, s.kind, s.sort_order, s.weight_kg, s.reps, s.completed_at
     FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
     JOIN exercises e ON e.id = we.exercise_id
     WHERE s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL AND w.deleted_at IS NULL AND w.status = 'completed'
     ORDER BY w.started_at, we.sort_order, CASE s.kind WHEN 'warmup' THEN 0 ELSE 1 END, s.sort_order`,
  );
  const header = ['date', 'workout', 'exercise', 'kind', `weight_${units}`, 'reps', `e1rm_${units}`, 'completed_at'];
  const lines = rows.map((r) => {
    const e = r.weight_kg && r.reps ? e1rm(r.weight_kg, r.reps) : null;
    return [r.started_at.slice(0, 10), r.workout, r.exercise, r.kind, r.weight_kg == null ? '' : fromKg(r.weight_kg, units), r.reps ?? '',
      e == null ? '' : fromKg(e, units), r.completed_at].map(csvCell).join(',');
  });
  return [header.join(','), ...lines].join('\n') + '\n';
}

/** Wipe everything and re-seed. */
export function resetApp(db: Db) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.tx(() => {
      for (const t of [...TABLE_ORDER].reverse()) db.run(`DELETE FROM ${t}`);
      // A reset unpairs this device; the cloud copy is kept and can be restored after pairing again.
      clearSyncState(db);
      ensureSettings(db);
      seedExercises(db);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function dataStats(db: Db) {
  const count = (sql: string) => db.get<{ n: number }>(sql)!.n;
  return {
    workouts: count(`SELECT count(*) AS n FROM workouts WHERE status = 'completed' AND deleted_at IS NULL`),
    sets: count(`SELECT count(*) AS n FROM sets WHERE completed_at IS NOT NULL AND deleted_at IS NULL`),
    exercises: count(`SELECT count(*) AS n FROM exercises WHERE deleted_at IS NULL`),
    routines: count(`SELECT count(*) AS n FROM routines WHERE deleted_at IS NULL`),
    body_weight: count(`SELECT count(*) AS n FROM body_weight WHERE deleted_at IS NULL`),
  };
}
