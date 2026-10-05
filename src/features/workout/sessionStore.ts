// Live-session UI state for the active workout: whether it was started and which set is running.
// Kept per device (localStorage) so backgrounding or relaunching the app picks up where you were.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionState {
  /** Workout ids that have been started with "Start workout". */
  started: Record<string, true>;
  /** The set being performed right now (▶ pressed, ■ not yet). */
  running: { setId: string; startedAt: number } | null;
  start: (workoutId: string) => void;
  play: (setId: string) => void;
  stop: () => void;
  forget: (workoutId: string) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      started: {},
      running: null,
      start: (id) => set((s) => ({ started: { ...s.started, [id]: true } })),
      play: (setId) => set({ running: { setId, startedAt: Date.now() } }),
      stop: () => set({ running: null }),
      forget: (id) => set((s) => {
        const { [id]: _drop, ...rest } = s.started;
        return { started: rest, running: null };
      }),
    }),
    {
      name: 'redline-session',
      storage: {
        getItem: (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
        setItem: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* per-device convenience */ } },
        removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
      },
    },
  ),
);
