// Cloud sync client (main thread), for logged-in users only. The phone stays the source of truth: it pushes
// changes up and pulls only on login or an explicit restore. Offline or logged out, nothing in the app changes.
import { queryClient } from '../app/queries';
import { accessToken, supabase } from '../auth/auth';
import { db } from '../db/client';
import { EXPORT_APP } from '../shared/schemas/export';
import { SYNC_BATCH, SYNCED_TABLES, type PullResponse, type SyncRow } from '../shared/sync';

const API = '/api';
const AUTO_INTERVAL_MS = 5 * 60 * 1000;
const AFTER_WRITE_MS = 8000;

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  if (!token) throw new ApiError(401, 'Log in to sync');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const refresh = () => queryClient.invalidateQueries({ queryKey: ['sync'] });

/** Make sync_state belong to the signed-in user; a different account means everything must be pushed again. */
async function bindUser(): Promise<boolean> {
  const user = (await supabase.auth.getSession()).data.session?.user;
  if (!user) return false;
  const state = await db.getSyncState();
  if (state.user_id !== user.id) {
    await db.clearSyncState();
    await db.setSyncState({ user_id: user.id, email: user.email ?? null });
  }
  return true;
}

let running: Promise<number> | null = null;

/** Push local changes. Resolves to rows pushed (0 if logged out or offline). */
export function syncNow(): Promise<number> {
  running ??= (async () => {
    try {
      if (!navigator.onLine || !(await bindUser())) return 0;
      const { until, count, tables } = await db.changesSince();
      try {
        for (const table of SYNCED_TABLES) {
          const rows = tables[table] ?? [];
          for (let i = 0; i < rows.length; i += SYNC_BATCH) {
            await call('/sync/push', { method: 'POST', body: JSON.stringify({ table, rows: rows.slice(i, i + SYNC_BATCH) }) });
          }
        }
        await db.setSyncState({ pushed_until: until, last_synced_at: new Date().toISOString(), last_error: null });
        return count;
      } catch (e) {
        await db.setSyncState({ last_error: e instanceof ApiError ? e.message : 'Offline or server unreachable' });
        return 0;
      }
    } finally {
      running = null;
      void refresh();
    }
  })();
  return running;
}

let soon: ReturnType<typeof setTimeout> | null = null;

/** Debounced push after local writes. */
export function syncSoon(delay = AFTER_WRITE_MS) {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => { soon = null; void syncNow(); }, delay);
}

async function pullAll(onProgress?: (table: string) => void) {
  const tables: Record<string, SyncRow[]> = {};
  let total = 0;
  for (const table of SYNCED_TABLES) {
    onProgress?.(table);
    const rows: SyncRow[] = [];
    let after = '';
    for (;;) {
      const page = await call<PullResponse>(`/sync/pull?table=${table}&after=${encodeURIComponent(after)}`);
      rows.push(...page.rows);
      if (!page.next) break;
      after = page.next;
    }
    tables[table] = rows;
    total += rows.length;
  }
  return { tables, total };
}

/**
 * Bring the account's cloud copy onto this device.
 * merge: last-write-wins per record (local changes are pushed first). replace: this device becomes the cloud copy.
 */
export async function restoreFromCloud(mode: 'merge' | 'replace' = 'merge', onProgress?: (table: string) => void): Promise<number> {
  if (!(await bindUser())) throw new Error('Log in first');
  if (mode === 'merge') await syncNow();
  const { tables, total } = await pullAll(onProgress);
  if (total > 0) {
    const { schemaVersion } = await db.boot();
    await db.importAll({ app: EXPORT_APP, schemaVersion, exportedAt: new Date().toISOString(), tables }, mode);
    await db.rebuildPrs();
  }
  // Local now matches the cloud (or was pushed just before), so nothing needs re-sending.
  await db.setSyncState({ pushed_until: new Date(Date.now() - 1).toISOString(), last_synced_at: new Date().toISOString(), last_error: null });
  await queryClient.invalidateQueries();
  return total;
}

/**
 * Right after logging in. A fresh device (not set up yet) takes the cloud copy as-is, so its blank
 * defaults never overwrite your real settings. A device already in use pushes its data, then merges the cloud copy.
 */
export async function afterLogin(): Promise<{ pulled: number; pushed: number }> {
  await bindUser();
  const fresh = !(await db.getSettings()).onboarded;
  if (fresh) {
    const pulled = await restoreFromCloud('replace');
    return { pulled, pushed: pulled === 0 ? await syncNow() : 0 };
  }
  const pushed = await syncNow();
  const pulled = await restoreFromCloud('merge');
  return { pulled, pushed };
}

/** Log out. Data stays on this device unless `wipe` (then the app resets to a fresh install). */
export async function logOut(wipe: boolean) {
  await syncNow().catch(() => 0);
  await supabase.auth.signOut();
  await db.clearSyncState();
  if (wipe) await db.resetApp();
  await queryClient.invalidateQueries();
}

/** Push on launch, after writes, when backgrounded, when back online, and every few minutes. */
export function startAutoSync() {
  void syncNow();
  window.addEventListener('redline:write', () => syncSoon());
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => void syncNow());
  setInterval(() => { if (document.visibilityState === 'visible') void syncNow(); }, AUTO_INTERVAL_MS);
}
