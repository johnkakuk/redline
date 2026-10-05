/// <reference lib="webworker" />
// Dedicated DB worker: sqlite-wasm on the opfs-sahpool VFS (no COOP/COEP needed; iOS Safari 16.4+).
import * as Comlink from 'comlink';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createApi, type BootInfo, type DbApi } from './api';
import { wrapDb, type Oo1Db } from './sqlite';

const DB_FILE = '/redline.sqlite3';

async function boot(): Promise<DbApi> {
  const sqlite3 = await sqlite3InitModule();
  let raw: Oo1Db;
  let info: Omit<BootInfo, 'schemaVersion' | 'seeded'>;
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'redline-sahpool', directory: '/redline', initialCapacity: 8 });
    raw = new pool.OpfsSAHPoolDb(DB_FILE) as unknown as Oo1Db;
    info = { vfs: 'opfs-sahpool' };
  } catch (e) {
    // e.g. another tab holds the pool, or OPFS is unavailable. Run in memory and warn loudly in the UI.
    raw = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Oo1Db;
    info = { vfs: 'memory', error: e instanceof Error ? e.message : String(e) };
  }
  const db = wrapDb(raw);
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = NORMAL;');
  return createApi(db, info);
}

const ready = boot();

// Every call waits for boot, so the main thread can fire requests immediately.
const proxy = new Proxy({} as Record<string, unknown>, {
  get(_t, name: string) {
    return async (...args: unknown[]) => {
      const api = (await ready) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const fn = api[name];
      if (typeof fn !== 'function') throw new Error(`Unknown DB call ${name}`);
      return fn(...args);
    };
  },
});

Comlink.expose(proxy);
