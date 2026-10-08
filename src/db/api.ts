// The DB API: every repo function with the Db handle bound. Runs inside the worker; the UI calls it via Comlink.
import { migrate } from './migrate';
import * as analytics from './repos/analytics.repo';
import * as body from './repos/body.repo';
import * as data from './repos/data.repo';
import * as exercises from './repos/exercises.repo';
import * as nutrition from './repos/nutrition.repo';
import * as programs from './repos/programs.repo';
import * as routines from './repos/routines.repo';
import * as settings from './repos/settings.repo';
import * as sync from './repos/sync.repo';
import * as workouts from './repos/workouts.repo';
import type { Db } from './sqlite';

const modules = { analytics, body, data, exercises, nutrition, programs, routines, settings, sync, workouts };

type Bound<M> = {
  [K in keyof M as M[K] extends (db: Db, ...a: never[]) => unknown ? K : never]: M[K] extends (db: Db, ...a: infer A) => infer R
    ? (...a: A) => R
    : never;
};
type Merge<T> = { [K in keyof T]: Bound<T[K]> }[keyof T];
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
export type DbApi = UnionToIntersection<Merge<typeof modules>> & { boot(): BootInfo };

export interface BootInfo {
  vfs: 'opfs-sahpool' | 'memory';
  schemaVersion: number;
  seeded: number;
  error?: string;
}

/** Functions that take a Db as their first argument (anything else exported from a repo is skipped). */
const BOUND_SKIP = new Set(['DEFAULT_INCREMENTS', 'availableEquipment', 'profileOf', 'parseImport']);

export function createApi(db: Db, info: Omit<BootInfo, 'schemaVersion' | 'seeded'>): DbApi {
  const schemaVersion = migrate(db);
  settings.ensureSettings(db);
  exercises.normalizeSeedIds(db);
  const seeded = exercises.seedExercises(db);
  const api: Record<string, unknown> = {};
  for (const mod of Object.values(modules)) {
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== 'function' || BOUND_SKIP.has(name) || /^[A-Z]/.test(name)) continue;
      if (name in api) throw new Error(`Duplicate API name ${name}`);
      api[name] = (...args: unknown[]) => (fn as (db: Db, ...a: unknown[]) => unknown)(db, ...args);
    }
  }
  const boot: BootInfo = { ...info, schemaVersion, seeded };
  api.boot = () => boot;
  return api as DbApi;
}
