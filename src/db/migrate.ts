import type { Db } from './sqlite';
import m001 from './migrations/001_init.sql?raw';

/** Ordered migrations. Append only; never edit a shipped migration. */
export const MIGRATIONS: { version: number; sql: string }[] = [{ version: 1, sql: m001 }];

/** Tables that carry updated_at and get an auto-touch trigger. */
export const SYNC_TABLES = [
  'settings', 'exercises', 'routines', 'routine_items', 'progression_state', 'progression_history',
  'workouts', 'workout_exercises', 'sets', 'personal_records', 'body_weight', 'nutrition_day',
] as const;

function touchTriggers(): string {
  return SYNC_TABLES.map(
    (t) => `CREATE TRIGGER IF NOT EXISTS ${t}_touch AFTER UPDATE ON ${t} FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN UPDATE ${t} SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;`,
  ).join('\n');
}

export function migrate(db: Db): number {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.tx(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
    });
  }
  db.exec(touchTriggers());
  return Math.max(0, ...MIGRATIONS.map((m) => m.version));
}

export const SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));
