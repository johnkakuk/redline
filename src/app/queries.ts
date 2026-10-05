import { QueryClient, useQuery } from '@tanstack/react-query';
import { db } from '../db/client';
import type { Settings, Units } from '../shared/types';
import { fmtWeight, fromKg, toKg } from '../shared/units';
import { toastError } from '../ui/toast';

// Local DB: data is never stale on its own; mutations invalidate.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false, networkMode: 'always' } },
});

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => db.getSettings() });
}

export function useActiveWorkoutId(): string | null {
  return useQuery({ queryKey: ['active-id'], queryFn: () => db.getActiveWorkoutId() }).data ?? null;
}

/** Unit helpers bound to the user's setting. */
export function useUnits() {
  const units: Units = useSettings().data?.units ?? 'lb';
  return {
    units,
    w: (kg: number | null | undefined, withUnit = false) => fmtWeight(kg, units, withUnit),
    toDisplay: (kg: number | null | undefined) => (kg == null ? null : fromKg(kg, units)),
    toKg: (v: number | null | undefined) => (v == null ? null : toKg(v, units)),
  };
}

/** Run a DB write, refresh every query, and surface errors as a toast. Resolves undefined on failure. */
export async function act<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    const out = await p;
    await queryClient.invalidateQueries();
    return out;
  } catch (e) {
    toastError(e);
    await queryClient.invalidateQueries();
    return undefined;
  }
}

export type { Settings };
