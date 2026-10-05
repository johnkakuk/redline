// Cloud sync bookkeeping. Changes are found by updated_at (every write bumps it via triggers; deletes are soft),
// so no per-write outbox is needed: push everything newer than the last pushed watermark.
import { SYNCED_TABLES, type SyncRow } from '../../shared/sync';
import type { Db } from '../sqlite';

export interface SyncState {
  /** Account whose cloud copy this device syncs with. */
  user_id: string | null;
  email: string | null;
  /** Rows with updated_at <= this have been pushed. '' = nothing pushed yet. */
  pushed_until: string;
  last_synced_at: string | null;
  last_error: string | null;
}

const KEYS: (keyof SyncState)[] = ['user_id', 'email', 'pushed_until', 'last_synced_at', 'last_error'];

export function getSyncState(db: Db): SyncState {
  const kv = new Map(db.all<{ key: string; value: string | null }>('SELECT key, value FROM sync_state').map((r) => [r.key, r.value]));
  return {
    user_id: kv.get('user_id') ?? null,
    email: kv.get('email') ?? null,
    pushed_until: kv.get('pushed_until') ?? '',
    last_synced_at: kv.get('last_synced_at') ?? null,
    last_error: kv.get('last_error') ?? null,
  };
}

export function setSyncState(db: Db, patch: Partial<SyncState>): SyncState {
  db.tx(() => {
    for (const [k, v] of Object.entries(patch) as [keyof SyncState, string | null][]) {
      if (!KEYS.includes(k)) continue;
      if (v == null) db.run('DELETE FROM sync_state WHERE key = ?', [k]);
      else db.run('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]);
    }
  });
  return getSyncState(db);
}

export function clearSyncState(db: Db) {
  db.run('DELETE FROM sync_state');
}

/** Push everything again on the next sync (after an import, for example). */
export function resetSyncWatermark(db: Db) {
  db.run("DELETE FROM sync_state WHERE key = 'pushed_until'");
}

/**
 * Rows changed after the watermark, up to `until` (1 ms before now). Anything written in the current
 * millisecond or later has updated_at > until and is picked up next time, so nothing slips through.
 */
export function changesSince(db: Db): { until: string; count: number; tables: Record<string, SyncRow[]> } {
  const from = getSyncState(db).pushed_until;
  const until = new Date(Date.now() - 1).toISOString();
  const tables: Record<string, SyncRow[]> = {};
  let count = 0;
  for (const t of SYNCED_TABLES) {
    const rows = db.all<SyncRow>(`SELECT * FROM ${t} WHERE updated_at > ? AND updated_at <= ? ORDER BY updated_at`, [from, until]);
    if (rows.length) { tables[t] = rows; count += rows.length; }
  }
  return { until, count, tables };
}

export function pendingSyncCount(db: Db): number {
  const from = getSyncState(db).pushed_until;
  return SYNCED_TABLES.reduce((n, t) => n + db.get<{ n: number }>(`SELECT count(*) AS n FROM ${t} WHERE updated_at > ?`, [from])!.n, 0);
}
