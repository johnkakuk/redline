import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/client';
import { addDays, fmtDay, parseLocalDate } from '../../shared/time';
import { ActionSheet } from '../../ui/Sheet';
import { toastError } from '../../ui/toast';

/**
 * Open the workout(s) from a local calendar day: one goes straight to its summary,
 * several show a picker. Render `sheet` once in the calling screen.
 */
export function useOpenDay() {
  const nav = useNavigate();
  const [pick, setPick] = useState<null | { date: string; workouts: { id: string; name: string; started_at: string }[] }>(null);

  const open = async (date: string) => {
    try {
      const start = parseLocalDate(date);
      const workouts = await db.workoutsBetween(start.toISOString(), addDays(start, 1).toISOString());
      if (workouts.length === 1) nav(`/history/${workouts[0].id}`);
      else if (workouts.length > 1) setPick({ date, workouts });
    } catch (e) {
      toastError(e);
    }
  };

  const sheet = (
    <ActionSheet open={!!pick} onClose={() => setPick(null)} title={pick ? fmtDay(pick.date, { weekday: 'long', month: 'short', day: 'numeric' }) : ''}
      actions={(pick?.workouts ?? []).map((w) => ({
        label: `${w.name} · ${new Date(w.started_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
        onSelect: () => nav(`/history/${w.id}`),
      }))} />
  );

  return { open, sheet };
}
