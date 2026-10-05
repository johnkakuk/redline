import * as Comlink from 'comlink';
import type { DbApi } from './api';

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'redline-db' });

/** Typed async handle to the DB worker. The UI never writes SQL; it calls these. */
export const db = Comlink.wrap(worker) as unknown as Async<DbApi>;
