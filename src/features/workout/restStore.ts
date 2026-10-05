// Rest timer state. Timestamp-based (endsAt), never a decrementing counter: iOS suspends JS in the background.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RestState {
  endsAt: number | null;
  duration: number;
  label: string;
  expanded: boolean;
  start: (sec: number, label: string) => void;
  add: (sec: number) => void;
  skip: () => void;
  setExpanded: (v: boolean) => void;
}

export const useRest = create<RestState>()(
  persist(
    (set, get) => ({
      endsAt: null,
      duration: 0,
      label: '',
      expanded: false,
      start: (sec, label) => set({ endsAt: Date.now() + sec * 1000, duration: sec, label, expanded: false }),
      add: (sec) => {
        const { endsAt, duration } = get();
        if (!endsAt) return;
        const next = Math.max(Date.now(), endsAt + sec * 1000);
        set({ endsAt: next, duration: Math.max(1, duration + sec) });
      },
      skip: () => set({ endsAt: null, expanded: false }),
      setExpanded: (expanded) => set({ expanded }),
    }),
    {
      name: 'redline-rest',
      storage: {
        getItem: (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
        setItem: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* per-device convenience only */ } },
        removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
      },
    },
  ),
);

/** Re-render on a tick and report remaining seconds (recomputed from endsAt every time). */
export function useRemaining(): { remaining: number; endsAt: number | null; duration: number } {
  const { endsAt, duration } = useRest();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    const onVis = () => tick((n) => n + 1);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [endsAt]);
  const remaining = endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0;
  return { remaining, endsAt, duration };
}

// ── Audio cue (no Vibration API on iOS). Unlocked on the first tap. ──

let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    // A silent buffer fully unlocks playback on iOS.
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
  } catch { /* audio is a nicety */ }
}

export function beep() {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  [0, 0.18, 0.36].forEach((dt, i) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = 'sine';
    o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + dt + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.14);
    o.connect(g).connect(ctx!.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.16);
  });
}

/** Screen Wake Lock during a workout. Feature-detected; fails silently. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock.release();
      } catch { /* not allowed right now */ }
    };
    void acquire();
    const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => {});
    };
  }, [enabled]);
}
