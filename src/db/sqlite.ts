// Thin synchronous wrapper over the sqlite-wasm oo1 API. Used inside the DB worker and in Node tests.

export type Bind = (string | number | null | boolean)[];
export type Row = Record<string, unknown>;

export interface Db {
  all<T = Row>(sql: string, params?: Bind): T[];
  get<T = Row>(sql: string, params?: Bind): T | undefined;
  run(sql: string, params?: Bind): number;
  exec(sql: string): void;
  tx<T>(fn: () => T): T;
}

/** Minimal structural type of sqlite3.oo1.DB that we rely on. */
export interface Oo1Db {
  exec(opts: { sql: string; bind?: unknown; rowMode?: 'object'; returnValue?: 'resultRows' }): unknown;
  changes(): number;
}

const norm = (p?: Bind) => p?.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));

export function wrapDb(raw: Oo1Db): Db {
  let depth = 0;
  let sp = 0;
  const db: Db = {
    all<T>(sql: string, params?: Bind) {
      return raw.exec({ sql, bind: norm(params), rowMode: 'object', returnValue: 'resultRows' }) as T[];
    },
    get<T>(sql: string, params?: Bind) {
      return db.all<T>(sql, params)[0];
    },
    run(sql: string, params?: Bind) {
      raw.exec({ sql, bind: norm(params) });
      return raw.changes();
    },
    exec(sql: string) {
      raw.exec({ sql });
    },
    tx<T>(fn: () => T): T {
      const name = `sp${++sp}`;
      raw.exec({ sql: depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}` });
      depth++;
      try {
        const out = fn();
        depth--;
        raw.exec({ sql: depth === 0 ? 'COMMIT' : `RELEASE ${name}` });
        return out;
      } catch (e) {
        depth--;
        raw.exec({ sql: depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}` });
        throw e;
      }
    },
  };
  return db;
}
